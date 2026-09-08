BEGIN;
-- Retain accounting for replaced objects until physical deletion succeeds.
CREATE TABLE "storage_cleanup" (
  "storageKey" TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "sizeBytes" BIGINT NOT NULL CHECK ("sizeBytes" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "storage_cleanup_ownerUserId_idx" ON "storage_cleanup"("ownerUserId");
COMMIT;
