import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [action, directory, jobDirectory] = process.argv.slice(2);
if (!['activate', 'resume'].includes(action) || !directory) throw Error('MAINTENANCE_ACTION_REQUIRED');
const projects = [
  { name: 'frontend-web', id: 'prj_HJyvi4ZPj38809HHvRzIReFuDGev', expected: 'dpl_3FFreSp5PHc2BKLUAvb2j8rxGWU1', aliases: ['readines.com', 'www.readines.com', 'frontend-web-nine-amber.vercel.app'] },
  { name: 'backend', id: 'prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82', expected: 'dpl_4qQZNydcF2ZMKPrYXHqT3EiDJiYc', aliases: ['backend-lifepack1.vercel.app', 'backend-three-sage-78.vercel.app'] },
];
const priorFile = path.join(directory, 'maintenance-prior.json');
const maintenanceRule = 'Readiness temporary backup maintenance 20261016';
function firewall(args, parse = false) {
  const child = spawnSync(process.execPath, ['/Users/ranjith/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js', 'firewall', ...args,
    '--project', projects[1].id, '--scope', 'team_93cV3lkO3ZGYcihQkudd9ZR4', '--non-interactive'], { encoding: 'utf8', timeout: 60000 });
  if (child.status !== 0) throw Error('FIREWALL_COMMAND_FAILED');
  return parse ? JSON.parse(child.stdout) : null;
}
const auth = JSON.parse(await readFile('/Users/ranjith/Library/Application Support/com.vercel.cli/auth.json', 'utf8'));
async function api(route, method = 'GET', body) {
  const response = await fetch('https://api.vercel.com' + route + (route.includes('?') ? '&' : '?') + 'teamId=team_93cV3lkO3ZGYcihQkudd9ZR4', {
    method, headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('MAINTENANCE_API_' + response.status);
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : null;
}
async function deployments(id) {
  const found = [];
  let until;
  do {
    const page = await api(`/v6/deployments?projectId=${id}&limit=100${until ? '&until=' + until : ''}`);
    found.push(...page.deployments.map(entry => ({ id: entry.uid, url: entry.url, state: entry.readyState || entry.state })));
    until = page.pagination?.next;
  } while (until);
  return found;
}
async function restore(prior) {
  if (prior.firewallMaintenance) {
    firewall(['rules', 'remove', maintenanceRule, '--yes']);
    await api('/v1/security/firewall/config?projectId=' + projects[1].id, 'PATCH', { action: 'firewallEnabled', value: prior.firewallEnabled });
    firewall(['publish', '--yes']);
  }
  for (const entry of [...prior.projects].reverse()) {
    await api('/v9/projects/' + entry.id, 'PATCH', { installCommand: entry.installCommand });
    if (!entry.paused) await api('/v1/projects/' + entry.id + '/unpause', 'POST');
  }
}
let stage = 'inspect';
let prior;
let changed = false;
try {
  if (action === 'resume') {
    prior = JSON.parse(await readFile(priorFile, 'utf8'));
    await restore(prior);
    for (const entry of prior.projects) {
      const current = await api('/v9/projects/' + entry.id);
      if (!!current.paused !== entry.paused || current.installCommand !== entry.installCommand || current.targets?.production?.id !== entry.productionId) throw Error('MAINTENANCE_RESUME_MISMATCH');
    }
    console.log(JSON.stringify({ maintenanceResumed: true, previousConfigurationRestored: true, productionPointersUnchanged: true }));
  } else {
    if (!jobDirectory) throw Error('BACKUP_JOB_DIRECTORY_REQUIRED');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const entries = [];
    const firewallBefore = firewall(['status', '--json'], true);
    if (firewallBefore.firewallEnabled || firewallBefore.draftChanges !== 0 || firewallBefore.rules.total !== 0) throw Error('FIREWALL_DRAFT_OR_BASELINE_CHANGED');
    for (const project of projects) {
      const current = await api('/v9/projects/' + project.id);
      const retained = await deployments(project.id);
      if (current.targets?.production?.id !== project.expected || retained.some(entry => ['QUEUED', 'BUILDING', 'INITIALIZING'].includes(entry.state))) throw Error('PRODUCTION_CHANGED_OR_BUILD_ACTIVE');
      entries.push({ ...project, installCommand: current.installCommand, paused: !!current.paused,
        productionId: current.targets.production.id, retained });
    }
    prior = { projects: entries, capturedAt: new Date().toISOString(), firewallMaintenance: true, firewallEnabled: firewallBefore.firewallEnabled };
    await writeFile(priorFile, JSON.stringify(prior), { flag: 'wx', mode: 0o600 });
    stage = 'freeze-and-pause';
    changed = true;
    firewall(['rules', 'add', maintenanceRule, '--condition', JSON.stringify({ type: 'path', op: 'pre', value: '/' }), '--action', 'deny', '--yes']);
    for (const entry of entries) {
      changed = true;
      // Reversible fail-closed install gate blocks Git/deploy-hook builds before
      // the application's automatic migration build command can execute.
      await api('/v9/projects/' + entry.id, 'PATCH', { installCommand: 'node -e "process.exit(78)"' });
      await api('/v1/projects/' + entry.id + '/pause', 'POST');
    }
    await api('/v1/security/firewall/config?projectId=' + projects[1].id, 'PATCH', { action: 'firewallEnabled', value: true });
    firewall(['publish', '--yes']);
    const activeFirewall = firewall(['status', '--json'], true);
    if (!activeFirewall.firewallEnabled || activeFirewall.rules.active !== 1 || activeFirewall.draftChanges !== 0) throw Error('MAINTENANCE_FIREWALL_NOT_ACTIVE');
    stage = 'verify-block';
    const coverage = [];
    for (const entry of entries) {
      const urls = [...new Set([...entry.aliases, ...(entry.name === 'backend' ? entry.retained.filter(item => item.state === 'READY').map(item => item.url) : [])])];
      let blocked = 0;
      const failedProbes = [];
      for (let index = 0; index < urls.length; index += 4) {
        const results = await Promise.all(urls.slice(index, index + 4).map(async host => {
          const result = await fetch('https://' + host + (entry.name === 'backend' ? '/health' : '/'), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
          const error = result.headers.get('x-vercel-error') || '';
          const body = await result.text();
          const paused = result.status === 503 && (error === 'DEPLOYMENT_PAUSED' || body.includes('DEPLOYMENT_PAUSED'));
          const retired = [404, 410].includes(result.status) && ['DEPLOYMENT_NOT_FOUND', 'DEPLOYMENT_DELETED'].includes(error);
          // /health is public in the retained application; the single active
          // path-prefix deny rule applies before it, regardless of app login.
          const firewalled = entry.name === 'backend' && result.status === 403 && result.headers.get('server')?.toLowerCase() === 'vercel';
          if (!paused && !retired && !firewalled) failedProbes.push({ host, status: result.status, error: /^[A-Z_]+$/.test(error) ? error : null });
          return paused || retired || firewalled;
        }));
        blocked += results.filter(Boolean).length;
      }
      coverage.push({ project: entry.name, checked: urls.length, pausedResponses: blocked });
      if (blocked !== urls.length) {
        await writeFile(path.join(directory, 'failed-block-probes.json'), JSON.stringify({ coverage, failedProbes }), { mode: 0o600 });
        throw Error('OLD_DEPLOYMENT_URL_NOT_PAUSED');
      }
      const current = await api('/v9/projects/' + entry.id);
      if (!current.paused || current.installCommand !== 'node -e "process.exit(78)"') throw Error('MAINTENANCE_CONFIGURATION_MISMATCH');
    }
    const evidence = { reference: 'local-backup-maintenance-' + randomUUID(), verified: true,
      verifiedAt: new Date().toISOString(), backendProjectId: projects[1].id, supabaseRef: 'izsujcwyuirkzkafhfnp', coverage };
    await writeFile(path.join(directory, 'maintenance-evidence.json'), JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(jobDirectory, 'scripts/private-backup/maintenance.json'), JSON.stringify(evidence), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(evidence));
  }
} catch (error) {
  let restored = false;
  if (changed && prior) { try { await restore(prior); restored = true; } catch {} }
  console.error(JSON.stringify({ code: 'MAINTENANCE_PREPARATION_FAILED', stage, previousConfigurationRestored: restored,
    reason: /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'BLOCK_OR_CONFIGURATION_NOT_VERIFIED' }));
  process.exitCode = 1;
}
