import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { CustomPackageGenerationJob, Prisma } from "@prisma/client";

import { packageInputSchema } from "../ai/packageInput";
import { AIUnavailableError, PackageGenerationRejectedError, analyzeIntent } from "../ai/analyzeIntent";
import type { AIReadinessPackage } from "../ai/intentTypes";
import { prisma } from "../lib/prisma";

const ACTIVE_STATUSES = ["researching", "generating", "saving"];
const TERMINAL_STATUSES = ["completed", "completed_with_unverified_sources", "failed"];
const LEASE_MS = 120_000;
const ADVISORY_LOCK_KEY = 72942144;

export type CustomPackageGenerationJobDto = {
  id: string;
  status: string;
  statusMessage: string;
  draft?: AIReadinessPackage;
  errorMessage?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  queueWaitMs?: number;
  aiMs?: number;
  processingMs?: number;
  retryCount: number;
  provider429Count: number;
  hasVerifiedOfficialSource: boolean;
  confidence?: string;
  disclaimer?: string;
};

function concurrencyLimit() {
  const value = Number(process.env.CUSTOM_PACKAGE_AI_CONCURRENCY ?? process.env.PACKAGE_AI_QUEUE_CONCURRENCY ?? 5);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 5;
}

function dedupeKey(userId: string, packageType: string, documentLabels: string[]) {
  const normalizedLabels = [...new Set(documentLabels.map((label) => label.trim()).filter(Boolean))].sort();
  return createHash("sha256")
    .update(JSON.stringify({ userId, packageType: packageType.trim().toLowerCase(), documentLabels: normalizedLabels }))
    .digest("hex");
}

function statusMessage(status: string, unverified = false) {
  if (status === "queued") return "Waiting to generate your package...";
  if (status === "researching") return "Researching requirements...";
  if (status === "generating") return "Preparing your checklist...";
  if (status === "saving") return "Saving your generated checklist...";
  if (status === "completed_with_unverified_sources" || unverified) return "Official source not found. These documents may still be helpful, but please verify them with the relevant authority.";
  if (status === "completed") return "Package draft ready.";
  return "Package generation failed.";
}

function toDto(job: CustomPackageGenerationJob): CustomPackageGenerationJobDto {
  const draft = job.draft && typeof job.draft === "object" ? job.draft as unknown as AIReadinessPackage : undefined;
  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage ?? statusMessage(job.status, job.status === "completed_with_unverified_sources"),
    ...(draft ? { draft } : {}),
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    queuedAt: job.queuedAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
    ...(job.failedAt ? { failedAt: job.failedAt.toISOString() } : {}),
    ...(job.startedAt ? { queueWaitMs: job.startedAt.getTime() - job.queuedAt.getTime() } : {}),
    ...(job.aiMs !== null ? { aiMs: job.aiMs } : {}),
    ...(job.processingMs !== null ? { processingMs: job.processingMs } : {}),
    retryCount: job.retryCount,
    provider429Count: job.provider429Count,
    hasVerifiedOfficialSource: job.hasVerifiedOfficialSource,
    ...(job.confidence ? { confidence: job.confidence } : {}),
    ...(job.disclaimer ? { disclaimer: job.disclaimer } : {}),
  };
}

export async function createCustomPackageGenerationJob(userId: string, input: unknown) {
  const parsed = packageInputSchema.parse(input);
  const key = dedupeKey(userId, parsed.packageType, parsed.documentLabels);
  const existing = await prisma.customPackageGenerationJob.findFirst({
    where: { userId, dedupeKey: key, status: { notIn: TERMINAL_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return toDto(existing);
  const job = await prisma.customPackageGenerationJob.create({
    data: {
      userId,
      dedupeKey: key,
      packageType: parsed.packageType,
      documentLabels: parsed.documentLabels,
      status: "queued",
      statusMessage: statusMessage("queued"),
    },
  });
  return toDto(job);
}

async function claimJob(userId: string, jobId: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const workerId = randomUUID();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
    await tx.customPackageGenerationJob.updateMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: "queued",
        statusMessage: statusMessage("queued"),
        leaseExpiresAt: null,
        lockedBy: null,
      },
    });
    const job = await tx.customPackageGenerationJob.findFirst({ where: { id: jobId, userId } });
    if (!job) return null;
    if (job.status !== "queued") return job;
    const active = await tx.customPackageGenerationJob.count({
      where: {
        status: { in: ACTIVE_STATUSES },
        leaseExpiresAt: { gt: now },
      },
    });
    if (active >= concurrencyLimit()) return job;
    return tx.customPackageGenerationJob.update({
      where: { id: job.id },
      data: {
        status: "researching",
        statusMessage: statusMessage("researching"),
        startedAt: job.startedAt ?? now,
        lockedBy: workerId,
        leaseExpiresAt,
      },
    });
  });
}

export async function getAndMaybeProcessCustomPackageGenerationJob(userId: string, jobId: string) {
  const claimed = await claimJob(userId, jobId);
  if (!claimed) return null;
  if (claimed.status !== "researching") return toDto(claimed);
  return toDto(await processClaimedJob(claimed));
}

async function updateJob(id: string, data: Prisma.CustomPackageGenerationJobUpdateInput) {
  return prisma.customPackageGenerationJob.update({ where: { id }, data });
}

async function processClaimedJob(job: CustomPackageGenerationJob) {
  const started = performance.now();
  try {
    await updateJob(job.id, { status: "generating", statusMessage: statusMessage("generating") });
    const aiStarted = performance.now();
    const draft = await analyzeIntent(job.userId, { packageType: job.packageType, documentLabels: job.documentLabels }, {
      allowUnverifiedGuidance: true,
      onRetry: async (event) => {
        await updateJob(job.id, {
        retryCount: { increment: 1 },
        ...(event.status === 429 ? { provider429Count: { increment: 1 } } : {}),
        });
      },
    });
    const aiMs = Math.round(performance.now() - aiStarted);
    const unverified = !draft.hasVerifiedOfficialSource || draft.verificationStatus === "unverified_guidance";
    const status = unverified ? "completed_with_unverified_sources" : "completed";
    await updateJob(job.id, { status: "saving", statusMessage: statusMessage("saving"), aiMs });
    return updateJob(job.id, {
      status,
      statusMessage: statusMessage(status, unverified),
      draft: draft as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      leaseExpiresAt: null,
      lockedBy: null,
      processingMs: Math.round(performance.now() - started),
      hasVerifiedOfficialSource: !unverified,
      confidence: draft.confidence ?? (unverified ? "low" : "high"),
      disclaimer: draft.disclaimer,
      aiMs,
    });
  } catch (error) {
    const provider429Count = (error as { status?: number })?.status === 429 || /status 429/i.test(error instanceof Error ? error.message : String(error)) ? 1 : 0;
    const userMessage = error instanceof PackageGenerationRejectedError
      ? "Could not generate a useful checklist for that request. Try adding a little more detail."
      : error instanceof AIUnavailableError
        ? "Package generation is temporarily unavailable. Please try again shortly."
        : error instanceof Error ? error.message : "Package generation failed.";
    return updateJob(job.id, {
      status: "failed",
      statusMessage: statusMessage("failed"),
      errorCode: error instanceof Error ? error.name : "Error",
      errorMessage: userMessage,
      failedAt: new Date(),
      leaseExpiresAt: null,
      lockedBy: null,
      processingMs: Math.round(performance.now() - started),
      provider429Count: { increment: provider429Count },
    });
  }
}
