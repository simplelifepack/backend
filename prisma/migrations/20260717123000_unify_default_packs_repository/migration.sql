ALTER TABLE "ReadinessPack" RENAME COLUMN "searchableKeywords" TO "keywords";
UPDATE "ReadinessPack" SET "createdBy" = 'seed' WHERE "createdBy" = 'system';
ALTER TABLE "ReadinessPack" ALTER COLUMN "createdBy" SET DEFAULT 'seed';
