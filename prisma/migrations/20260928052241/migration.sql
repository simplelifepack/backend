DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'DocumentFile'
      AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "DocumentFile" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
END $$;
