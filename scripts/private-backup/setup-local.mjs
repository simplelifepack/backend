import { mkdir, writeFile, chmod, access } from 'node:fs/promises';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import path from 'node:path';

const [directory, keyFile, jobDirectory] = process.argv.slice(2);
if (!directory || !keyFile || !jobDirectory || path.dirname(keyFile).startsWith(directory)) throw Error('SEPARATE_BACKUP_AND_KEY_PATHS_REQUIRED');
try { await access(keyFile); throw Error('BACKUP_KEY_ALREADY_EXISTS'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
await chmod(path.dirname(keyFile), 0o700);
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
await writeFile(keyFile, privateKey, { flag: 'wx', mode: 0o600 });
const recipient = { backupId: randomUUID(), publicKey };
await writeFile(path.join(jobDirectory, 'scripts/private-backup/recipient.json'), JSON.stringify(recipient), { flag: 'wx', mode: 0o600 });
await writeFile(path.join(directory, 'recipient.json'), JSON.stringify(recipient), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ localRecoveryKeyCreated: true, separateFromBackup: true, existingApplicationKeysRead: false }));
