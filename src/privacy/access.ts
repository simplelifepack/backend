import { AsyncLocalStorage } from "node:async_hooks";

type PrivateAccess = { kind: "user"; userId: string } | { kind: "migration"; reason: string } | { kind: "maintenance"; reason: string } | { kind: "credential" };
const access = new AsyncLocalStorage<PrivateAccess>();

export function withPrivateUser<T>(userId: string, work: () => T): T {
  if (!userId) throw new Error("PRIVATE_ACCESS_REQUIRED");
  return access.run({ kind: "user", userId }, work);
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
