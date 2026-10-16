import { createCipheriv, createDecipheriv, createHash, publicEncrypt, privateDecrypt, randomBytes, constants } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const oaep = key => ({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' });

// The recipient private key is generated and retained locally. Vercel receives
// only the public key. Existing application keys never enter this transport.
export function createWriter(publicKey, backupId, emit) {
  const key = randomBytes(32);
  const header = { version: 1, backupId, wrappedKey: publicEncrypt(oaep(publicKey), key).toString('base64') };
  emit('RPB1 ' + JSON.stringify(header));
  let sequence = 0;
  const entries = [];
  function write(name, bytes) {
    const nonce = randomBytes(12);
    const aad = Buffer.from(JSON.stringify([1, backupId, sequence, name]));
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const record = { sequence, name, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), bytes: bytes.length, sha256: sha256(bytes), encrypted: encrypted.toString('base64') };
    const encoded = Buffer.from(JSON.stringify(record)).toString('base64');
    const count = Math.ceil(encoded.length / 2048);
    for (let part = 0; part < count; part++) emit(`RPC1 ${sequence} ${part} ${count} ${encoded.slice(part * 2048, (part + 1) * 2048)}`);
    entries.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    sequence++;
  }
  return {
    write,
    finish(report) {
      write('manifest.json', Buffer.from(JSON.stringify({ version: 1, backupId, entries: [...entries], report })));
      key.fill(0);
      emit(`RPE1 ${sequence}`);
    },
  };
}

export function decodeBackup(lines, privateKey) {
  const headers = lines.filter(line => line.startsWith('RPB1 '));
  if (headers.length !== 1) throw Error('BACKUP_HEADER_INVALID');
  const header = JSON.parse(headers[0].slice(5));
  if (header.version !== 1 || !/^[a-zA-Z0-9-]+$/.test(header.backupId)) throw Error('BACKUP_VERSION_INVALID');
  const key = privateDecrypt(oaep(privateKey), Buffer.from(header.wrappedKey, 'base64'));
  const groups = new Map();
  for (const line of lines.filter(line => line.startsWith('RPC1 '))) {
    const match = /^RPC1 (\d+) (\d+) (\d+) ([A-Za-z0-9+/=]+)$/.exec(line);
    if (!match) throw Error('BACKUP_CHUNK_INVALID');
    const [, id, part, total, value] = match;
    if (!groups.has(+id)) groups.set(+id, { total: +total, parts: new Map() });
    const group = groups.get(+id);
    if (group.total !== +total || group.parts.has(+part) || +part >= +total) throw Error('BACKUP_CHUNK_DUPLICATE');
    group.parts.set(+part, value);
  }
  const end = lines.filter(line => line.startsWith('RPE1 '));
  if (end.length !== 1 || end[0] !== `RPE1 ${groups.size}`) throw Error('BACKUP_INCOMPLETE');
  const entries = new Map();
  try {
    for (let sequence = 0; sequence < groups.size; sequence++) {
      const group = groups.get(sequence);
      if (!group || group.parts.size !== group.total) throw Error('BACKUP_INCOMPLETE');
      const encoded = Array.from({ length: group.total }, (_, index) => group.parts.get(index)).join('');
      const record = JSON.parse(Buffer.from(encoded, 'base64').toString());
      if (record.sequence !== sequence || entries.has(record.name)) throw Error('BACKUP_SEQUENCE_INVALID');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64'));
      decipher.setAAD(Buffer.from(JSON.stringify([1, header.backupId, sequence, record.name])));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      const bytes = Buffer.concat([decipher.update(Buffer.from(record.encrypted, 'base64')), decipher.final()]);
      if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) throw Error('BACKUP_HASH_INVALID');
      entries.set(record.name, bytes);
    }
    const manifest = JSON.parse(entries.get('manifest.json')?.toString() || '{}');
    if (manifest.backupId !== header.backupId || manifest.entries?.length !== entries.size - 1) throw Error('BACKUP_MANIFEST_INVALID');
    for (const entry of manifest.entries) {
      const bytes = entries.get(entry.name);
      if (!bytes || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw Error('BACKUP_MANIFEST_INVALID');
    }
    return { entries, manifest };
  } finally { key.fill(0); }
}
