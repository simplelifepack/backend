import { spawn } from 'node:child_process';
import { readFile, chmod, rename, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriter, sha256 } from './transport.mjs';

const project = 'prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82';
const ref = 'izsujcwyuirkzkafhfnp';
let stage = 'context';
const emit = line => process.stdout.write(line + '\n');
function requireCondition(value) { if (!value) throw Error('BACKUP_GATE_FAILED'); }
function runPg(tool, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(fileURLToPath(new URL('./pg/lib/ld-musl-x86_64.so.1', import.meta.url)), [
      '--library-path', fileURLToPath(new URL('./pg/lib', import.meta.url)),
      fileURLToPath(new URL(`./pg/bin/${tool === 'pg_dump' ? 'pg_dump.elf' : tool}`, import.meta.url)), ...args,
    ], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
    const output = [];
    const diagnostics = [];
    let length = 0;
    child.stdout.on('data', bytes => {
      length += bytes.length;
      if (length > 128 * 1024 * 1024) child.kill();
      else output.push(bytes);
    });
    // PostgreSQL diagnostics may contain identifiers or connection details.
    child.stderr.on('data', bytes => { if (diagnostics.reduce((sum, entry) => sum + entry.length, 0) < 65536) diagnostics.push(bytes); });
    child.on('error', () => reject(Error('PG_TOOL_FAILED')));
    child.on('close', code => {
      if (code === 0) return resolve(Buffer.concat(output));
      const message = Buffer.concat(diagnostics).toString();
      const classification = /certificate|SSL error|root certificate/i.test(message) ? 'PG_TLS_FAILED'
        : /password authentication|no password supplied/i.test(message) ? 'PG_AUTH_FAILED'
        : /permission denied|must be superuser/i.test(message) ? 'PG_PERMISSION_FAILED'
        : /could not translate host|name or service not known/i.test(message) ? 'PG_DNS_FAILED'
        : /Network is unreachable|Connection timed out|could not connect/i.test(message) ? 'PG_NETWORK_FAILED'
        : /could not find.*executable|not a valid executable|Permission denied/i.test(message) ? 'PG_EXECUTABLE_FAILED'
        : /version mismatch|server version|unrecognized option|invalid compression/i.test(message) ? 'PG_VERSION_OR_OPTION_FAILED'
        : /query failed|query was:|ERROR:/i.test(message) ? 'PG_QUERY_FAILED' : 'PG_TOOL_FAILED';
      emit(JSON.stringify({ code: 'PG_CLIENT_DIAGNOSTIC', tool, exitCode: Number.isInteger(code) ? code : null,
        executableLookupFailed: /could not find|executable/i.test(message), libraryLoadFailed: /Error loading shared library|symbol not found/i.test(message),
        connectionFailed: /connection|connect to server/i.test(message), queryFailed: /query failed|query was:/i.test(message) }));
      reject(Error(classification));
    });
  });
}

try {
  requireCondition(process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_ID === project);
  requireCondition(process.env.PRIVATE_BACKUP_ENABLED === '1');
  for (const name of ['bin/pg_dump', 'bin/pg_dumpall', 'bin/psql', 'lib/ld-musl-x86_64.so.1']) await chmod(new URL('./pg/' + name, import.meta.url), 0o755);
  // pg_dumpall validates/runs its sibling pg_dump itself. Vercel does not have
  // Alpine's ELF interpreter at /lib, so that sibling must be a shell launcher
  // using the bundled loader, even for a globals-only export.
  try { await access(new URL('./pg/bin/pg_dump.elf', import.meta.url)); }
  catch { await rename(new URL('./pg/bin/pg_dump', import.meta.url), new URL('./pg/bin/pg_dump.elf', import.meta.url)); }
  const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const loader = fileURLToPath(new URL('./pg/lib/ld-musl-x86_64.so.1', import.meta.url));
  const library = fileURLToPath(new URL('./pg/lib', import.meta.url));
  const dump = fileURLToPath(new URL('./pg/bin/pg_dump.elf', import.meta.url));
  await writeFile(new URL('./pg/bin/pg_dump', import.meta.url), '#!/bin/sh\nexec ' + shellQuote(loader) + ' --library-path ' + shellQuote(library) + ' ' + shellQuote(dump) + ' "$@"\n', { mode: 0o755 });
  const maintenance = JSON.parse(await readFile(new URL('./maintenance.json', import.meta.url), 'utf8'));
  requireCondition(maintenance.verified === true && maintenance.backendProjectId === project && maintenance.supabaseRef === ref);
  requireCondition(Date.now() - Date.parse(maintenance.verifiedAt) < 30 * 60000);
  const backupConfig = JSON.parse(await readFile(new URL('./recipient.json', import.meta.url), 'utf8'));
  const db = new URL(process.env.DIRECT_URL || '');
  requireCondition(db.hostname === `db.${ref}.supabase.co` || db.username.endsWith('.' + ref));
  const endpoint = new URL(process.env.STORAGE_ENDPOINT || '');
  requireCondition(endpoint.protocol === 'https:' && endpoint.hostname.startsWith(ref + '.'));
  requireCondition(process.env.STORAGE_DRIVER === 's3');
  const pgEnv = {
    PATH: process.env.PATH, LANG: 'C.UTF-8',
    PGHOST: db.hostname, PGPORT: db.port || '5432', PGUSER: decodeURIComponent(db.username),
    PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: fileURLToPath(new URL('./pg/ca.crt', import.meta.url)), PGCONNECT_TIMEOUT: '30',
  };
  const writer = createWriter(backupConfig.publicKey, backupConfig.backupId, emit);
  const sql = query => runPg('psql', ['-X', '-A', '-t', '--no-password', '--set=ON_ERROR_STOP=1', '-c', query], pgEnv);
  stage = 'drain';
  const drainUntil = Date.parse(maintenance.writersBlockedAt || maintenance.verifiedAt) + 300000;
  while (Date.now() < drainUntil) await new Promise(resolve => setTimeout(resolve, Math.min(30000, drainUntil - Date.now())));
  const activeTransactions = Number((await sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND xact_start IS NOT NULL AND usename NOT IN ('supabase_admin','supabase_auth_admin','supabase_storage_admin')`)).toString());
  const leases = Number((await sql(`SELECT count(*) FROM public."CustomPackageGenerationJob" WHERE "leaseExpiresAt">now()`)).toString());
  const exports = Number((await sql(`SELECT count(*) FROM public.account_export_jobs WHERE status IN ('PROCESSING','PREPARING','RUNNING')`)).toString());
  requireCondition(activeTransactions === 0 && leases === 0 && exports === 0);
  stage = 'database-inventory';
  const inventorySql = `SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p') ORDER BY 1,2) x`;
  const tables = JSON.parse((await sql(inventorySql)).toString());
  const tableCounts = [];
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  const fingerprintSql = table => `SELECT json_build_object('count',count(*),'hash',md5(COALESCE(string_agg(hash,'' ORDER BY hash),''))) FROM (SELECT md5(row_to_json(t)::text) AS hash FROM ${quote(table.schema)}.${quote(table.name)} t) s`;
  for (const table of tables) {
    const fingerprint = JSON.parse((await sql(fingerprintSql(table))).toString());
    const count = Number(fingerprint.count);
    requireCondition(Number.isSafeInteger(count) && count >= 0);
    tableCounts.push({ ...table, count, hash: fingerprint.hash });
  }
  const storageRows = JSON.parse((await sql(`SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT bucket_id,name,(metadata->>'size')::bigint AS size FROM storage.objects ORDER BY bucket_id,name) x`)).toString());
  stage = 'database-dump';
  writer.write('database.dump', await runPg('pg_dump', ['--no-password', '--format=custom', '--compress=6', '--lock-wait-timeout=10000'], pgEnv));
  writer.write('globals.sql', await runPg('pg_dumpall', ['--no-password', '--globals-only', '--no-role-passwords'], pgEnv));
  writer.write('database-inventory.json', Buffer.from(JSON.stringify({ tables: tableCounts, storageRows })));
  stage = 'storage';
  const s3 = new S3Client({ endpoint: endpoint.href, region: process.env.STORAGE_REGION,
    credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true', maxAttempts: 3 });
  const bucketResult = await s3.send(new ListBucketsCommand({}));
  const buckets = (bucketResult.Buckets || []).sort((a, b) => a.Name.localeCompare(b.Name));
  const objects = [];
  async function list(bucket) {
    const result = [];
    let token;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
      for (const entry of page.Contents || []) result.push({ key: entry.Key, size: entry.Size, etag: entry.ETag });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      requireCondition(!page.IsTruncated || token);
    } while (token);
    return result.sort((a, b) => a.key.localeCompare(b.key));
  }
  let bytes = 0;
  for (const bucket of buckets) {
    const before = await list(bucket.Name);
    for (const entry of before) {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket.Name, Key: entry.key, IfMatch: entry.etag }));
      const body = Buffer.from(await object.Body.transformToByteArray());
      requireCondition(body.length === entry.size && body.length === Number(object.ContentLength));
      const archiveName = `storage/${objects.length}`;
      if (process.env.PRIVATE_BACKUP_MANIFEST_ONLY !== '1') writer.write(archiveName, body);
      objects.push({ archiveName, bucket: bucket.Name, key: entry.key, size: body.length, sha256: sha256(body),
        contentType: object.ContentType, contentEncoding: object.ContentEncoding, cacheControl: object.CacheControl,
        contentDisposition: object.ContentDisposition, contentLanguage: object.ContentLanguage,
        expires: object.Expires, lastModified: object.LastModified, etag: object.ETag, metadata: object.Metadata });
      bytes += body.length;
    }
    requireCondition(JSON.stringify(before) === JSON.stringify(await list(bucket.Name)));
  }
  for (const row of storageRows) requireCondition(objects.some(object => object.bucket === row.bucket_id && object.key === row.name && object.size === Number(row.size)));
  stage = 'verification';
  for (const table of tableCounts) {
    const after = JSON.parse((await sql(fingerprintSql(table))).toString());
    requireCondition(Number(after.count) === table.count && after.hash === table.hash);
  }
  writer.write('storage-manifest.json', Buffer.from(JSON.stringify({ buckets, objects })));
  writer.finish({ projectRef: ref, tables: tables.length, rows: tableCounts.reduce((sum, table) => sum + table.count, 0),
    buckets: buckets.length, objects: objects.length, bytes, metadataObjects: storageRows.length,
    maintenanceReference: maintenance.reference, createdAt: new Date().toISOString(), applicationKeysExported: false,
    drainSeconds: 300, activeApplicationTransactions: activeTransactions, activePackageLeases: leases, activeExports: exports,
    kind: 'database-and-storage-manifest', objectBytesIncluded: process.env.PRIVATE_BACKUP_MANIFEST_ONLY !== '1' });
  emit('BACKUP_ENCRYPTED_EXPORT_COMPLETED');
  // Intentionally fail the build: an export must never become a deployment,
  // acquire aliases, or replace the running application's production pointer.
  process.exitCode = 42;
} catch (error) {
  const reason = ['PG_TLS_FAILED', 'PG_AUTH_FAILED', 'PG_PERMISSION_FAILED', 'PG_DNS_FAILED', 'PG_NETWORK_FAILED', 'PG_EXECUTABLE_FAILED', 'PG_VERSION_OR_OPTION_FAILED', 'PG_QUERY_FAILED', 'PG_TOOL_FAILED', 'BACKUP_GATE_FAILED'].includes(error.message) ? error.message : 'BACKUP_OPERATION_FAILED';
  emit(JSON.stringify({ code: 'PRIVATE_BACKUP_FAILED', stage, reason }));
  process.exitCode = 1;
}
