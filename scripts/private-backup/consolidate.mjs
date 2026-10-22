import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createWriter,decodeBackup,sha256} from './transport.mjs';
import {assembleStorageParts} from './assemble.mjs';
const [directory,keyFile]=process.argv.slice(2);
try {
 const key=await readFile(keyFile);
 const root=decodeBackup((await readFile(path.join(directory,'production-backup.rpb'),'utf8')).trim().split('\n'),key);
 const parts=[];
 for(const file of (await readdir(directory)).filter(name=>/^part-\d+-\d+\.rpb$/.test(name)))parts.push(decodeBackup((await readFile(path.join(directory,file),'utf8')).trim().split('\n'),key));
 if(root.manifest.report.objectBytesIncluded===false)for(const [name,bytes]of assembleStorageParts(root,parts))root.entries.set(name,bytes);
 const recipient=JSON.parse(await readFile(path.join(directory,'recipient.json'),'utf8'));
 if(recipient.backupId!==root.manifest.backupId)throw Error('RECIPIENT_MISMATCH');
 const lines=[];const writer=createWriter(recipient.publicKey,recipient.backupId,line=>lines.push(line));
 for(const [name,bytes]of root.entries)if(name!=='manifest.json')writer.write(name,bytes);
 writer.finish({...root.manifest.report,kind:'complete-database-and-storage',objectBytesIncluded:true,encryptedPartsAssembled:parts.length,packagedAt:new Date().toISOString()});
 const verified=decodeBackup(lines,key);
 if(verified.entries.size!==root.entries.size)throw Error('ENTRY_COUNT_MISMATCH');
 for(const [name,bytes]of root.entries)if(name!=='manifest.json'&&sha256(verified.entries.get(name))!==sha256(bytes))throw Error('ENTRY_HASH_MISMATCH');
 const archive=Buffer.from(lines.join('\n')+'\n');
 await writeFile(path.join(directory,'complete-production-backup.rpb'),archive,{flag:'wx',mode:0o600});
 const report={completeArchiveCreated:true,entries:verified.entries.size,objects:root.manifest.report.objects,objectBytes:root.manifest.report.bytes,archiveBytes:archive.length,archiveSha256:sha256(archive),allSourceEntriesIdentical:true,applicationKeysExported:false,createdAt:new Date().toISOString()};
 await writeFile(path.join(directory,'complete-archive-report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report));
}catch{console.error('BACKUP_CONSOLIDATION_FAILED');process.exitCode=1;}
