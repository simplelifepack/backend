const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const migration = fs.readFileSync(process.argv[2] || 'prisma/migrations/20260907090000_account_usage_limits/migration.sql', 'utf8').replace(/^BEGIN;|^COMMIT;/gm, '');
const sql = `BEGIN;
CREATE TEMP TABLE before_counts AS SELECT (SELECT count(*) FROM "User") users, (SELECT count(*) FROM "Document") documents;
${migration}
DO $$ BEGIN
 IF (SELECT count(*) FROM "User") <> (SELECT users FROM before_counts) OR (SELECT count(*) FROM "Document") <> (SELECT documents FROM before_counts) THEN RAISE EXCEPTION 'Data count changed'; END IF;
 IF EXISTS (SELECT 1 FROM "User" WHERE "accountTier" <> 'free') THEN RAISE EXCEPTION 'Default tier incorrect'; END IF;
END $$;
ROLLBACK;`;
const result = spawnSync('docker', ['compose','exec','-T','postgres','psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','lifepack'], { input: sql, encoding: 'utf8' });
console.log(result.stdout); if (result.status) console.error(result.stderr); process.exitCode = result.status ?? 1;
