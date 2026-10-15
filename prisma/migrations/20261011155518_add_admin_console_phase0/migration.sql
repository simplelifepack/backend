-- Admin console (Phase 0): separate admin identity, passkeys, sessions, audit log.
-- See ../../../readiness-admin-console.html for the full design.
--
-- Note: `prisma migrate dev --create-only` also generated a batch of DROP INDEX
-- statements against unrelated tables (Document, RefreshToken, health_*, etc).
-- That's pre-existing drift between schema.prisma's index annotations and the
-- already-applied migration history, not something this change should touch —
-- removed by hand. If you regenerate this file, strip those again before applying.

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('support', 'catalogue', 'ops_security', 'owner');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "googleSub" TEXT,
    "disabledAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_passkeys" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "signCount" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "admin_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_webauthn_challenges" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "stepUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "reason" TEXT,
    "diff" JSONB,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_googleSub_key" ON "admin_users"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "admin_passkeys_credentialId_key" ON "admin_passkeys"("credentialId");

-- CreateIndex
CREATE INDEX "admin_passkeys_adminId_idx" ON "admin_passkeys"("adminId");

-- CreateIndex
CREATE INDEX "admin_webauthn_challenges_adminId_type_idx" ON "admin_webauthn_challenges"("adminId", "type");

-- CreateIndex
CREATE INDEX "admin_webauthn_challenges_expiresAt_idx" ON "admin_webauthn_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "admin_sessions_adminId_idx" ON "admin_sessions"("adminId");

-- CreateIndex
CREATE INDEX "admin_audit_log_adminId_at_idx" ON "admin_audit_log"("adminId", "at");

-- CreateIndex
CREATE INDEX "admin_audit_log_action_at_idx" ON "admin_audit_log"("action", "at");

-- CreateIndex
CREATE INDEX "admin_audit_log_targetType_targetId_idx" ON "admin_audit_log"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "admin_passkeys" ADD CONSTRAINT "admin_passkeys_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
