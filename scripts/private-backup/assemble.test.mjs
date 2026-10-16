import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleStorageParts } from './assemble.mjs';
import { sha256 } from './transport.mjs';
const object = Buffer.from('synthetic-object');
const root = { manifest: { backupId: 'test' }, entries: new Map([['storage-manifest.json',Buffer.from(JSON.stringify({objects:[{archiveName:'storage/0',size:object.length,sha256:sha256(object)}]}))]]) };
const part = (offset, bytes) => ({ manifest: { backupId: 'test', report: { kind:'storage-part',objectIndex:0,offset,length:bytes.length,objectSize:object.length } }, entries: new Map([['chunk',bytes]]) });
test('reassembles out-of-order encrypted parts against original whole-object hash', () => {
  const result = assembleStorageParts(root,[part(5,object.subarray(5)),part(0,object.subarray(0,5))]);
  assert.deepEqual(result.get('storage/0'),object);
});
test('rejects missing, overlapping, modified and cross-backup parts', () => {
  assert.throws(()=>assembleStorageParts(root,[part(0,object.subarray(0,5))]));
  assert.throws(()=>assembleStorageParts(root,[part(0,object),part(0,object)]));
  assert.throws(()=>assembleStorageParts(root,[part(0,Buffer.alloc(object.length))]));
  const other=part(0,object);other.manifest.backupId='other';
  assert.throws(()=>assembleStorageParts(root,[other]));
});
