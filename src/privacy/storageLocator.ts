import { assertPrivateOwner } from "./access";
import { decryptPrivateValue, encryptPrivateValue } from "./fieldEncryption";
import { storageUsageToken } from "./modelCodec";

export function encryptedCleanupLocator(ownerUserId: string, locator: string) {
  const storageKey = storageUsageToken(ownerUserId, locator);
  if (!storageKey) throw new Error("A storage locator is required.");
  return { storageKey, encryptedKey: encryptPrivateValue(locator, { model: "StorageCleanup", recordId: storageKey, ownerId: ownerUserId, field: "storageKey" }) };
}

export function decryptCleanupLocator(row: { storageKey: string; ownerUserId: string; encryptedKey: string | null }) {
  assertPrivateOwner(row.ownerUserId);
  if (!row.encryptedKey) throw new Error("PRIVATE_DATA_MIGRATION_REQUIRED");
  const locator = decryptPrivateValue<string>(row.encryptedKey, { model: "StorageCleanup", recordId: row.storageKey, ownerId: row.ownerUserId, field: "storageKey" });
  if (storageUsageToken(row.ownerUserId, locator) !== row.storageKey) throw new Error("PRIVATE_DATA_UNAVAILABLE");
  return locator;
}
