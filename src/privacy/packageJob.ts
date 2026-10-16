import type { CustomPackageGenerationJob } from "@prisma/client";
import { decryptPrivateValue, encryptPrivateValue, isPrivateCiphertext } from "./fieldEncryption";

export const privateJobFields = ["packageType", "documentLabels", "statusMessage", "draft", "errorMessage", "errorCode", "confidence", "disclaimer"] as const;
type JobIdentity = Pick<CustomPackageGenerationJob, "id" | "userId">;
const binding = (job: JobIdentity, field: string) => ({ model: "CustomPackageGenerationJob", recordId: job.id, ownerId: job.userId, field });

export function encryptJobPatch<T extends object>(job: JobIdentity, data: T): T {
  const result = { ...data } as Record<string, unknown>;
  for (const field of privateJobFields) {
    const value = result[field];
    if (value === undefined || value === null) continue;
    // String[] retains its database shape; one envelope holds the complete list.
    result[field] = field === "documentLabels"
      ? [encryptPrivateValue(value, binding(job, field))]
      : encryptPrivateValue(value, binding(job, field));
  }
  return result as T;
}

export function decryptPackageJob(job: CustomPackageGenerationJob, authorizedUserId: string): CustomPackageGenerationJob {
  if (job.userId !== authorizedUserId) throw Object.assign(new Error("Job not found."), { statusCode: 404 });
  const result = { ...job };
  for (const field of privateJobFields) {
    const stored = job[field];
    if (stored === null) continue;
    const ciphertext = field === "documentLabels" ? (stored as string[])[0] : stored;
    if (!isPrivateCiphertext(ciphertext)) throw new Error("PRIVATE_DATA_MIGRATION_REQUIRED");
    if (field === "documentLabels" && (stored as string[]).length !== 1) throw new Error("PRIVATE_DATA_UNAVAILABLE");
    (result as Record<string, unknown>)[field] = decryptPrivateValue(ciphertext, binding(job, field));
  }
  return result;
}

export function jobFieldIsEncrypted(field: typeof privateJobFields[number], value: unknown): boolean {
  return value === null || (field === "documentLabels"
    ? Array.isArray(value) && value.length === 1 && isPrivateCiphertext(value[0])
    : isPrivateCiphertext(value));
}
