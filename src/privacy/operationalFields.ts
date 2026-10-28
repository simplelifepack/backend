// An explicit, conservative target allowlist. Fields absent from this list are
// PRIVATE by default. The codec and SQL constraints enforce this policy.
// Clinical/financial states and their event dates are intentionally excluded.
export const operationalFields: Record<string, readonly string[]> = {
  // Waitlist email and provider message IDs are never exposed in generic
  // operational projections. Anonymous prospects have no application account.
  WaitlistRegistration: ["id", "registeredAt", "status", "unsubscribedAt", "confirmationStatus", "confirmationAttempts", "confirmationSentAt", "nextAttemptAt"],
  WaitlistRateLimit: ["count", "expiresAt"],
  WaitlistProof: ["expiresAt"],
  // Billing stores canonical catalogue prices and provider linkage/lifecycle
  // metadata only. No payer PII, card/bank data or webhook payload is persisted.
  // Limit generic operator projections to record identity and bookkeeping.
  BillingSubscription: ["id", "userId", "createdAt", "updatedAt"],
  BillingPayment: ["id", "subscriptionId", "createdAt", "updatedAt"],
  BillingWebhookEvent: ["id", "processedAt"],
  UserAIUsage: ["userId", "period", "actionCount", "updatedAt"],
  User: ["id", "accountTier", "billingManaged", "authVersion", "pinAttemptCount", "pinLockedUntil", "deletionRequestedAt", "scheduledDeletionAt", "welcomeEmailSentAt", "createdAt", "updatedAt"],
  CustomPackageGenerationJob: ["id", "userId", "dedupeKey", "status", "retryCount", "provider429Count", "hasVerifiedOfficialSource", "queuedAt", "startedAt", "completedAt", "failedAt", "leaseExpiresAt", "lockedBy", "processingMs", "aiMs", "saveMs", "createdAt", "updatedAt"],
  PushSubscription: ["id", "userId", "active", "revokedAt", "createdAt", "updatedAt"],
  TrustMember: ["id", "ownerUserId", "memberUserId", "accessType", "status", "invitedAt", "inviteExpiresAt", "rejectedAt", "pinAttemptCount", "pinLockedUntil", "acceptedAt", "revokedAt", "createdAt", "updatedAt"],
  TrustMemberPermission: ["id", "trustMemberId", "module", "canView", "canDownload", "createdAt", "updatedAt"],
  ExternalIdentity: ["id", "userId", "provider", "createdAt", "updatedAt"],
  UserIdentityProfile: ["id", "userId", "createdFromDocumentId", "createdAt", "updatedAt"],
  RefreshToken: ["id", "userId", "authVersion", "expiresAt", "revokedAt", "createdAt"],
  PasswordResetToken: ["id", "userId", "expiresAt", "usedAt", "attemptCount", "createdAt"],
  SignupVerification: ["id", "expiresAt", "attemptCount", "createdAt", "updatedAt"],
  AccountChangeOtp: ["id", "userId", "purpose", "expiresAt", "attemptCount", "createdAt", "updatedAt"],
  Document: ["id", "ownerProfileId", "targetProfileId", "mimeType", "size", "storageBucket", "storageMimeType", "encryptionVersion", "contentAlgorithm", "keyAlgorithm", "keyId", "keyVersion", "encryptionIv", "encryptedSha256", "encryptedSize", "ciphertextHash", "userScopedDedupHash", "metadataIntegrityHash", "integrityStatus", "scanStatus", "scanCompletedAt", "analysisSource", "classificationStatus", "sourceProvider", "lastAnalyzed", "createdAt", "updatedAt", "deletedAt", "storageUsageKey"],
  HealthMember: ["id", "userId", "createdAt", "updatedAt"],
  HealthDocument: ["id", "userId", "memberId", "documentId", "createdAt", "processedAt"],
  HealthMeasurement: ["id", "userId", "memberId", "sourceDocumentId", "createdAt"],
  TrackedHealthMetric: ["id", "userId", "memberId", "createdAt", "updatedAt"],
  HealthMedication: ["id", "userId", "memberId", "sourceDocumentId", "createdAt", "updatedAt"],
  HealthFollowUp: ["id", "userId", "memberId", "sourceDocumentId", "createdAt"],
  HealthReminder: ["id", "userId", "memberId", "sourceFollowUpId", "sourceDocumentId", "origin", "createdAt", "updatedAt"],
  DocumentFile: ["id", "documentId", "pageIndex", "sourceType", "pageCount", "mimeType", "size", "storageBucket", "storageMimeType", "encryptionVersion", "contentAlgorithm", "keyAlgorithm", "keyId", "keyVersion", "encryptionIv", "encryptedSha256", "encryptedSize", "ciphertextHash", "createdAt", "updatedAt", "storageUsageKey", "privacyOwnerId"],
  TemporaryUpload: ["id", "ownerProfileId", "storagePath", "detectedMimeType", "size", "status", "createdAt", "expiresAt", "consumedAt", "sourceProvider", "externalCandidateId", "encryptionVersion", "contentAlgorithm", "keyAlgorithm", "keyId", "keyVersion", "encryptionIv", "encryptedSha256", "encryptedSize", "scanStatus", "scanCompletedAt"],
  DigiLockerConsentSession: ["encryptedProgress", "importLeaseToken", "importLeaseUntil", "importAttempts", "importNextAttemptAt", "encryptedPayload", "encryptedCredentials", "id", "userId", "environment", "status", "expiresAt", "authenticatedAt", "cancelledAt", "lastCheckedAt", "createdAt", "updatedAt"],
  ExternalConnection: ["id", "userId", "provider", "status", "lastScannedAt", "lastSuccessfulSync", "scanStartedAt", "scanProcessed", "scanTotal", "indexedCount", "createdAt", "updatedAt"],
  ExternalOAuthState: ["id", "userId", "provider", "expiresAt", "usedAt", "createdAt"],
  ExternalDocumentCandidate: ["id", "userId", "connectionId", "provider", "mimeType", "size", "status", "createdAt", "updatedAt"],
  RequirementAssignment: ["id", "userId", "requirementId", "documentId", "assignmentSource", "overriddenAt", "createdAt", "updatedAt"],
  WealthRecord: ["id", "ownerUserId", "createdAt", "updatedAt"],
  WealthRecordAttachment: ["id", "wealthRecordId", "documentId", "createdAt"],
  StorageCleanup: ["storageKey", "ownerUserId", "sizeBytes", "createdAt"],
  AccountExportJob: ["id", "userId", "status", "storageKey", "fileName", "sizeBytes", "archiveEncryptionVersion", "requestedAt", "preparedAt", "expiresAt", "downloadedAt", "createdAt", "updatedAt"],
  ReadinessPack: ["id", "createdBy", "version", "createdAt", "updatedAt", "deletedAt"],
  Requirement: ["id", "packId", "privacyOwnerId", "sortOrder", "deletedAt"],
};

export const publicDefinitionModels = ["ReadinessFormCategory", "ReadinessFormSubtype", "ReadinessFormField"] as const;
// Catalogue content is public only after provenance review; AI-created entries
// are not assumed public merely because they are in the shared catalogue.
export const reviewRequiredModels = ["ReadinessPack", "Requirement"] as const;

// Never spread the original record, recurse through relations, or decrypt here.
// Storage/crypto locations are omitted from operator responses even though they
// may be readable database metadata. No download capabilities are returned.
const internalOnly = new Set(["encryptedProgress", "importLeaseToken", "encryptedPayload", "encryptedCredentials", "path", "storageKey", "storagePath", "storageBucket", "storedName", "encryptionIv", "keyId", "keyVersion", "metadataIntegrityHash", "userScopedDedupHash", "dedupeKey", "encryptedSha256", "ciphertextHash", "storageUsageKey"]);
export function operationalProjection(model: string, row: Record<string, unknown>) {
  const fields = operationalFields[model];
  if (!fields) throw new Error("OPERATIONAL_MODEL_NOT_ALLOWLISTED");
  return Object.fromEntries(fields.filter(field => !internalOnly.has(field) && Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, row[field]]));
}
