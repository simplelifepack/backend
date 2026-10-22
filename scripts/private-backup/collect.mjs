import { readFile, writeFile } from 'node:fs/promises';
import { decodeBackup, sha256 } from './transport.mjs';
import path from 'node:path';

// Vercel authentication is used only to fetch this job's encrypted build
// transport. No environment-variable or secret endpoints are called.
const [deploymentId, directory, keyFile, partName] = process.argv.slice(2);
if (partName && !/^part-\d+-\d+$/.test(partName)) throw Error('INVALID_PART_NAME');
if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId || '')) throw Error('DEPLOYMENT_ID_REQUIRED');
try {
  const auth = JSON.parse(await readFile('/Users/ranjith/Library/Application Support/com.vercel.cli/auth.json', 'utf8'));
  const headers = { Authorization: 'Bearer ' + auth.token };
  const root = 'https://api.vercel.com';
  const suffix = 'teamId=team_93cV3lkO3ZGYcihQkudd9ZR4';
  const deploymentResponse = await fetch(`${root}/v13/deployments/${deploymentId}?${suffix}`, { headers });
  if (!deploymentResponse.ok) throw Error('DEPLOYMENT_ACCESS_FAILED');
  const deployment = await deploymentResponse.json();
  if (deployment.projectId !== 'prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82' || deployment.readyState !== 'ERROR') throw Error('EXPORT_ONLY_BUILD_REQUIRED');
  const response = await fetch(`${root}/v3/deployments/${deploymentId}/events?direction=forward&follow=0&limit=-1&${suffix}`, { headers });
  if (!response.ok) throw Error('EXPORT_ACCESS_FAILED');
  const payload = await response.json();
  const events = Array.isArray(payload) ? payload : payload.events || [];
  const lines = events.flatMap(event => (event.text || event.payload?.text || '').split('\n')).filter(line => /^(?:RPB1 |RPC1 |RPE1 )/.test(line));
  const decoded = decodeBackup(lines, await readFile(keyFile));
  const encrypted = lines.join('\n') + '\n';
  if (partName && decoded.manifest.report.kind !== 'storage-part') throw Error('PART_KIND_INVALID');
  if (partName && partName !== `part-${decoded.manifest.report.objectIndex}-${decoded.manifest.report.offset}`) throw Error('PART_SELECTION_INVALID');
  await writeFile(path.join(directory, partName ? partName + '.rpb' : 'production-backup.rpb'), encrypted, { flag: 'wx', mode: 0o600 });
  const report = { ...decoded.manifest.report, deploymentId, archiveSha256: sha256(Buffer.from(encrypted)),
    encryptedTransportVerified: true, restoreVerified: false, entries: decoded.entries.size };
  // Report contains only counts, public project reference and genuine evidence IDs.
  await writeFile(path.join(directory, partName ? partName + '-report.json' : 'backup-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
} catch {
  console.error('ENCRYPTED_BACKUP_COLLECTION_FAILED');
  process.exitCode = 1;
}
