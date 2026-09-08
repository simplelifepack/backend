import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { encryptWealthFields } from '../services/wealthEncryption';
import { assertDocumentEncryptionConfigured } from '../utils/documentEncryption';
async function run() {
  assertDocumentEncryptionConfigured();
  if (!process.env.DOCUMENT_ENCRYPTION_KEY || !process.env.DOCUMENT_METADATA_ENCRYPTION_KEY) throw new Error('Configure stable document and metadata keys before migrating persistent financial data.');
  let cursor: string | undefined; let updated = 0;
  for (;;) {
    const rows = await prisma.wealthRecord.findMany({ take: 100, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) {
      const fields = encryptWealthFields(row);
      const changed = fields.title !== row.title || JSON.stringify(fields.details) !== JSON.stringify(row.details) || fields.notes !== row.notes || fields.followUpNote !== row.followUpNote;
      if (!changed) continue;
      if (process.argv.includes('--apply')) {
        const result = await prisma.wealthRecord.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: fields });
        if (result.count !== 1) throw new Error('A financial record changed concurrently. Rerun migration.');
      }
      updated++;
    }
    cursor = rows[rows.length - 1]!.id;
  }
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'applied' : 'dry-run', records: updated }));
}
run().catch(() => { console.error('Financial encryption migration failed. Verify key configuration and database access.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
