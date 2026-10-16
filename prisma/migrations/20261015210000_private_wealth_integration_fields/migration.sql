-- Coordinated maintenance expansion. Preserve legacy rows, encrypt then validate.
ALTER TABLE "wealth_records" ADD COLUMN "private_type" TEXT;
ALTER TABLE "wealth_records" ADD COLUMN "private_title" TEXT;
ALTER TABLE "wealth_records" ADD COLUMN "private_details" TEXT;
ALTER TABLE "wealth_records" ADD COLUMN "private_notes" TEXT;
ALTER TABLE "wealth_records" ADD COLUMN "private_followUpDate" TEXT;
ALTER TABLE "wealth_records" ADD COLUMN "private_followUpNote" TEXT;
ALTER TABLE "wealth_records" ADD CONSTRAINT "wealth_records_private_v2" CHECK (
  ("private_type" IS NOT NULL AND "private_type" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("type" = 'ASSET')
  AND ("private_title" IS NOT NULL AND "private_title" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("title" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_details" IS NOT NULL AND "private_details" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("details" = '{}'::jsonb)
  AND ("private_notes" IS NOT NULL AND "private_notes" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("notes" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_followUpDate" IS NOT NULL AND "private_followUpDate" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("followUpDate" IS NULL)
  AND ("private_followUpNote" IS NOT NULL AND "private_followUpNote" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("followUpNote" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "ExternalConnection" ADD COLUMN "private_providerAccountId" TEXT;
ALTER TABLE "ExternalConnection" ADD COLUMN "private_providerEmail" TEXT;
ALTER TABLE "ExternalConnection" ADD COLUMN "private_encryptedRefreshToken" TEXT;
ALTER TABLE "ExternalConnection" ADD COLUMN "private_grantedScopes" TEXT;
ALTER TABLE "ExternalConnection" ADD COLUMN "private_scanPhase" TEXT;
ALTER TABLE "ExternalConnection" ADD COLUMN "private_lastScanError" TEXT;
ALTER TABLE "ExternalConnection" ADD CONSTRAINT "ExternalConnection_private_v2" CHECK (
  ("private_providerAccountId" IS NOT NULL AND "private_providerAccountId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("providerAccountId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_providerEmail" IS NOT NULL AND "private_providerEmail" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("providerEmail" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_encryptedRefreshToken" IS NOT NULL AND "private_encryptedRefreshToken" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("encryptedRefreshToken" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_grantedScopes" IS NOT NULL AND "private_grantedScopes" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("grantedScopes") = 0)
  AND ("private_scanPhase" IS NOT NULL AND "private_scanPhase" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("scanPhase" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_lastScanError" IS NOT NULL AND "private_lastScanError" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("lastScanError" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_sourceKey" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_externalMessageId" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_externalAttachmentId" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_filename" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_sender" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_subject" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_receivedAt" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_suggestedCategory" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_suggestedDocumentType" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_relevanceReason" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_relevanceScore" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_legitimacyReason" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_legitimacyScore" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_reviewRequired" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_matchedSignals" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_rejectedSignals" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_ignoredReason" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD COLUMN "private_externalPartId" TEXT;
ALTER TABLE "ExternalDocumentCandidate" ADD CONSTRAINT "ExternalDocumentCandidate_private_v2" CHECK (
  ("private_sourceKey" IS NOT NULL AND "private_sourceKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_externalMessageId" IS NOT NULL AND "private_externalMessageId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("externalMessageId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_externalAttachmentId" IS NOT NULL AND "private_externalAttachmentId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("externalAttachmentId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_filename" IS NOT NULL AND "private_filename" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("filename" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sender" IS NOT NULL AND "private_sender" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sender" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_subject" IS NOT NULL AND "private_subject" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("subject" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_receivedAt" IS NOT NULL AND "private_receivedAt" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("receivedAt" = TIMESTAMP '1970-01-01 00:00:00')
  AND ("private_suggestedCategory" IS NOT NULL AND "private_suggestedCategory" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("suggestedCategory" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_suggestedDocumentType" IS NOT NULL AND "private_suggestedDocumentType" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("suggestedDocumentType" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_relevanceReason" IS NOT NULL AND "private_relevanceReason" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("relevanceReason" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_relevanceScore" IS NOT NULL AND "private_relevanceScore" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("relevanceScore" = 0)
  AND ("private_legitimacyReason" IS NOT NULL AND "private_legitimacyReason" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("legitimacyReason" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_legitimacyScore" IS NOT NULL AND "private_legitimacyScore" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("legitimacyScore" = 0)
  AND ("private_reviewRequired" IS NOT NULL AND "private_reviewRequired" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("reviewRequired" = false)
  AND ("private_matchedSignals" IS NOT NULL AND "private_matchedSignals" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("matchedSignals") = 0)
  AND ("private_rejectedSignals" IS NOT NULL AND "private_rejectedSignals" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("rejectedSignals") = 0)
  AND ("private_ignoredReason" IS NOT NULL AND "private_ignoredReason" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("ignoredReason" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_externalPartId" IS NOT NULL AND "private_externalPartId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("externalPartId" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "UserIdentityProfile" ADD COLUMN "private_fullName" TEXT;
ALTER TABLE "UserIdentityProfile" ADD COLUMN "private_normalizedNameHash" TEXT;
ALTER TABLE "UserIdentityProfile" ADD COLUMN "private_dateOfBirth" TEXT;
ALTER TABLE "UserIdentityProfile" ADD COLUMN "private_dateOfBirthHash" TEXT;
ALTER TABLE "UserIdentityProfile" ADD COLUMN "private_documentNumber" TEXT;
ALTER TABLE "UserIdentityProfile" ADD COLUMN "private_verified" TEXT;
ALTER TABLE "UserIdentityProfile" ADD CONSTRAINT "UserIdentityProfile_private_v2" CHECK (
  ("private_fullName" IS NOT NULL AND "private_fullName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("fullName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_normalizedNameHash" IS NOT NULL AND "private_normalizedNameHash" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("normalizedNameHash" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_dateOfBirth" IS NOT NULL AND "private_dateOfBirth" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dateOfBirth" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_dateOfBirthHash" IS NOT NULL AND "private_dateOfBirthHash" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dateOfBirthHash" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_documentNumber" IS NOT NULL AND "private_documentNumber" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("documentNumber" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_verified" IS NOT NULL AND "private_verified" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("verified" = false)
) NOT VALID;
ALTER TABLE "TemporaryUpload" ADD COLUMN "private_originalName" TEXT;
ALTER TABLE "TemporaryUpload" ADD COLUMN "private_contentHash" TEXT;
ALTER TABLE "TemporaryUpload" ADD COLUMN "private_sourceMessageId" TEXT;
ALTER TABLE "TemporaryUpload" ADD COLUMN "private_sourceAttachmentId" TEXT;
ALTER TABLE "TemporaryUpload" ADD COLUMN "private_wrappedKey" TEXT;
ALTER TABLE "TemporaryUpload" ADD COLUMN "private_originalSha256" TEXT;
ALTER TABLE "TemporaryUpload" ADD CONSTRAINT "TemporaryUpload_private_v2" CHECK (
  ("private_originalName" IS NOT NULL AND "private_originalName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("originalName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_contentHash" IS NOT NULL AND "private_contentHash" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("contentHash" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceMessageId" IS NOT NULL AND "private_sourceMessageId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceMessageId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceAttachmentId" IS NOT NULL AND "private_sourceAttachmentId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceAttachmentId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_wrappedKey" IS NOT NULL AND "private_wrappedKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("wrappedKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_originalSha256" IS NOT NULL AND "private_originalSha256" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("originalSha256" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "private_verificationId" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "private_referenceId" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "private_statusMessage" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "private_consentUrl" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "private_redirectUrl" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "private_requestedDocuments" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "private_availableDocuments" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD CONSTRAINT "digilocker_consent_sessions_private_v2" CHECK (
  ("private_verificationId" IS NOT NULL AND "private_verificationId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("verificationId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_referenceId" IS NOT NULL AND "private_referenceId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("referenceId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_statusMessage" IS NOT NULL AND "private_statusMessage" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("statusMessage" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_consentUrl" IS NOT NULL AND "private_consentUrl" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("consentUrl" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_redirectUrl" IS NOT NULL AND "private_redirectUrl" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("redirectUrl" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_requestedDocuments" IS NOT NULL AND "private_requestedDocuments" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("requestedDocuments") = 0)
  AND ("private_availableDocuments" IS NOT NULL AND "private_availableDocuments" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("availableDocuments") = 0)
) NOT VALID;
ALTER TABLE "push_subscriptions" ADD COLUMN "private_endpoint" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN "private_p256dh" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN "private_auth" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN "private_userAgent" TEXT;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_private_v2" CHECK (
  ("private_endpoint" IS NOT NULL AND "private_endpoint" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("endpoint" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_p256dh" IS NOT NULL AND "private_p256dh" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("p256dh" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_auth" IS NOT NULL AND "private_auth" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("auth" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_userAgent" IS NOT NULL AND "private_userAgent" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("userAgent" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "account_change_otps" ADD COLUMN "private_newEmail" TEXT;
ALTER TABLE "account_change_otps" ADD CONSTRAINT "account_change_otps_private_v2" CHECK (
  ("private_newEmail" IS NOT NULL AND "private_newEmail" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("newEmail" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
