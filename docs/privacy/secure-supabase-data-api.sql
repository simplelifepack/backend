-- Apply only after the complete database/object backup has passed an isolated
-- restore test and maintenance is still active. Data API must remain disabled.
-- The backend uses its own authentication and direct PostgreSQL connection;
-- no Supabase anon/authenticated role is an application data access path.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE target record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND pg_get_userbyid(c.relowner)<>'postgres'
  ) THEN
    RAISE EXCEPTION 'Unexpected public table owner; review access before applying';
  END IF;
  FOR target IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',target.relname);
  END LOOP;
END $$;

-- Removing PUBLIC grants is necessary: anon/authenticated inherit PUBLIC.
-- Existing row policies are preserved; no invented auth.uid() ownership policy
-- is added to this independently authenticated application.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (
      NOT c.relrowsecurity OR
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR
      has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
    )
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (
      has_function_privilege('anon',p.oid,'EXECUTE') OR
      has_function_privilege('authenticated',p.oid,'EXECUTE')
    )
  ) THEN
    RAISE EXCEPTION 'Anonymous/authenticated access remains; security change rolled back';
  END IF;
END $$;
COMMIT;
