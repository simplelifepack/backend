import { prisma } from "../lib/prisma";
import { withAudit } from "./adminAudit.service";

export class AdminIntegrationsError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminIntegrationsError";
    this.statusCode = statusCode;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };

function shortId(id: string) {
  return id.length > 8 ? `…${id.slice(-7)}` : id;
}

const STUCK_SCAN_THRESHOLD_MS = 60 * 60 * 1000; // matches the 1h threshold Pipelines' stuck-classification check uses

const connectionSelect = {
  id: true, userId: true, provider: true, providerEmail: true, status: true,
  grantedScopes: true, lastScannedAt: true, lastSuccessfulSync: true,
  scanStartedAt: true, scanPhase: true, scanProcessed: true, scanTotal: true,
  indexedCount: true, lastScanError: true, createdAt: true, updatedAt: true,
} as const;

// DTO note (decision D3, same as pipelines.routes.ts): providerEmail is shown
// (admins already see a customer's own email everywhere in Users) but
// encryptedRefreshToken never leaves this file — it's the OAuth credential
// itself, on the sealed list. Unlike Pipelines' read-only lists, `id` here
// is kept in full (not shortId'd) — this screen has a real action
// (force-disconnect) keyed by it; only `userId` is shortened for display,
// since nothing on this screen acts on the user directly.
function toDto(c: Awaited<ReturnType<typeof prisma.externalConnection.findMany<{ select: typeof connectionSelect }>>>[number]) {
  return { ...c, userId: shortId(c.userId) };
}

/** "Where Gmail/Drive connections get stuck" — same framing as the Pipelines
 * screen, just for a different source. Three buckets rather than one big
 * list: a disconnected (needs re-auth) connection, a scan that errored, and
 * a scan that's been running too long are three different things an admin
 * would act on differently. */
export async function listDisconnectedConnections(limit = 50) {
  const where = { status: "disconnected" } as const;
  const [total, rows] = await Promise.all([
    prisma.externalConnection.count({ where }),
    prisma.externalConnection.findMany({ where, select: connectionSelect, orderBy: { updatedAt: "desc" }, take: limit }),
  ]);
  return { total, items: rows.map(toDto) };
}

export async function listScanErrors(limit = 50) {
  const where = { lastScanError: { not: null } } as const;
  const [total, rows] = await Promise.all([
    prisma.externalConnection.count({ where }),
    prisma.externalConnection.findMany({ where, select: connectionSelect, orderBy: { updatedAt: "desc" }, take: limit }),
  ]);
  return { total, items: rows.map(toDto) };
}

export async function listStuckScans(limit = 50) {
  const staleBefore = new Date(Date.now() - STUCK_SCAN_THRESHOLD_MS);
  const where = { scanStartedAt: { not: null, lt: staleBefore } } as const;
  const [total, rows] = await Promise.all([
    prisma.externalConnection.count({ where }),
    prisma.externalConnection.findMany({ where, select: connectionSelect, orderBy: { scanStartedAt: "asc" }, take: limit }),
  ]);
  return { total, items: rows.map(toDto) };
}

/** Same effect as the self-service `DELETE /gmail` / `DELETE /drive` (drop
 * unimported candidates, delete the connection row) — this just lets an
 * admin do it on a customer's behalf, audit-logged, e.g. in response to a
 * support ticket about a stuck or broken integration. Blocked while a scan
 * is actively running, same guard the self-service route already has. */
export async function forceDisconnect(ctx: AdminCtx, connectionId: string, reason: string) {
  const connection = await prisma.externalConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AdminIntegrationsError("Connection not found.", 404);
  if (connection.scanStartedAt) throw new AdminIntegrationsError("A scan is currently running on this connection. Wait for it to finish first.", 409);

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "integration.disconnect",
      targetType: "ExternalConnection", targetId: connectionId, reason,
      diff: { provider: connection.provider, userId: connection.userId, status: connection.status },
    },
    async (tx) => {
      await tx.externalDocumentCandidate.deleteMany({ where: { connectionId: connection.id, status: { not: "imported" } } });
      await tx.externalConnection.delete({ where: { id: connection.id } });
      return { id: shortId(connection.id), provider: connection.provider };
    },
  );
}
