import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { decodeBackup, sha256 } from './transport.mjs';
import { assembleStorageParts } from './assemble.mjs';

const [directory, keyFile, image, archiveFile = "production-backup.rpb"] = process.argv.slice(2);
if (path.basename(archiveFile) !== archiveFile || !/^[a-z-]+\.rpb$/.test(archiveFile)) throw Error("LOCAL_ARCHIVE_FILENAME_REQUIRED");
if (!directory || !keyFile || !/^public\.ecr\.aws\/supabase\/postgres@sha256:[a-f0-9]{64}$/.test(image || '')) throw Error('PINNED_SUPABASE_RESTORE_IMAGE_REQUIRED');
const container = 'readiness-isolated-restore-' + randomUUID();
let bootstrapRole = 'restore_' + randomUUID().replaceAll('-', '').slice(0, 16);
let stage = 'archive';
let started = false;
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/local/bin/docker', args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000 });
    const chunks = [];
    const diagnostics = [];
    let bytes = 0;
    child.stdout.on('data', part => { bytes += part.length; if (bytes > 128 * 1024 * 1024) child.kill(); else chunks.push(part); });
    child.stderr.on('data', part => { if (diagnostics.reduce((n,b)=>n+b.length,0)<65536) diagnostics.push(part); });
    child.on('error', () => reject(Error('ISOLATED_RESTORE_COMMAND_FAILED')));
    child.on('close', code => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      const diagnostic=Buffer.concat(diagnostics).toString();
      const error=Error('ISOLATED_RESTORE_COMMAND_FAILED');
      error.safeDiagnostic={alreadyExists:/already exists/i.test(diagnostic),permissionDenied:/permission denied|must be (?:owner|superuser)|not permitted/i.test(diagnostic),missingRole:/role .* does not exist/i.test(diagnostic),missingExtension:/extension .* is not available|could not open extension/i.test(diagnostic),connectionFailed:/connection.*failed|could not connect/i.test(diagnostic),line:Number(diagnostic.match(/psql:<stdin>:(\d+):/)?.[1]??0),sqlState:diagnostic.match(/ERROR:\s+([0-9A-Z]{5})(?:\s|$)/)?.[1]??null};
      if(input && stage==='roles' && error.safeDiagnostic.line){const lines=Buffer.from(input).toString().split('\n'); const line=lines[error.safeDiagnostic.line-1]||'';error.safeDiagnostic.command=line.match(/^(CREATE ROLE|ALTER ROLE|GRANT|REVOKE|SET|SELECT)/)?.[1]??'OTHER';error.safeDiagnostic.roleOptions=['SUPERUSER','CREATEROLE','BYPASSRLS','REPLICATION'].filter(v=>new RegExp('\\b'+v+'\\b').test(line));}
      reject(error);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const psql = input => docker(['exec', '-i', container, 'psql', '-X', '-A', '-t', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate', '-f', '-', '-U', bootstrapRole, '-d', 'postgres'], Buffer.from(input));
const quote = value => '"' + value.replaceAll('"', '""') + '"';
try {
  const decoded = decodeBackup((await readFile(path.join(directory, archiveFile), 'utf8')).trim().split('\n'), await readFile(keyFile));
  let transferredParts = 0;
  if (decoded.manifest.report.objectBytesIncluded === false) {
    const partFiles = (await readdir(directory)).filter(name => /^part-\d+-\d+\.rpb$/.test(name));
    const parts = [];
    const key = await readFile(keyFile);
    for (const file of partFiles) parts.push(decodeBackup((await readFile(path.join(directory,file),'utf8')).trim().split('\n'),key));
    for (const [name, bytes] of assembleStorageParts(decoded,parts)) decoded.entries.set(name,bytes);
    transferredParts = parts.length;
    await writeFile(path.join(directory,'backup-completeness-report.json'),JSON.stringify({ objectByteTransferComplete:true,
      objects:decoded.manifest.report.objects,bytes:decoded.manifest.report.bytes,encryptedParts:parts.length,
      archiveIntegrityVerified:true,applicationKeysExported:false },null,2),{mode:0o600});
  }
  // PG17 preserves GRANTED BY grantors. Bootstrap with the dump's original
  // platform superuser so membership grants retain their provenance/admin rights.
  const globals=decoded.entries.get('globals.sql').toString();
  const sourceSuperuser=globals.match(/^ALTER ROLE ([A-Za-z_][A-Za-z0-9_]*) WITH SUPERUSER /m)?.[1];
  if(!sourceSuperuser)throw Error('SOURCE_PLATFORM_SUPERUSER_REQUIRED');
  bootstrapRole=sourceSuperuser;
  const createBootstrap=`CREATE ROLE ${bootstrapRole};`;
  if(globals.split('\n').filter(line=>line===createBootstrap).length!==1)throw Error('SOURCE_BOOTSTRAP_ROLE_INVALID');
  const restoreGlobals=globals.split('\n').filter(line=>line!==createBootstrap).join('\n');
  stage = 'isolated-container';
  // No published ports, no host data mount, no external network, no durable PG
  // data. Supabase's entrypoint/init hooks and restored scheduled jobs never run.
  await docker(['run', '-d', '--rm', '--name', container, '--network', 'none', '--read-only',
    '--tmpfs', '/restore:rw,nosuid,nodev,mode=1777', '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777',
    '--tmpfs', '/var/run/postgresql:rw,nosuid,nodev,mode=1777', '--user', 'postgres', '--entrypoint', 'sh', image,
    '-c', 'initdb -D /restore/pgdata -U ' + bootstrapRole + ' --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /restore/pgdata -c listen_addresses= -c shared_preload_libraries= -c log_statement=none -c log_min_messages=panic -c log_min_error_statement=panic']);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await psql('SELECT 1;'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  if (!ready) throw Error('ISOLATED_POSTGRES_NOT_READY');
  stage = 'roles';
  // initdb already created this exact source superuser. All original ALTER
  // ROLE settings and membership grants still execute; archive stays unchanged.
  await psql(restoreGlobals);
  stage = 'database';
  const toc = (await docker(['exec','-i',container,'pg_restore','--list'],decoded.entries.get('database.dump'))).toString();
  const sequenceSetEntries = toc.split('\n').filter(line=>/ SEQUENCE SET /.test(line)).length;
  await docker(['exec', '-i', container, 'pg_restore', '--exit-on-error', '-U', bootstrapRole, '-d', 'postgres'], decoded.entries.get('database.dump'));
  stage = 'table-counts';
  const inventory = JSON.parse(decoded.entries.get('database-inventory.json'));
  for (const table of inventory.tables) {
    const actual = Number((await psql(`SELECT count(*) FROM ${quote(table.schema)}.${quote(table.name)};`)).toString());
    if (actual !== table.count) throw Error('RESTORED_ROW_COUNT_MISMATCH');
    if (table.hash) {
      const fingerprint = (await psql(`SELECT md5(COALESCE(string_agg(hash,'' ORDER BY hash),'')) FROM (SELECT md5(row_to_json(t)::text) AS hash FROM ${quote(table.schema)}.${quote(table.name)} t) s;`)).toString().trim();
      if (fingerprint !== table.hash) throw Error('RESTORED_TABLE_HASH_MISMATCH');
    } else if (!decoded.manifest.report.synthetic) throw Error('TABLE_HASH_REQUIRED');
  }
  stage = 'storage';
  const storage = JSON.parse(decoded.entries.get('storage-manifest.json'));
  await docker(['exec', '-i', container, 'mkdir', '-p', '/restore/objects']);
  for (let index = 0; index < storage.objects.length; index++) {
    const object = storage.objects[index];
    const body = decoded.entries.get(object.archiveName);
    if (!body || body.length !== object.size || sha256(body) !== object.sha256) throw Error('RESTORED_OBJECT_INVALID');
    // Object identities/metadata are retained in the encrypted manifest. Opaque
    // local filenames prevent private object paths appearing in process output.
    await docker(['exec', '-i', container, 'sh', '-c', `cat > /restore/objects/${index}`], body);
    const restored = await docker(['exec', '-i', container, 'cat', `/restore/objects/${index}`]);
    if (sha256(restored) !== object.sha256) throw Error('RESTORED_OBJECT_HASH_MISMATCH');
  }
  stage = 'constraints';
  const initiallyUnvalidated = JSON.parse((await psql("SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT n.nspname AS schema,t.relname AS table,c.conname AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class t ON t.oid=c.conrelid WHERE NOT c.convalidated AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema') x;")).toString());
  // Preserve the source's original state in the archive, but validate even
  // pre-existing NOT VALID constraints in the isolated copy as a data check.
  for (const constraint of initiallyUnvalidated) await psql(`ALTER TABLE ${quote(constraint.schema)}.${quote(constraint.table)} VALIDATE CONSTRAINT ${quote(constraint.name)};`);
  const invalid = Number((await psql("SELECT count(*) FROM pg_constraint WHERE NOT convalidated AND connamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema');")).toString());
  const foreignKeys = Number((await psql("SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema');")).toString());
  const sequences = Number((await psql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema';")).toString());
  const largeObjects = Number((await psql('SELECT count(*) FROM pg_largeobject_metadata;')).toString());
  if(sequences!==sequenceSetEntries)throw Error('SEQUENCE_RESTORE_INCOMPLETE');
  // pg_restore installs every FK after loading rows and exits on any failure.
  if (invalid !== 0) throw Error('UNVALIDATED_RESTORED_CONSTRAINTS');
  const report = { ...decoded.manifest.report, restoreVerified: true, tablesVerified: inventory.tables.length,
    objectsRestoredAndHashed: storage.objects.length, encryptedObjectPartsVerified: transferredParts, foreignKeysValidated: foreignKeys, unvalidatedConstraintsInIsolatedCopy: invalid,
    sourceUnvalidatedConstraints: initiallyUnvalidated.length, existingConstraintsValidatedInIsolatedCopy: initiallyUnvalidated.length,
    objectByteTransferComplete:true,
    sourceBootstrapRolePreserved:true,bootstrapCreateStatementsSkipped:1,
    sequencesRestored:sequences,sequenceValueEntriesRestored:sequenceSetEntries,largeObjectsRestored:largeObjects,
    isolatedNetwork: true, hostDatabaseUntouched: true, existingApplicationKeysExported: false,
    applicationCiphertextDecryptionVerified: false, restoredAt: new Date().toISOString() };
  await writeFile(path.join(directory, archiveFile === 'production-backup.rpb' ? 'restore-report.json' : archiveFile.replace(/\.rpb$/, '-restore-report.json')), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({ code: 'ISOLATED_RESTORE_FAILED', stage, diagnostic: error.safeDiagnostic??null }));
  process.exitCode = 1;
} finally {
  if (started) await docker(['stop', container]).catch(() => {});
}
