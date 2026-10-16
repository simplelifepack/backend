import { sha256 } from './transport.mjs';

export function assembleStorageParts(root, parts) {
  const storage = JSON.parse(root.entries.get('storage-manifest.json'));
  const grouped = new Map();
  for (const part of parts) {
    const report = part.manifest.report;
    const bytes = part.entries.get('chunk');
    const object = storage.objects[report.objectIndex];
    if (part.manifest.backupId !== root.manifest.backupId || report.kind !== 'storage-part' ||
      !Number.isSafeInteger(report.objectIndex) || !Number.isSafeInteger(report.offset) ||
      !Number.isSafeInteger(report.length) || report.offset < 0 || report.length <= 0 || !object ||
      report.objectSize !== object.size || !bytes || bytes.length !== report.length || report.offset + report.length > object.size) throw Error('BACKUP_PART_INVALID');
    if (!grouped.has(report.objectIndex)) grouped.set(report.objectIndex, []);
    grouped.get(report.objectIndex).push({ offset: report.offset, bytes });
  }
  const result = new Map();
  for (let index = 0; index < storage.objects.length; index++) {
    const object = storage.objects[index];
    const chunks = (grouped.get(index) || []).sort((a, b) => a.offset - b.offset);
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk.offset !== offset) throw Error('BACKUP_PART_MISSING_OR_OVERLAPPING');
      offset += chunk.bytes.length;
    }
    if (offset !== object.size) throw Error('BACKUP_PART_MISSING_OR_OVERLAPPING');
    const bytes = Buffer.concat(chunks.map(chunk => chunk.bytes));
    if (sha256(bytes) !== object.sha256) throw Error('BACKUP_OBJECT_HASH_INVALID');
    result.set(object.archiveName, bytes);
  }
  return result;
}
