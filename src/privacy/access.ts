import { AsyncLocalStorage } from "node:async_hooks";

type PrivateAccess = { kind: "user"; userId: string } | { kind: "migration"; reason: string } | { kind: "maintenance"; reason: string } | { kind: "credential" } | { kind: "admin"; adminId: string; capability: string };
const access = new AsyncLocalStorage<PrivateAccess>();

export function withPrivateUser<T>(userId: string, work: () => T): T {
  if (!userId) throw new Error("PRIVATE_ACCESS_REQUIRED");
  return access.run({ kind: "user", userId }, work);
}

// DRAFT (22 Oct) — proposed, not yet reviewed by the privacy layer's own
// author. Confirmed gap: no admin-access mode existed at all before this;
// an authenticated admin reading ANOTHER user's protected fields (e.g. for
// support/ops) had no path that wasn't withPrivateMigration/
// withPrivateMaintenance — both bypass ownership unconditionally and were
// built for offline backfills, not an audited interactive admin read.
//
// Deliberately NOT scoped to one targetUserId: an admin's authorization to
// view ANY user's record comes from their RBAC capability (already
// enforced by requireCapability() before the route handler runs), not a
// pre-approved specific target — the same way a list screen showing many
// users' names has no single "target" to scope to. Accountability is the
// capability name + a mandatory audit entry, not a per-row allowlist.
//
// Deliberately a PURE context primitive, same shape as the other four
// here — no audit side effect baked in. It CANNOT safely import
// writeAuditLog (adminAudit.service.ts → lib/prisma.ts → encryptedClient.ts
// → this file: a circular import). The composing, audit-enforcing version
// is withAuditedAdminAccess() in adminAudit.service.ts, which sits above
// both and should be what admin routes actually call — this primitive
// exists so that wrapper has something to wrap, not for routes to call
// directly.
export function withAdminAccess<T>(input: { adminId: string; capability: string }, work: () => T): T {
  if (!input.adminId || !input.capability) throw new Error("PRIVATE_ACCESS_REQUIRED");
  return access.run({ kind: "admin", adminId: input.adminId, capability: input.capability }, work);
}

// For offline backfills and isolated tests, never from an operator HTTP route.
export function withPrivateMigration<T>(reason: string, work: () => T): T {
  if (!reason) throw new Error("PRIVATE_ACCESS_REQUIRED");
  return access.run({ kind: "migration", reason }, work);
}

export function assertPrivateOwner(ownerId: string) {
  const current = access.getStore();
  if (!current || current.kind === "maintenance" || current.kind === "credential" || (current.kind === "user" && current.userId !== ownerId)) {
    throw Object.assign(new Error("Private record not found."), { statusCode: 404 });
  }
  // kind:"admin" passes for any ownerId, same as "migration" — the
  // authorization decision already happened at requireCapability(), not here.
}

export function withPrivateMaintenance<T>(reason: string, work: () => T): T {
  if (!reason) throw new Error("PRIVATE_ACCESS_REQUIRED");
  return access.run({ kind: "maintenance", reason }, work);
}
export function isPrivateMaintenance() { return access.getStore()?.kind === "maintenance"; }
export function isPrivateMigration() { return access.getStore()?.kind === "migration"; }
// Credential discovery permits restricted projections only; it never grants
// private-field decryption. Password/PIN/OTP/OAuth verification happens next.
export function withCredentialLookup<T>(work: () => T): T { return access.run({ kind: "credential" }, work); }
export function isCredentialLookup() { return access.getStore()?.kind === "credential"; }

export function currentPrivateUserId() {
  const current = access.getStore();
  return current?.kind === "user" ? current.userId : null;
}
