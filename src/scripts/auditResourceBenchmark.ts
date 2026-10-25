import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import express from "express";
import { createStoredZip, streamStoredZip, type ArchiveFile } from "../services/archiveZip";

async function run() {
  const mode=process.argv[2]; if(!["before","after"].includes(mode))throw new Error("Expected before or after");
  const baselinePath=path.resolve(__dirname,"../middleware/upload.audit-baseline.ts");
  if(mode==="before") await fs.writeFile(baselinePath,execFileSync("git",["show","a64181a:src/middleware/upload.ts"]));
  const filename=mode==="before"?"../middleware/upload.audit-baseline":"../middleware/upload";
  const {encryptedUpload}=await import(filename);
  const app=express();app.post("/upload",encryptedUpload.array("encryptedFiles",50),(req,res)=>res.json({bytes:(req.files as Express.Multer.File[]).reduce((n,f)=>n+f.size,0)}));
  app.use((error:{statusCode?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.statusCode??400).end());
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/upload`;
  const samples:unknown[]=[];const archive:unknown[]=[];
  try{
    const body=new FormData();for(let i=0;i<2;i++)body.append("encryptedFiles",new Blob([new Uint8Array(6*1024*1024)],{type:"application/octet-stream"}),"part.bin");
    const over=await fetch(url,{method:"POST",body});await over.text();const oversizedStatus=over.status;
    for(let cycle=0;cycle<5;cycle++){
      const start=performance.now();for(let i=0;i<10;i++){const part=new FormData();part.append("encryptedFiles",new Blob([new Uint8Array(1024*1024)],{type:"application/octet-stream"}),"part.bin");const response=await fetch(url,{method:"POST",body:part});if(response.status!==200)throw Error("Upload failed");await response.text();}
      global.gc?.();samples.push({cycle,ms:performance.now()-start,...process.memoryUsage()});
    }
    for(let cycle=0;cycle<3;cycle++){
      global.gc?.();const initial=process.memoryUsage();let peak=initial.rss;const start=performance.now();const hash=createHash("sha256");
      const sample=()=>{peak=Math.max(peak,process.memoryUsage().rss);};
      const file=(i:number):ArchiveFile=>({name:`file-${i}.pdf`,data:Buffer.alloc(1024*1024,i),modifiedAt:new Date(2026,0,1)});
      if(mode==="before"){
        const files=Array.from({length:100},(_,i)=>file(i));sample();const zip=createStoredZip(files);sample();hash.update(zip);
      }else{
        async function* source(){for(let i=0;i<100;i++)yield file(i);}
        for await(const chunk of streamStoredZip(source())){hash.update(chunk);sample();}
      }
      const digest=hash.digest("hex");global.gc?.();archive.push({cycle,ms:performance.now()-start,startRSS:initial.rss,peakRSS:peak,digest,afterGC:process.memoryUsage()});
    }
    await fs.mkdir("docs/security/audit-evidence",{recursive:true});await fs.writeFile(`docs/security/audit-evidence/resource-${mode}.json`,JSON.stringify({mode,notes:"Client and server share process. Upload: 50 x 1 MiB; ZIP: 100 x 1 MiB, three rounds. Explicit GC between rounds. Before uses original upload middleware; archive bytes compared via SHA-256.",oversizedStatus,samples,archive},null,2));
    console.log(`${mode}: oversized=${oversizedStatus}, ZIP peakRSS=${Math.max(...archive.map(v=>(v as {peakRSS:number}).peakRSS))}`);
  }finally{if(mode==="before")await fs.rm(baselinePath,{force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
