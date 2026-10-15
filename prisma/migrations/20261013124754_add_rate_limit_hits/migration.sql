-- DropIndex
DROP INDEX "CustomPackageGenerationJob_status_leaseExpiresAt_idx";

-- DropIndex
DROP INDEX "CustomPackageGenerationJob_userId_dedupeKey_status_createdAt_id";

-- DropIndex
DROP INDEX "Document_identity_bootstrap_idx";

-- DropIndex
DROP INDEX "Document_ownerProfileId_deletedAt_createdAt_idx";

-- DropIndex
DROP INDEX "Document_ownerProfileId_deletedAt_updatedAt_idx";

-- DropIndex
DROP INDEX "PasswordResetToken_userId_usedAt_expiresAt_createdAt_idx";

-- DropIndex
DROP INDEX "ReadinessPack_deletedAt_createdBy_category_title_idx";

-- DropIndex
DROP INDEX "RefreshToken_userId_revokedAt_idx";

-- DropIndex
DROP INDEX "Requirement_packId_deletedAt_sortOrder_idx";

-- DropIndex
DROP INDEX "TemporaryUpload_status_expiresAt_idx";

-- DropIndex
DROP INDEX "health_documents_user_documentDate_created_idx";

-- DropIndex
DROP INDEX "health_medications_user_member_created_idx";

-- DropIndex
DROP INDEX "health_medications_user_status_runsOut_idx";

-- DropIndex
DROP INDEX "health_medications_user_updated_idx";

-- DropIndex
DROP INDEX "health_members_user_updated_idx";

-- DropIndex
DROP INDEX "health_reminders_user_status_dueDate_idx";

-- DropIndex
DROP INDEX "trust_members_member_status_accepted_idx";

-- DropIndex
DROP INDEX "trust_members_owner_status_created_idx";

-- DropIndex
DROP INDEX "wealth_records_ownerUserId_updatedAt_idx";

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "key" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_resetAt_idx" ON "rate_limit_hits"("resetAt");
