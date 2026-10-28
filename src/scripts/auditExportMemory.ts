import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createStoredZip, streamStoredZip, type ArchiveFile } from "../services/archiveZip";
import { decryptPrivateBytes, encryptPrivateBytes, encryptPrivateStreamToFile, openVerifiedPrivateFile } from "../privacy/fieldEncryption";

async function run(){
  const mode=process.argv[2];if(!["before","after"].includes(mode))throw Error("Expected before or after");
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"export-memory-audit-"));const file=path.join(directory,"archive.enc");
  const binding={model:"AccountExportJob",recordId:"audit",ownerId:"synthetic",field:"archive"};const hash=createHash("sha256");
  const item=(index:number):ArchiveFile=>({name:`synthetic-${index}.pdf`,data:Buffer.alloc(1024*1024,index),modifiedAt:new Date(2026,0,1)});
  global.gc?.();let peakRSS=process.memoryUsage().rss;const startRSS=peakRSS,start=performance.now();const sample=()=>{peakRSS=Math.max(peakRSS,process.memoryUsage().rss);};const timer=setInterval(sample,5);
  try{
    if(mode==="before"){
      const files=Array.from({length:100},(_,index)=>item(index));sample();const zip=createStoredZip(files);sample();files.forEach(file=>file.data.fill(0));
      const encrypted=encryptPrivateBytes(zip,binding);sample();const stored=Buffer.from(encrypted);sample();zip.fill(0);
      const decrypted=decryptPrivateBytes(stored.toString("utf8"),binding);sample();hash.update(decrypted);decrypted.fill(0);
    }else{
      async function* source(){for(let index=0;index<100;index++){const file=item(index);try{yield file;sample();}finally{file.data.fill(0);}}}
      await encryptPrivateStreamToFile(streamStoredZip(source()),binding,file);sample();
      const verified=await openVerifiedPrivateFile(file,binding);try{for await(const chunk of verified.stream){hash.update(chunk);sample();}}finally{await verified.dispose();}
    }
    global.gc?.();await fs.writeFile(`docs/security/audit-evidence/export-${mode}.json`,JSON.stringify({mode,notes:"Synthetic 100 x 1 MiB archive; before reproduces buffered encrypted export creation/download; after streams through enc:v2 ciphertext file and authenticates completely before streaming download; no plaintext written to disk.",startRSS,peakRSS,elapsedMs:performance.now()-start,sha256:hash.digest("hex"),afterGC:process.memoryUsage()},null,2));console.log(`${mode}: peakRSS=${peakRSS}`);
  }finally{clearInterval(timer);await fs.rm(directory,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
