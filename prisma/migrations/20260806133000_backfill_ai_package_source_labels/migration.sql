UPDATE "ReadinessPack"
SET
  "sourceType" = 'ai',
  "sourceName" = COALESCE("sourceName", 'LifePack AI'),
  "sourceTitle" = COALESCE("sourceTitle", 'LifePack AI generated package')
WHERE "createdBy" = 'ai';
