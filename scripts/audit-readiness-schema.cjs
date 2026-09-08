require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs');
const prisma = new PrismaClient();
(async () => {
  const migrations = await prisma.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at');
  const columns = await prisma.$queryRawUnsafe("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name,ordinal_position");
  const constraints = await prisma.$queryRawUnsafe("SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace");
  fs.writeFileSync('docs/readiness-schema-audit.json', JSON.stringify({ inspectedAt: new Date().toISOString(), migrations, columns, constraints }, null, 2));
  console.log(JSON.stringify({applied:migrations.length,latest:migrations.at(-1),legacyTables:[...new Set(columns.filter(c=>/subscription|usage|plan|lifepack/i.test(c.table_name)).map(c=>c.table_name))]}));
})().catch(e=>{console.error(e.code||e.name);process.exitCode=1}).finally(()=>prisma.$disconnect());
