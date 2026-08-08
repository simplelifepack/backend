DO $$
BEGIN
  CREATE TYPE "TrustMemberAccessType" AS ENUM ('VIEW_ONLY', 'FAMILY_MEMBER', 'EMERGENCY_ACCESS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TrustMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TrustRelation" AS ENUM ('SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'GUARDIAN', 'RELATIVE', 'FRIEND', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TrustPermissionModule" AS ENUM ('DOCUMENTS', 'HEALTH', 'WEALTH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "memberLimit" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "storageBytes" BIGINT NOT NULL DEFAULT 1073741824,
  ADD COLUMN IF NOT EXISTS "unknownPackSearchLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "homeAccess" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "packagesAccess" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "documentsAccess" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "healthAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "wealthAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "trustCenterAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "emergencyAccess" BOOLEAN NOT NULL DEFAULT false;

UPDATE "plans" AS p
SET
  "memberLimit" = r."memberLimit",
  "storageBytes" = r."storageBytes",
  "unknownPackSearchLimit" = r."unknownPackSearchLimit",
  "homeAccess" = r."homeAccess",
  "packagesAccess" = r."packagesAccess",
  "documentsAccess" = r."documentsAccess",
  "healthAccess" = r."healthAccess",
  "wealthAccess" = r."wealthAccess",
  "trustCenterAccess" = r."trustCenterAccess",
  "emergencyAccess" = r."emergencyAccess",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "plan_rules" AS r
WHERE r."planId" = p."id";

INSERT INTO "plans" (
  "id", "code", "name", "isActive", "memberLimit", "storageBytes",
  "unknownPackSearchLimit", "homeAccess", "packagesAccess", "documentsAccess",
  "healthAccess", "wealthAccess", "trustCenterAccess", "emergencyAccess",
  "createdAt", "updatedAt"
)
VALUES
  ('plan_freemium', 'FREEMIUM', 'Freemium', true, 0, 1073741824, 1, true, true, true, false, false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_family', 'FAMILY', 'Family', true, 4, 10737418240, 10, true, true, true, true, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_plus', 'PLUS', 'Plus', true, 8, 53687091200, 30, true, true, true, true, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "isActive" = EXCLUDED."isActive",
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

UPDATE "User" SET "planId" = 'plan_freemium' WHERE "planId" IS NULL;

ALTER TABLE "trust_members"
  ADD COLUMN IF NOT EXISTS "accessType" "TrustMemberAccessType";

UPDATE "trust_members" AS tm
SET "accessType" = CASE tat."code"
  WHEN 'FAMILY_MEMBER' THEN 'FAMILY_MEMBER'::"TrustMemberAccessType"
  WHEN 'EMERGENCY_ACCESS' THEN 'EMERGENCY_ACCESS'::"TrustMemberAccessType"
  ELSE 'VIEW_ONLY'::"TrustMemberAccessType"
END
FROM "trust_access_types" AS tat
WHERE tm."accessTypeId" = tat."id";

UPDATE "trust_members"
SET "accessType" = 'VIEW_ONLY'::"TrustMemberAccessType"
WHERE "accessType" IS NULL;

ALTER TABLE "trust_members"
  ALTER COLUMN "accessType" SET NOT NULL,
  ALTER COLUMN "relation" TYPE "TrustRelation" USING "relation"::"TrustRelation",
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TrustMemberStatus" USING "status"::"TrustMemberStatus",
  ALTER COLUMN "status" SET DEFAULT 'INVITED'::"TrustMemberStatus";

ALTER TABLE "trust_member_permissions"
  ALTER COLUMN "module" TYPE "TrustPermissionModule" USING "module"::"TrustPermissionModule";

ALTER TABLE "trust_members" DROP CONSTRAINT IF EXISTS "trust_members_accessTypeId_fkey";
ALTER TABLE "trust_members" DROP COLUMN IF EXISTS "accessTypeId";
ALTER TABLE "trust_members" DROP COLUMN IF EXISTS "invitationEmailSentAt";
ALTER TABLE "trust_members" DROP COLUMN IF EXISTS "invitationEmailLastError";

DROP TABLE IF EXISTS "trust_access_rules";
DROP TABLE IF EXISTS "trust_access_types";
DROP TABLE IF EXISTS "plan_rules";
