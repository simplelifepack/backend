ALTER TABLE "ReadinessPack"
ADD COLUMN "subtitle" TEXT,
ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'curated',
ADD COLUMN "sourceName" TEXT,
ADD COLUMN "sourceTitle" TEXT,
ADD COLUMN "sourceUrl" TEXT,
ADD COLUMN "lastCheckedAt" TIMESTAMP(3);

UPDATE "ReadinessPack"
SET
  "title" = 'Canada visa',
  "subtitle" = 'Visitor visa',
  "sourceType" = 'curated',
  "sourceName" = 'IRCC',
  "sourceTitle" = 'IRCC visitor visa document checklist',
  "sourceUrl" = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html',
  "lastCheckedAt" = '2026-07-25T00:00:00.000Z'
WHERE "slug" = 'canada-visa';
