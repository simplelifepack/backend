const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const migration = fs.readFileSync('prisma/migrations/20260906090000_remove_subscriptions_and_rebrand/migration.sql','utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const sql = `BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE readiness_before (table_name text, row_count bigint) ON COMMIT DROP;
DO $$ DECLARE item record; n bigint; BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('subscriptions','usage','plans','plan_rules','plan_usage') LOOP
  EXECUTE format('SELECT count(*) FROM %I',item.tablename) INTO n;
  INSERT INTO readiness_before VALUES (replace(item.tablename,'lifepack_form_','readiness_form_'),n);
 END LOOP;
END $$;
${migration}
${migration}
DO $$ DECLARE item record; n bigint; BEGIN
 FOR item IN SELECT * FROM readiness_before LOOP
  EXECUTE format('SELECT count(*) FROM %I',item.table_name) INTO n;
  IF n <> item.row_count THEN RAISE EXCEPTION 'Application row count changed'; END IF;
 END LOOP;
 IF to_regclass('public.subscriptions') IS NOT NULL OR to_regclass('public.usage') IS NOT NULL THEN RAISE EXCEPTION 'Billing schema remains'; END IF;
END $$;
ROLLBACK;`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'readiness-migration-'));
try {
 const file = path.join(directory,'test.sql'); fs.writeFileSync(file,sql);
 const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js','db','execute','--file',file,'--schema','prisma/schema.prisma'],{stdio:'inherit'});
 process.exitCode = result.status ?? 1;
 if (!process.exitCode) console.log('Migration applied twice inside a rolled-back transaction; unrelated table row counts preserved.');
} finally { fs.rmSync(directory,{recursive:true,force:true}); }
