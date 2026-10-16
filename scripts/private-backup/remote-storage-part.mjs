import { readFile } from 'node:fs/promises';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriter } from './transport.mjs';

let stage = 'context';
const emit = line => process.stdout.write(line + '\n');
const requireCondition = value => { if (!value) throw Error('PART_GATE_FAILED'); };
try {
  requireCondition(process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_ID === 'prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82' && process.env.PRIVATE_BACKUP_ENABLED === '1');
  const maintenance = JSON.parse(await readFile(new URL('./maintenance.json', import.meta.url), 'utf8'));
  requireCondition(maintenance.verified === true && maintenance.backendBuildsAllowedWhileFirewallBlocksTraffic === true && Date.now() - Date.parse(maintenance.verifiedAt) < 30 * 60000);
  const index = Number(process.env.PRIVATE_BACKUP_PART_INDEX);
  const offset = Number(process.env.PRIVATE_BACKUP_PART_OFFSET);
  const length = Number(process.env.PRIVATE_BACKUP_PART_LENGTH);
  requireCondition([index, offset, length].every(Number.isSafeInteger) && index >= 0 && offset >= 0 && length > 0 && length <= 1048576);
  const endpoint = new URL(process.env.STORAGE_ENDPOINT || '');
  requireCondition(endpoint.protocol === 'https:' && endpoint.hostname.startsWith('izsujcwyuirkzkafhfnp.'));
  const recipient = JSON.parse(await readFile(new URL('./recipient.json', import.meta.url), 'utf8'));
  const writer = createWriter(recipient.publicKey, recipient.backupId, emit);
  const s3 = new S3Client({ endpoint: endpoint.href, region: process.env.STORAGE_REGION,
    credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true', maxAttempts: 3 });
  stage = 'inventory';
  const buckets = ((await s3.send(new ListBucketsCommand({}))).Buckets || []).sort((a, b) => a.Name.localeCompare(b.Name));
  const objects = [];
  for (const bucket of buckets) {
    let token;
    const contents = [];
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket.Name, ContinuationToken: token }));
      contents.push(...(page.Contents || []));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      requireCondition(!page.IsTruncated || token);
    } while (token);
    contents.sort((a, b) => a.Key.localeCompare(b.Key));
    objects.push(...contents.map(object => ({ bucket: bucket.Name, key: object.Key, size: object.Size, etag: object.ETag })));
  }
  const target = objects[index];
  requireCondition(target && offset + length <= target.size);
  stage = 'object-range';
  const result = await s3.send(new GetObjectCommand({ Bucket: target.bucket, Key: target.key, IfMatch: target.etag, Range: `bytes=${offset}-${offset + length - 1}` }));
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  requireCondition(bytes.length === length && Number(result.ContentLength) === length);
  writer.write('chunk', bytes);
  writer.finish({ kind: 'storage-part', objectIndex: index, offset, length, objectSize: target.size,
    maintenanceReference: maintenance.reference, applicationKeysExported: false });
  emit('BACKUP_ENCRYPTED_EXPORT_COMPLETED');
  process.exitCode = 42;
} catch {
  emit(JSON.stringify({ code: 'PRIVATE_BACKUP_FAILED', stage, reason: 'STORAGE_PART_FAILED' }));
  process.exitCode = 1;
}
