const messages: Record<string, string> = {
  STORAGE_LIMIT_EXCEEDED: "Storage limit reached. Free space or upgrade, then retry.",
  FILE_TOO_LARGE: "This document exceeds the 10 MB file limit.",
  FILE_SIGNATURE_MISMATCH: "The downloaded file is not a supported PDF.",
  UNSUPPORTED_FILE_TYPE: "DigiLocker did not return a downloadable PDF for this document.",
  PASSWORD_PROTECTED_FILE: "This PDF is password protected and cannot be imported.",
  UNSAFE_FILE: "The downloaded PDF contains unsupported active or embedded content.",
  FILE_CORRUPTED: "The downloaded PDF is corrupted or incomplete.",
  MALWARE_DETECTED: "This document did not pass security scanning.",
  DIGILOCKER_ACCESS_EXPIRED: "DigiLocker access expired. Reconnect and retry this document.",
  DIGILOCKER_ACCESS_DENIED: "DigiLocker denied access to this document. Reconnect and grant document access.",
  DIGILOCKER_FILE_UNAVAILABLE: "DigiLocker could not find a downloadable copy of this document.",
  DIGILOCKER_INTEGRITY_FAILED: "The DigiLocker download failed its integrity check. Retry this document.",
  DIGILOCKER_PROVIDER_ERROR: "DigiLocker could not download this document. Retry in a moment.",
  DIGILOCKER_RATE_LIMITED: "DigiLocker is busy. Wait a moment and retry this document.",
  DOCUMENT_SAVE_FAILED: "ReadiNes could not save this document. Retry the import.",
};
// Raw provider/Prisma messages may include private input. Persist and log only
// allowlisted diagnostic codes; never log file contents, references or tokens.
export function importFailure(error: unknown) {
  const candidate = error as { code?: unknown; name?: unknown; providerStatus?: unknown } | null;
  const code = typeof candidate?.code === "string" && messages[candidate.code] ? candidate.code
    : candidate?.name === "PrismaClientValidationError" || (typeof candidate?.code === "string" && /^P\d{4}$/.test(candidate.code))
      ? "DOCUMENT_SAVE_FAILED" : "IMPORT_FAILED";
  return { code, message: messages[code] ?? "Import failed. Retry this document; reconnect if the session has expired.",
    ...(typeof candidate?.providerStatus === "number" ? { providerStatus: candidate.providerStatus } : {}) };
}
