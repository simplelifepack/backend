import { prisma } from "../lib/prisma";
import { sendRawEmail } from "./email/emailService";
import { writeAuditLog } from "./adminAudit.service";
import type { Job } from "@prisma/client";

export class AlertingError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AlertingError";
    this.statusCode = statusCode;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };

// --- Channels ----------------------------------------------------------

export async function listChannels() {
  return prisma.alertChannel.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createChannel(ctx: AdminCtx, input: { type: "email" | "webhook"; name: string; target: string }) {
  if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.target)) {
    throw new AlertingError("Target must be a valid email address.", 400);
  }
  if (input.type === "webhook" && !/^https?:\/\//.test(input.target)) {
    throw new AlertingError("Target must be an http(s) URL.", 400);
  }
  return prisma.$transaction(async (tx) => {
    const channel = await tx.alertChannel.create({ data: input });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "alert.channel.create",
      targetType: "AlertChannel", targetId: channel.id, diff: { type: input.type, name: input.name, target: input.target },
    });
    return channel;
  });
}

export async function setChannelEnabled(ctx: AdminCtx, id: string, enabled: boolean) {
  const existing = await prisma.alertChannel.findUnique({ where: { id } });
  if (!existing) throw new AlertingError("Channel not found.", 404);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.alertChannel.update({ where: { id }, data: { enabled } });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: enabled ? "alert.channel.enable" : "alert.channel.disable",
      targetType: "AlertChannel", targetId: id,
    });
    return updated;
  });
}

export async function deleteChannel(ctx: AdminCtx, id: string) {
  const existing = await prisma.alertChannel.findUnique({ where: { id }, include: { rules: { select: { id: true } } } });
  if (!existing) throw new AlertingError("Channel not found.", 404);
  if (existing.rules.length > 0) {
    throw new AlertingError(`${existing.rules.length} rule(s) still use this channel — delete or reassign them first.`, 409);
  }
  return prisma.$transaction(async (tx) => {
    await tx.alertChannel.delete({ where: { id } });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "alert.channel.delete",
      targetType: "AlertChannel", targetId: id, diff: { name: existing.name, type: existing.type },
    });
  });
}

// --- Rules ---------------------------------------------------------------

export async function listRules() {
  return prisma.alertRule.findMany({ orderBy: { createdAt: "desc" }, include: { channel: true } });
}

export async function createRule(ctx: AdminCtx, input: {
  name: string; sourceModule: string; condition: "job_failed"; jobType?: "key_rewrap" | "storage_audit" | "package_source_backfill" | null;
  channelId: string; cooldownMinutes?: number;
}) {
  const channel = await prisma.alertChannel.findUnique({ where: { id: input.channelId } });
  if (!channel) throw new AlertingError("Channel not found.", 404);
  if (input.cooldownMinutes != null && (!Number.isInteger(input.cooldownMinutes) || input.cooldownMinutes < 1)) {
    throw new AlertingError("Cooldown must be a positive whole number of minutes.", 400);
  }
  return prisma.$transaction(async (tx) => {
    const rule = await tx.alertRule.create({
      data: {
        name: input.name, sourceModule: input.sourceModule, condition: input.condition,
        jobType: input.jobType ?? null, channelId: input.channelId, cooldownMinutes: input.cooldownMinutes ?? 60,
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "alert.rule.create",
      targetType: "AlertRule", targetId: rule.id,
      diff: { name: input.name, condition: input.condition, jobType: input.jobType ?? null, channelId: input.channelId },
    });
    return rule;
  });
}

export async function setRuleEnabled(ctx: AdminCtx, id: string, enabled: boolean) {
  const existing = await prisma.alertRule.findUnique({ where: { id } });
  if (!existing) throw new AlertingError("Rule not found.", 404);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.alertRule.update({ where: { id }, data: { enabled } });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: enabled ? "alert.rule.enable" : "alert.rule.disable",
      targetType: "AlertRule", targetId: id,
    });
    return updated;
  });
}

export async function deleteRule(ctx: AdminCtx, id: string) {
  const existing = await prisma.alertRule.findUnique({ where: { id } });
  if (!existing) throw new AlertingError("Rule not found.", 404);
  return prisma.$transaction(async (tx) => {
    await tx.alertRule.delete({ where: { id } });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "alert.rule.delete",
      targetType: "AlertRule", targetId: id, diff: { name: existing.name },
    });
  });
}

// --- Delivery --------------------------------------------------------------

async function deliver(channel: { type: "email" | "webhook"; target: string }, payload: { subject: string; text: string; json: Record<string, unknown> }) {
  if (channel.type === "email") {
    return sendRawEmail({ to: channel.target, subject: payload.subject, text: payload.text, html: `<pre>${payload.text}</pre>` });
  }
  try {
    const res = await fetch(channel.target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: payload.text, ...payload.json }), // `text` key is Slack-webhook-compatible, per D8
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The one real trigger wired up in this pass: called from each job
 * service's fail-transition (rewrapJob/storageAuditJob/backfillJob) right
 * after a Job's status flips to "failed". Finds enabled job_failed rules
 * matching this job's type (or with no type filter), respects each rule's
 * cooldown independently, delivers, and records both the delivery attempt
 * (lastTriggeredAt) and an audit row — whether delivery succeeded or not,
 * since "we tried to alert and it failed" is itself worth knowing. */
export async function evaluateJobFailedAlerts(job: Job) {
  const now = new Date();
  const rules = await prisma.alertRule.findMany({
    where: { condition: "job_failed", enabled: true, channel: { enabled: true }, OR: [{ jobType: null }, { jobType: job.type }] },
    include: { channel: true },
  });

  for (const rule of rules) {
    if (rule.lastTriggeredAt) {
      const cooldownMs = rule.cooldownMinutes * 60 * 1000;
      if (now.getTime() - rule.lastTriggeredAt.getTime() < cooldownMs) continue; // still cooling down
    }
    const subject = `[ReadiNes] ${job.type} job failed`;
    const text = `Job ${job.id} (${job.type}) failed.\n\nError: ${job.lastError ?? "unknown"}\nProcessed: ${job.processedCount}${job.totalCount ? ` of ${job.totalCount}` : ""}\n\nRule: ${rule.name}`;
    const delivered = await deliver(rule.channel, { subject, text, json: { subject, jobId: job.id, jobType: job.type, error: job.lastError } });

    await prisma.$transaction(async (tx) => {
      await tx.alertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: now } });
      await writeAuditLog(tx, {
        adminId: null, actorEmail: "system", action: "alert.fired",
        targetType: "AlertRule", targetId: rule.id,
        diff: { jobId: job.id, jobType: job.type, channelType: rule.channel.type, delivered },
      });
    });
  }
}

/** Sibling of `evaluateJobFailedAlerts` for Phase 2 HOLD "AI operations &
 * prompts" (D7) — called after `getMonthToDateSpend(taskKey)` crosses an
 * `AIBudget`'s cap. Same shape: find enabled `budget_exceeded` rules
 * matching this task (or with no task filter), respect cooldown, deliver,
 * record. Never blocks the AI call that pushed spend over the cap — this
 * fires after the fact, same "alert-only" framing as the budget check
 * itself. */
export async function evaluateBudgetAlert(taskKey: string, monthToDateUsd: number, capUsd: number) {
  const now = new Date();
  const rules = await prisma.alertRule.findMany({
    where: { condition: "budget_exceeded", enabled: true, channel: { enabled: true }, OR: [{ taskKey: null }, { taskKey }] },
    include: { channel: true },
  });

  for (const rule of rules) {
    if (rule.lastTriggeredAt) {
      const cooldownMs = rule.cooldownMinutes * 60 * 1000;
      if (now.getTime() - rule.lastTriggeredAt.getTime() < cooldownMs) continue;
    }
    const subject = `[ReadiNes] ${taskKey} AI spend over budget`;
    const text = `Task ${taskKey} has spent an estimated $${monthToDateUsd.toFixed(2)} this month, over its $${capUsd.toFixed(2)} cap.\n\nThis is an estimate from logged token counts, not a billing-accurate figure. Nothing was blocked.\n\nRule: ${rule.name}`;
    const delivered = await deliver(rule.channel, { subject, text, json: { subject, taskKey, monthToDateUsd, capUsd } });

    await prisma.$transaction(async (tx) => {
      await tx.alertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: now } });
      await writeAuditLog(tx, {
        adminId: null, actorEmail: "system", action: "alert.fired",
        targetType: "AlertRule", targetId: rule.id,
        diff: { taskKey, monthToDateUsd, capUsd, channelType: rule.channel.type, delivered },
      });
    });
  }
}
