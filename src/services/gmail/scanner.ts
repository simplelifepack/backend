import type { gmail_v1 } from "googleapis";

import { prisma } from "../../lib/prisma";
import { authorizedGmail } from "./oauth";
import { candidatesFromMessage, gmailSearchQueries } from "./candidates";

const MAX_MESSAGES = 300;
const PAGE_SIZE = 50;

export type GmailApi = gmail_v1.Gmail;

function afterCheckpoint(lastScannedAt: Date | null, full: boolean) {
  if (full || !lastScannedAt) return "";
  const date = new Date(lastScannedAt.getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, "/");
  return ` after:${date}`;
}

async function listMessageIds(gmail: GmailApi, lastScannedAt: Date | null, full: boolean) {
  const ids = new Set<string>();
  for (const search of gmailSearchQueries) {
    let pageToken: string | undefined;
    do {
      const response = await gmail.users.messages.list({ userId: "me", q: `${search.query}${afterCheckpoint(lastScannedAt, full)}`, maxResults: PAGE_SIZE, pageToken });
      for (const message of response.data.messages ?? []) if (message.id) ids.add(message.id);
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken && ids.size < MAX_MESSAGES);
    if (ids.size >= MAX_MESSAGES) break;
  }
  return [...ids].slice(0, MAX_MESSAGES);
}

async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    results.push(...await Promise.all(items.slice(index, index + limit).map(fn)));
  }
  return results;
}

export async function scanGmail(userId: string, providedGmail?: GmailApi, full = false) {
  const auth = providedGmail ? null : await authorizedGmail(userId);
  const connection = auth?.connection ?? await prisma.externalConnection.findUniqueOrThrow({
    where: { userId_provider: { userId, provider: "gmail" } },
  });
  if (connection.scanStartedAt) throw Object.assign(new Error("A Gmail scan is already running."), { statusCode: 409 });
  const locked = await prisma.externalConnection.updateMany({
    where: { id: connection.id, scanStartedAt: null, status: "connected" }, data: { scanStartedAt: new Date() },
  });
  if (locked.count !== 1) throw Object.assign(new Error("A Gmail scan is already running."), { statusCode: 409 });
  try {
    await prisma.externalDocumentCandidate.updateMany({
      where: {
        connectionId: connection.id,
        status: { in: full ? ["candidate", "needs_review", "ignored"] : ["candidate"] },
        ...(full ? {} : { legitimacyScore: 0, matchedSignals: { isEmpty: true } }),
      },
      data: {
        status: "ignored",
        reviewRequired: false,
        ignoredReason: full ? "Not matched by latest targeted scan" : "Insufficient document evidence",
      },
    });
    const gmail = providedGmail ?? auth!.gmail;
    const ids = await listMessageIds(gmail, connection.lastScannedAt, full);
    const messages = await mapBounded(ids, 6, async (id) => (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data);
    const candidates = messages.flatMap(candidatesFromMessage);
    for (const candidate of candidates) {
      const existing = await prisma.externalDocumentCandidate.findUnique({
        where: { connectionId_sourceKey: { connectionId: connection.id, sourceKey: candidate.sourceKey } },
      });
      const protectedStatus = existing && ["dismissed", "imported", "pending_review"].includes(existing.status);
      await prisma.externalDocumentCandidate.upsert({
        where: { connectionId_sourceKey: { connectionId: connection.id, sourceKey: candidate.sourceKey } },
        create: { ...candidate, userId, connectionId: connection.id, provider: "gmail" },
        update: { ...candidate, ...(protectedStatus ? { status: existing.status } : {}) },
      });
    }
    const lastScannedAt = new Date();
    await prisma.externalConnection.update({ where: { id: connection.id }, data: { lastScannedAt, scanStartedAt: null } });
    return {
      discovered: candidates.length,
      relevant: candidates.filter((candidate) => candidate.status === "candidate").length,
      needsReview: candidates.filter((candidate) => candidate.status === "needs_review").length,
      ignored: candidates.filter((candidate) => candidate.status === "ignored").length,
      lastScannedAt,
    };
  } catch (error) {
    const authFailure = String((error as { message?: unknown }).message ?? error).toLowerCase();
    await prisma.externalConnection.update({
      where: { id: connection.id },
      data: { scanStartedAt: null, ...(authFailure.includes("invalid_grant") || authFailure.includes("unauthorized") ? { status: "disconnected", encryptedRefreshToken: "" } : {}) },
    }).catch(() => undefined);
    throw error;
  }
}
