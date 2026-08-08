CREATE TABLE "plans" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

INSERT INTO "plans" ("id", "code", "name")
VALUES
  ('plan_freemium', 'FREEMIUM', 'Freemium'),
  ('plan_family', 'FAMILY', 'Family'),
  ('plan_plus', 'PLUS', 'Plus')
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "plan_rules" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "memberLimit" INTEGER NOT NULL,
  "storageBytes" BIGINT NOT NULL,
  "unknownPackSearchLimit" INTEGER NOT NULL,
  "homeAccess" BOOLEAN NOT NULL DEFAULT true,
  "packagesAccess" BOOLEAN NOT NULL DEFAULT true,
  "documentsAccess" BOOLEAN NOT NULL DEFAULT true,
  "healthAccess" BOOLEAN NOT NULL DEFAULT false,
  "wealthAccess" BOOLEAN NOT NULL DEFAULT false,
  "trustCenterAccess" BOOLEAN NOT NULL DEFAULT false,
  "emergencyAccess" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_rules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plan_rules_planId_key" ON "plan_rules"("planId");
CREATE INDEX "plan_rules_planId_idx" ON "plan_rules"("planId");

INSERT INTO "plan_rules" (
  "id", "planId", "memberLimit", "storageBytes", "unknownPackSearchLimit",
  "homeAccess", "packagesAccess", "documentsAccess", "healthAccess",
  "wealthAccess", "trustCenterAccess", "emergencyAccess"
)
VALUES
  ('rule_freemium', 'plan_freemium', 0, 1073741824, 1, true, true, true, false, false, false, false),
  ('rule_family', 'plan_family', 4, 10737418240, 10, true, true, true, true, false, true, true),
  ('rule_plus', 'plan_plus', 8, 53687091200, 30, true, true, true, true, true, true, true)
ON CONFLICT ("planId") DO UPDATE SET
  "memberLimit" = EXCLUDED."memberLimit",
  "storageBytes" = EXCLUDED."storageBytes",
  "unknownPackSearchLimit" = EXCLUDED."unknownPackSearchLimit",
  "homeAccess" = EXCLUDED."homeAccess",
  "packagesAccess" = EXCLUDED."packagesAccess",
  "documentsAccess" = EXCLUDED."documentsAccess",
  "healthAccess" = EXCLUDED."healthAccess",
  "wealthAccess" = EXCLUDED."wealthAccess",
  "trustCenterAccess" = EXCLUDED."trustCenterAccess",
  "emergencyAccess" = EXCLUDED."emergencyAccess",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "User" ADD COLUMN "planId" TEXT NOT NULL DEFAULT 'plan_freemium';
UPDATE "User" SET "planId" = 'plan_freemium' WHERE "planId" IS NULL;
CREATE INDEX "User_planId_idx" ON "User"("planId");
ALTER TABLE "User" ADD CONSTRAINT "User_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "plan_usage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "unknownPackSearches" INTEGER NOT NULL DEFAULT 0,
  "storageBytesUsed" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plan_usage_userId_period_key" ON "plan_usage"("userId", "period");
CREATE INDEX "plan_usage_userId_idx" ON "plan_usage"("userId");

CREATE TABLE "trust_access_types" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_access_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trust_access_types_code_key" ON "trust_access_types"("code");

INSERT INTO "trust_access_types" ("id", "code", "name", "description")
VALUES
  ('trust_access_owner', 'OWNER', 'Owner', 'Implicit LifePack owner with full control within their plan.'),
  ('trust_access_view_only', 'VIEW_ONLY', 'View only', 'Can view explicitly shared content but cannot edit or manage members.'),
  ('trust_access_family_member', 'FAMILY_MEMBER', 'Family member', 'Ongoing family access to content explicitly permitted by the owner.'),
  ('trust_access_emergency', 'EMERGENCY_ACCESS', 'Emergency access', 'Restricted access intended for emergencies.')
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "trust_access_rules" (
  "id" TEXT NOT NULL,
  "accessTypeId" TEXT NOT NULL,
  "canViewDocuments" BOOLEAN NOT NULL DEFAULT false,
  "canViewHealth" BOOLEAN NOT NULL DEFAULT false,
  "canViewWealth" BOOLEAN NOT NULL DEFAULT false,
  "canDownload" BOOLEAN NOT NULL DEFAULT false,
  "canEdit" BOOLEAN NOT NULL DEFAULT false,
  "canManageMembers" BOOLEAN NOT NULL DEFAULT false,
  "emergencyOnly" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_access_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trust_access_rules_accessTypeId_fkey" FOREIGN KEY ("accessTypeId") REFERENCES "trust_access_types"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "trust_access_rules_accessTypeId_key" ON "trust_access_rules"("accessTypeId");

INSERT INTO "trust_access_rules" (
  "id", "accessTypeId", "canViewDocuments", "canViewHealth", "canViewWealth",
  "canDownload", "canEdit", "canManageMembers", "emergencyOnly"
)
VALUES
  ('trust_rule_owner', 'trust_access_owner', true, true, true, true, true, true, false),
  ('trust_rule_view_only', 'trust_access_view_only', true, false, false, false, false, false, false),
  ('trust_rule_family_member', 'trust_access_family_member', true, true, false, true, false, false, false),
  ('trust_rule_emergency', 'trust_access_emergency', true, true, false, true, false, false, true)
ON CONFLICT ("accessTypeId") DO UPDATE SET
  "canViewDocuments" = EXCLUDED."canViewDocuments",
  "canViewHealth" = EXCLUDED."canViewHealth",
  "canViewWealth" = EXCLUDED."canViewWealth",
  "canDownload" = EXCLUDED."canDownload",
  "canEdit" = EXCLUDED."canEdit",
  "canManageMembers" = EXCLUDED."canManageMembers",
  "emergencyOnly" = EXCLUDED."emergencyOnly",
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "trust_members" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "memberUserId" TEXT,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "relation" TEXT NOT NULL,
  "customRelation" TEXT,
  "dateOfBirth" TEXT NOT NULL,
  "bloodGroup" TEXT NOT NULL,
  "accessTypeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INVITED',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "invitationEmailSentAt" TIMESTAMP(3),
  "invitationEmailLastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trust_members_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trust_members_memberUserId_fkey" FOREIGN KEY ("memberUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "trust_members_accessTypeId_fkey" FOREIGN KEY ("accessTypeId") REFERENCES "trust_access_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "trust_members_ownerUserId_status_idx" ON "trust_members"("ownerUserId", "status");
CREATE INDEX "trust_members_memberUserId_status_idx" ON "trust_members"("memberUserId", "status");
CREATE UNIQUE INDEX "trust_members_ownerUserId_email_status_key" ON "trust_members"("ownerUserId", "email", "status");

CREATE TABLE "trust_member_permissions" (
  "id" TEXT NOT NULL,
  "trustMemberId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT false,
  "canDownload" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_member_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trust_member_permissions_trustMemberId_fkey" FOREIGN KEY ("trustMemberId") REFERENCES "trust_members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "trust_member_permissions_trustMemberId_module_key" ON "trust_member_permissions"("trustMemberId", "module");
CREATE INDEX "trust_member_permissions_trustMemberId_idx" ON "trust_member_permissions"("trustMemberId");
