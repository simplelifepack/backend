import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createWriter, decodeBackup } from './transport.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
function fixture() {
  const lines = [];
  const writer = createWriter(publicKey, 'synthetic-test', line => lines.push(line));
  writer.write('database.dump', Buffer.from('PRIVATE_SYNTHETIC_CONTENT'));
  writer.write('storage/0', Buffer.alloc(10000, 33));
  writer.finish({ objects: 1 });
  return lines;
}
test('recipient encryption round-trips without recognizable content', () => {
  const lines = fixture();
  assert.ok(!lines.join('\n').includes('PRIVATE_SYNTHETIC_CONTENT'));
  const restored = decodeBackup(lines, privateKey);
  assert.equal(restored.entries.get('database.dump').toString(), 'PRIVATE_SYNTHETIC_CONTENT');
  assert.equal(restored.manifest.entries.length, 2);
});
test('rejects missing chunks and missing completion marker', () => {
  const lines = fixture();
  assert.throws(() => decodeBackup(lines.filter((_, index) => index !== 2), privateKey));
  assert.throws(() => decodeBackup(lines.slice(0, -1), privateKey));
});
test('rejects wrong recipient, duplicate chunks and modified ciphertext', () => {
  const lines = fixture();
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => decodeBackup(lines, other.privateKey));
  assert.throws(() => decodeBackup([...lines, lines[1]], privateKey));
  const modified = [...lines];
  const fields = modified[1].split(' ');
  const record = JSON.parse(Buffer.from(fields[4], 'base64'));
  record.encrypted = Buffer.alloc(24).toString('base64');
  fields[4] = Buffer.from(JSON.stringify(record)).toString('base64');
  modified[1] = fields.join(' ');
  assert.throws(() => decodeBackup(modified, privateKey));
});
