-- Application-wide query indexes for the highest-frequency Readiness screens.
-- Keep these aligned with common WHERE + ORDER BY patterns in the Prisma services.
-- IF NOT EXISTS + table guards make this safe after a partially failed deploy.

CREATE INDEX IF NOT EXISTS "Document_ownerProfileId_deletedAt_updatedAt_idx"
  ON "Document"("ownerProfileId", "deletedAt", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "Document_ownerProfileId_deletedAt_createdAt_idx"
  ON "Document"("ownerProfileId", "deletedAt", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Document_identity_bootstrap_idx"
  ON "Document"("ownerProfileId", "targetProfileId", "category", "classificationStatus", "ownershipStatus", "deletedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "ReadinessPack_deletedAt_createdBy_category_title_idx"
  ON "ReadinessPack"("deletedAt", "createdBy", "category", "title");

CREATE INDEX IF NOT EXISTS "Requirement_packId_deletedAt_sortOrder_idx"
  ON "Requirement"("packId", "deletedAt", "sortOrder");

CREATE INDEX IF NOT EXISTS "RefreshToken_userId_revokedAt_idx"
  ON "RefreshToken"("userId", "revokedAt");

CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_usedAt_expiresAt_createdAt_idx"
  ON "PasswordResetToken"("userId", "usedAt", "expiresAt", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CustomPackageGenerationJob_userId_dedupeKey_status_createdAt_idx"
  ON "CustomPackageGenerationJob"("userId", "dedupeKey", "status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CustomPackageGenerationJob_status_leaseExpiresAt_idx"
  ON "CustomPackageGenerationJob"("status", "leaseExpiresAt");

DO $$
BEGIN
  IF to_regclass('public.trust_members') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "trust_members_owner_status_created_idx" ON "trust_members"("ownerUserId", "status", "createdAt" DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "trust_members_member_status_accepted_idx" ON "trust_members"("memberUserId", "status", "acceptedAt" DESC)';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.wealth_records') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "wealth_records_ownerUserId_updatedAt_idx" ON "wealth_records"("ownerUserId", "updatedAt" DESC)';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.health_members') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "health_members_user_updated_idx" ON "health_members"("userId", "updatedAt" DESC)';
  END IF;
  IF to_regclass('public.health_documents') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "health_documents_user_documentDate_created_idx" ON "health_documents"("userId", "documentDate" DESC, "createdAt" DESC)';
  END IF;
  IF to_regclass('public.health_medications') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "health_medications_user_updated_idx" ON "health_medications"("userId", "updatedAt" DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "health_medications_user_member_created_idx" ON "health_medications"("userId", "memberId", "createdAt" DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "health_medications_user_status_runsOut_idx" ON "health_medications"("userId", "status", "runsOutAt")';
  END IF;
  IF to_regclass('public.health_reminders') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "health_reminders_user_status_dueDate_idx" ON "health_reminders"("userId", "status", "dueDate")';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TemporaryUpload_status_expiresAt_idx"
  ON "TemporaryUpload"("status", "expiresAt");
