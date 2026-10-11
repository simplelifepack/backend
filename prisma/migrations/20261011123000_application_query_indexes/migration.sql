-- Application-wide query indexes for the highest-frequency Readiness screens.
-- Keep these aligned with common WHERE + ORDER BY patterns in the Prisma services.

-- Documents list/search/bootstrap paths mostly load active documents for one owner by recency.
CREATE INDEX "Document_ownerProfileId_deletedAt_updatedAt_idx"
  ON "Document"("ownerProfileId", "deletedAt", "updatedAt" DESC);

CREATE INDEX "Document_ownerProfileId_deletedAt_createdAt_idx"
  ON "Document"("ownerProfileId", "deletedAt", "createdAt" DESC);

-- Identity bootstrap scans verified self identity documents in created order.
CREATE INDEX "Document_identity_bootstrap_idx"
  ON "Document"("ownerProfileId", "targetProfileId", "category", "classificationStatus", "ownershipStatus", "deletedAt", "createdAt");

-- Package catalogue/admin queries filter active shared packages and sort by category/title.
CREATE INDEX "ReadinessPack_deletedAt_createdBy_category_title_idx"
  ON "ReadinessPack"("deletedAt", "createdBy", "category", "title");

-- Package detail/list loads active requirements for a package sorted by sortOrder.
CREATE INDEX "Requirement_packId_deletedAt_sortOrder_idx"
  ON "Requirement"("packId", "deletedAt", "sortOrder");

-- Auth/session maintenance frequently revokes active refresh tokens for a user.
CREATE INDEX "RefreshToken_userId_revokedAt_idx"
  ON "RefreshToken"("userId", "revokedAt");

-- OTP password-reset flow finds the newest active, unexpired token for a user.
CREATE INDEX "PasswordResetToken_userId_usedAt_expiresAt_createdAt_idx"
  ON "PasswordResetToken"("userId", "usedAt", "expiresAt", "createdAt" DESC);

-- Custom package queue deduplication and worker lease cleanup.
CREATE INDEX "CustomPackageGenerationJob_userId_dedupeKey_status_createdAt_idx"
  ON "CustomPackageGenerationJob"("userId", "dedupeKey", "status", "createdAt" DESC);

CREATE INDEX "CustomPackageGenerationJob_status_leaseExpiresAt_idx"
  ON "CustomPackageGenerationJob"("status", "leaseExpiresAt");

-- Trust Center list views order owner/member relationships inside status filters.
CREATE INDEX "trust_members_owner_status_created_idx"
  ON "trust_members"("ownerUserId", "status", "createdAt" DESC);

CREATE INDEX "trust_members_member_status_accepted_idx"
  ON "trust_members"("memberUserId", "status", "acceptedAt" DESC);

-- Wealth list/dashboard loads one user's records by most recent update.
CREATE INDEX "WealthRecord_ownerUserId_updatedAt_idx"
  ON "WealthRecord"("ownerUserId", "updatedAt" DESC);

-- Global search and profile pages list health records/profiles by recency.
CREATE INDEX "health_members_user_updated_idx"
  ON "health_members"("userId", "updatedAt" DESC);

CREATE INDEX "health_documents_user_documentDate_created_idx"
  ON "health_documents"("userId", "documentDate" DESC, "createdAt" DESC);

CREATE INDEX "health_medications_user_updated_idx"
  ON "health_medications"("userId", "updatedAt" DESC);

CREATE INDEX "health_medications_user_member_created_idx"
  ON "health_medications"("userId", "memberId", "createdAt" DESC);

CREATE INDEX "health_medications_user_status_runsOut_idx"
  ON "health_medications"("userId", "status", "runsOutAt");

CREATE INDEX "health_reminders_user_status_dueDate_idx"
  ON "health_reminders"("userId", "status", "dueDate");

-- Temporary upload cleanup scans active uploads and stale status rows.
CREATE INDEX "TemporaryUpload_status_expiresAt_idx"
  ON "TemporaryUpload"("status", "expiresAt");
