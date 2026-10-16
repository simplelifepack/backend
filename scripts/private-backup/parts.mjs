import { readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBackup } from './transport.mjs';

const [action, directory, keyFile, jobDirectory] = process.argv.slice(2);
if (!['submit','collect','status'].includes(action) || !directory || !keyFile) throw Error('PART_ACTION_REQUIRED');
const cli = '/Users/ranjith/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js';
const stateFile = path.join(directory,'part-deployments.json');
try {
  const key = await readFile(keyFile);
  const root = decodeBackup((await readFile(path.join(directory,'production-backup.rpb'),'utf8')).trim().split('\n'),key);
  const storage = JSON.parse(root.entries.get('storage-manifest.json'));
  let state = { backupId:root.manifest.backupId,deployments:[] };
  try { state=JSON.parse(await readFile(stateFile,'utf8')); } catch (error) { if(error.code!=='ENOENT')throw error; }
  if(state.backupId!==root.manifest.backupId)throw Error('PART_BACKUP_MISMATCH');
  const plan=[];
  for(let index=0;index<storage.objects.length;index++)for(let offset=0;offset<storage.objects[index].size;offset+=1048576)plan.push({index,offset,length:Math.min(1048576,storage.objects[index].size-offset),name:`part-${index}-${offset}`});
  if(action==='submit') {
    if(!jobDirectory)throw Error('JOB_DIRECTORY_REQUIRED');
    const configPath=path.join(jobDirectory,'vercel.json');
    const config=JSON.parse(await readFile(configPath,'utf8'));
    config.buildCommand='node scripts/private-backup/remote-storage-part.mjs';
    await writeFile(configPath,JSON.stringify(config),{mode:0o600});
    for(const item of plan) {
      if(state.deployments.some(entry=>entry.name===item.name))continue;
      const result=spawnSync(process.execPath,[cli,'deploy',jobDirectory,'--project','prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82','--scope','team_93cV3lkO3ZGYcihQkudd9ZR4','--prod','--skip-domain',
        '--build-env','PRIVATE_BACKUP_ENABLED=1','--build-env',`PRIVATE_BACKUP_PART_INDEX=${item.index}`,'--build-env',`PRIVATE_BACKUP_PART_OFFSET=${item.offset}`,'--build-env',`PRIVATE_BACKUP_PART_LENGTH=${item.length}`,
        '--meta','privacyPurpose=encrypted-backup-object-part','--yes','--no-wait','--json','--non-interactive'],{encoding:'utf8',timeout:120000,maxBuffer:1048576});
      if(result.status!==0)throw Error('PART_SUBMISSION_FAILED');
      const created=JSON.parse(result.stdout).deployment;
      if(!/^dpl_[A-Za-z0-9]+$/.test(created.id))throw Error('PART_DEPLOYMENT_INVALID');
      state.deployments.push({...item,id:created.id});
      await writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});
      console.log(JSON.stringify({submittedPart:item.name,deploymentId:created.id,totalParts:plan.length}));
    }
  } else if(action==='status') {
    const auth=JSON.parse(await readFile('/Users/ranjith/Library/Application Support/com.vercel.cli/auth.json','utf8'));
    const counts={};
    for(const item of state.deployments) {
      const response=await fetch(`https://api.vercel.com/v13/deployments/${item.id}?teamId=team_93cV3lkO3ZGYcihQkudd9ZR4`,{headers:{Authorization:'Bearer '+auth.token}});
      if(!response.ok)throw Error('PART_STATUS_FAILED');
      const deployment=await response.json();
      counts[deployment.readyState]=(counts[deployment.readyState]||0)+1;
    }
    console.log(JSON.stringify({expectedParts:plan.length,submittedParts:state.deployments.length,states:counts}));
  } else {
    let pending = 0;
    const auth=JSON.parse(await readFile('/Users/ranjith/Library/Application Support/com.vercel.cli/auth.json','utf8'));
    for(const item of state.deployments) {
      try {
        await access(path.join(directory,item.name+'.rpb'));
        const decoded=decodeBackup((await readFile(path.join(directory,item.name+'.rpb'),'utf8')).trim().split('\n'),key);
        if(decoded.manifest.backupId!==root.manifest.backupId)throw Error('PART_BACKUP_MISMATCH');
        continue;
      } catch(error) { if(error.code!=='ENOENT')throw error; }
      const response=await fetch(`https://api.vercel.com/v13/deployments/${item.id}?teamId=team_93cV3lkO3ZGYcihQkudd9ZR4`,{headers:{Authorization:'Bearer '+auth.token}});
      if(!response.ok)throw Error('PART_STATUS_FAILED');
      const deployment=await response.json();
      if(['QUEUED','BUILDING','INITIALIZING'].includes(deployment.readyState)){pending++;continue;}
      if(deployment.readyState!=='ERROR')throw Error('EXPORT_ONLY_BUILD_REQUIRED');
      const result=spawnSync(process.execPath,[fileURLToPath(new URL('./collect.mjs',import.meta.url)),item.id,directory,keyFile,item.name],{encoding:'utf8',timeout:60000,maxBuffer:1048576});
      if(result.status!==0)throw Error('PART_COLLECTION_FAILED');
      console.log(JSON.stringify({verifiedPart:item.name}));
    }
    console.log(JSON.stringify({expectedParts:plan.length,submittedParts:state.deployments.length,pendingParts:pending,collectionFinished:pending===0}));
  }
} catch {
  console.error(JSON.stringify({code:'BACKUP_PART_WORKFLOW_FAILED',action}));
  process.exitCode=1;
}
