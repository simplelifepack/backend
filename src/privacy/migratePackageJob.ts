import type { CustomPackageGenerationJob } from "@prisma/client";
import { decryptPrivateValue, privateLookup } from "./fieldEncryption";
import { encryptJobPatch, jobFieldIsEncrypted, privateJobFields } from "./packageJob";

export function migratePackageJob(row: CustomPackageGenerationJob) {
  const plain = { ...row };
  const pending: Record<string, unknown> = {};
  for (const field of privateJobFields) {
    const stored = row[field];
    if (stored === null) continue;
    if (jobFieldIsEncrypted(field, stored)) {
      const ciphertext = field === "documentLabels" ? (stored as string[])[0] : stored as string;
      (plain as Record<string, unknown>)[field] = decryptPrivateValue(ciphertext, {
        model: "CustomPackageGenerationJob", recordId: row.id, ownerId: row.userId, field,
      });
    } else {
      // Reserved prefixes cannot be accepted as legacy plaintext: a broken v2
      // envelope must halt migration, rather than being silently encrypted again.
      const values = Array.isArray(stored) ? stored : [stored];
      if (values.some(value => typeof value === "string" && value.startsWith("enc:v2:"))) throw new Error("PRIVATE_DATA_UNAVAILABLE");
      pending[field] = stored;
    }
  }
  const documentLabels = [...new Set(plain.documentLabels.map(label => label.trim()).filter(Boolean))].sort();
  const dedupeKey = privateLookup({ packageType: plain.packageType.trim().toLowerCase(), documentLabels }, {
    model: "CustomPackageGenerationJob", field: "dedupeKey", ownerId: row.userId,
  });
  const patch = encryptJobPatch(row, pending);
  if (row.dedupeKey !== dedupeKey) patch.dedupeKey = dedupeKey;
  return patch;
}
