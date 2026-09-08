-- Forward-only cleanup. Historical migration files remain untouched.
-- No CASCADE: unexpected dependencies must abort rather than destroy application data.
BEGIN;
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "usage";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_planId_fkey";
DROP INDEX IF EXISTS "User_planId_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "planId";
DROP TABLE IF EXISTS "plan_usage";
DROP TABLE IF EXISTS "plan_rules";
DROP TABLE IF EXISTS "plans";
DROP TYPE IF EXISTS "SubscriptionTier";
DROP TYPE IF EXISTS "BillingInterval";

-- Compatibility: rename persisted form metadata without copying or dropping rows.
DO $$
DECLARE old_name text; new_name text; item record;
BEGIN
  FOREACH old_name IN ARRAY ARRAY['lifepack_form_categories','lifepack_form_subtypes','lifepack_form_fields'] LOOP
    new_name := replace(old_name, 'lifepack_', 'readiness_');
    IF to_regclass(format('public.%I', old_name)) IS NOT NULL THEN
      IF to_regclass(format('public.%I', new_name)) IS NOT NULL THEN
        RAISE EXCEPTION 'Both old and new form tables exist; reconcile before migrating';
      END IF;
      EXECUTE format('ALTER TABLE %I RENAME TO %I', old_name, new_name);
    END IF;
    FOR item IN SELECT conname FROM pg_constraint WHERE conrelid = to_regclass(format('public.%I', new_name)) AND conname LIKE 'lifepack_%' LOOP
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', new_name, item.conname, replace(item.conname, 'lifepack_', 'readiness_'));
    END LOOP;
    FOR item IN SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = new_name AND indexname LIKE 'lifepack_%' LOOP
      EXECUTE format('ALTER INDEX %I RENAME TO %I', item.indexname, replace(item.indexname, 'lifepack_', 'readiness_'));
    END LOOP;
  END LOOP;
END $$;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryVerifier" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryCreatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RefreshToken" ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 0;
-- Compatibility: migrate display copy only, never URLs, provider codes, or user documents.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('ReadinessPack','Requirement','readiness_form_categories','readiness_form_subtypes','readiness_form_fields')
      AND column_name IN ('label','description','title','subtitle','sourceName','sourceTitle','placeholder')
      AND data_type = 'text'
  LOOP
    EXECUTE format('UPDATE %I SET %I = regexp_replace(regexp_replace(%I, %L, %L, %L), %L, %L, %L) WHERE %I ~* %L',
      item.table_name, item.column_name, item.column_name, 'life[-_ ]?pack( ai)?|readiness ai', 'Readiness', 'gi',
      'AI[- ]generated|Powered by AI', 'Result', 'gi', item.column_name, 'life[-_ ]?pack|readiness ai|AI[- ]generated|Powered by AI');
  END LOOP;
END $$;
COMMIT;
