import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isExactBlockAllRule } from './guards.mjs';

const [directory, jobDirectory] = process.argv.slice(2);
const id = 'prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82';
const auth = JSON.parse(await readFile('/Users/ranjith/Library/Application Support/com.vercel.cli/auth.json', 'utf8'));
async function api(route, method = 'GET') {
  const response = await fetch('https://api.vercel.com' + route + (route.includes('?') ? '&' : '?') + 'teamId=team_93cV3lkO3ZGYcihQkudd9ZR4', {
    method, headers: { Authorization: 'Bearer ' + auth.token }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('EXPORT_MAINTENANCE_API_FAILED');
  const body = await response.text();
  return body.trim() ? JSON.parse(body) : null;
}
let unpaused = false;
try {
  const evidence = JSON.parse(await readFile(path.join(directory, 'maintenance-evidence.json'), 'utf8'));
  const prior = JSON.parse(await readFile(path.join(directory, 'maintenance-prior.json'), 'utf8'));
  const backend = prior.projects.find(project => project.id === id);
  const current = await api('/v9/projects/' + id);
  const firewall = await api('/v1/security/firewall/config/active?projectId=' + id);
  const rules = firewall.rules || [];
  const rule = rules.find(entry => entry.name === 'Readiness temporary backup maintenance 20261016');
  if (!evidence.verified || current.installCommand !== 'node -e "process.exit(78)"' || !firewall.firewallEnabled ||
    rules.length !== 1 || !isExactBlockAllRule(rule)) throw Error('BLOCK_ALL_RULE_NOT_VERIFIED');
  await api('/v1/projects/' + id + '/unpause', 'POST');
  unpaused = true;
  const urls = [...new Set([...backend.aliases, ...backend.retained.filter(entry => entry.state === 'READY').map(entry => entry.url)])];
  let blocked = 0;
  for (let index = 0; index < urls.length; index += 4) {
    const checks = await Promise.all(urls.slice(index, index + 4).map(async host => {
      const response = await fetch('https://' + host + '/health', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const ok = response.status === 403 && response.headers.get('server')?.toLowerCase() === 'vercel';
      await response.body?.cancel();
      return ok;
    }));
    blocked += checks.filter(Boolean).length;
  }
  if (blocked !== urls.length) throw Error('OLD_WRITER_NOT_BLOCKED');
  evidence.writersBlockedAt ||= evidence.verifiedAt;
  evidence.verifiedAt = new Date().toISOString();
  evidence.backendBuildsAllowedWhileFirewallBlocksTraffic = true;
  evidence.backendFirewallCoverage = { checked: urls.length, blocked };
  await writeFile(path.join(directory, 'maintenance-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  await writeFile(path.join(jobDirectory, 'scripts/private-backup/maintenance.json'), JSON.stringify(evidence), { mode: 0o600 });
  console.log(JSON.stringify({ maintenanceVerified: true, backendBuildsAllowed: true, backendUrlsChecked: urls.length, backendUrlsBlocked: blocked }));
} catch {
  let pausedAgain = false;
  if (unpaused) { try { await api('/v1/projects/' + id + '/pause', 'POST'); pausedAgain = true; } catch {} }
  console.error(JSON.stringify({ code: 'EXPORT_BUILD_MAINTENANCE_FAILED', backendPausedAgain: pausedAgain }));
  process.exitCode = 1;
}
