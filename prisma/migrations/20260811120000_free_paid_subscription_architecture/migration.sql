DO $$
BEGIN
  CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
  "billingInterval" "BillingInterval",
  "status" TEXT NOT NULL DEFAULT 'active',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "provider" TEXT,
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "subscriptions_userId_status_idx" ON "subscriptions"("userId", "status");
CREATE INDEX IF NOT EXISTS "subscriptions_providerSubscriptionId_idx" ON "subscriptions"("providerSubscriptionId");

ALTER TABLE "subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_userId_fkey";

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "usage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "aiPackSearchesUsed" INTEGER NOT NULL DEFAULT 0,
  "storageBytesUsed" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "usage_userId_periodStart_key" ON "usage"("userId", "periodStart");
CREATE INDEX IF NOT EXISTS "usage_userId_periodStart_periodEnd_idx" ON "usage"("userId", "periodStart", "periodEnd");

ALTER TABLE "usage"
  DROP CONSTRAINT IF EXISTS "usage_userId_fkey";

ALTER TABLE "usage"
  ADD CONSTRAINT "usage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "subscriptions" (
  "id", "userId", "tier", "billingInterval", "status", "createdAt", "updatedAt"
)
SELECT
  'sub_' || u."id",
  u."id",
  CASE
    WHEN upper(coalesce(p."code", 'FREEMIUM')) IN ('FAMILY', 'PLUS', 'PREMIUM', 'PAID') THEN 'PAID'::"SubscriptionTier"
    ELSE 'FREE'::"SubscriptionTier"
  END,
  NULL,
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
LEFT JOIN "plans" p ON p."id" = u."planId"
WHERE EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_name = 'User' AND column_name = 'planId'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "subscriptions" (
  "id", "userId", "tier", "billingInterval", "status", "createdAt", "updatedAt"
)
SELECT
  'sub_' || u."id",
  u."id",
  'FREE'::"SubscriptionTier",
  NULL,
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."userId" = u."id");

INSERT INTO "usage" (
  "id", "userId", "periodStart", "periodEnd", "aiPackSearchesUsed", "storageBytesUsed", "createdAt", "updatedAt"
)
SELECT
  'usage_' || pu."id",
  pu."userId",
  to_date(pu."period" || '-01', 'YYYY-MM-DD')::timestamp,
  (to_date(pu."period" || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp,
  pu."unknownPackSearches",
  pu."storageBytesUsed",
  pu."createdAt",
  pu."updatedAt"
FROM "plan_usage" pu
WHERE EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_name = 'plan_usage'
)
ON CONFLICT ("userId", "periodStart") DO UPDATE SET
  "aiPackSearchesUsed" = EXCLUDED."aiPackSearchesUsed",
  "storageBytesUsed" = EXCLUDED."storageBytesUsed",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_planId_fkey";
DROP INDEX IF EXISTS "User_planId_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "planId";

DROP TABLE IF EXISTS "plan_usage";
DROP TABLE IF EXISTS "plan_rules";
DROP TABLE IF EXISTS "plans";
