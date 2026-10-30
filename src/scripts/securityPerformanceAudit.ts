/* Local synthetic audit only. No implicit production/staging targets or providers. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { once } from "node:events";
import { performance, PerformanceObserver } from "node:perf_hooks";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const target = new URL(process.env.DATABASE_URL || "http://invalid");
if (target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/readines_audit_test" || process.env.STORAGE_DRIVER !== "local") throw new Error("Requires disposable readines_audit_test on localhost:55439 and local storage.");
process.env.RATE_LIMIT_MAX = "100000";
process.env.AUTH_RATE_LIMIT_MAX = "100000";
process.env.LOGIN_ACCOUNT_RATE_LIMIT_MAX = "100000";
process.env.UPLOAD_RATE_LIMIT_MAX = "100000";
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, options?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "127.0.0.1") throw new Error("External providers disabled in local audit.");
  return realFetch(input, options);
}) as typeof fetch;

async function run() {
  const { app } = await import("../app");
  const { prisma } = await import("../lib/prisma");
  const { withPrivateUser } = await import("../privacy/access");
  const { signAccessToken } = await import("../utils/jwt");
  const { mountedApiOperations } = await import("../docs/mountedOperations");
  const { encryptDocumentOnBackend } = await import("../services/documentHybridEncryption");
  const { createEncryptedTemporaryUpload, saveEncryptedPermanentFile, cleanupTemporaryUploads } = await import("../services/documentFileStorage");
  const { setDocumentAnalyzerForTests } = await import("../services/documentAnalyzer");
  const sharp = (await import("sharp")).default;
  const raw = new PrismaClient({log:[]});
  const users = Array.from({length:500},(_,i)=>({id:randomUUID(),name:`Synthetic ${i}`}));
  const passwordHash = await bcrypt.hash("Audit-password-123!",4);
  const packId=randomUUID(), slug=`audit-${packId}`;
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const tokens=users.map(user=>signAccessToken({sub:user.id}));
  const headers=(index=0)=>({Authorization:`Bearer ${tokens[index]}`});
  const results: unknown[]=[]; const checks: unknown[]=[];
  let peakRSS=0,peakHeap=0,gcCount=0,gcMs=0;
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){gcCount++;gcMs+=entry.duration;}});observer.observe({entryTypes:["gc"]});
  const sample=()=>{const m=process.memoryUsage();peakRSS=Math.max(peakRSS,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);};
  const sampler=setInterval(sample,10);
  try {
    for(let i=0;i<users.length;i+=20) await Promise.all(users.slice(i,i+20).map(user=>withPrivateUser(user.id,()=>prisma.user.create({data:{...user,email:`${user.id}@example.test`,passwordHash,aiProcessingEnabled:false},select:{id:true}}))));
    await raw.readinessPack.create({data:{id:packId,slug,title:"Synthetic audit package",description:"Synthetic audit checklist",category:"Other",createdBy:"seed",aliases:[],keywords:[]}});
    const owner=users[0].id;
    const png=await sharp({create:{width:64,height:64,channels:3,background:"white"}}).png().toBuffer();
    const envelope=encryptDocumentOnBackend(png,{filename:"synthetic.png",mimeType:"image/png"});
    const doc=await withPrivateUser(owner,async()=>{
      const temporary=await createEncryptedTemporaryUpload(owner,envelope);
      const documentId=randomUUID();const saved=await saveEncryptedPermanentFile(owner,documentId,temporary,{preserveTemporaryFile:true});
      const document=await prisma.document.create({data:{...saved,id:documentId,ownerProfileId:owner,originalName:"synthetic.png",title:"Synthetic",mimeType:"image/png",size:png.length,analysisSource:"manual",category:"Other",documentType:"Synthetic",confidence:100,fields:{}}});
      // Cleanup must not remove unexpired consumed files still used by copy workers.
      await prisma.temporaryUpload.update({where:{id:temporary.id},data:{status:"consumed",consumedAt:new Date()}});
      await cleanupTemporaryUploads();await fs.access(temporary.storagePath);
      checks.push({name:"unexpired consumed upload survives cleanup",status:"Pass"});
      return document;
    });
    for(const path of [`/documents/${doc.id}`,`/documents/${doc.id}/preview`,`/documents/${doc.id}/download`]) {
      const response=await fetch(base+path,{headers:headers(1)});assert.equal(response.status,404);await response.text();checks.push({name:`cross-user ${path.replace(doc.id,"{id}")}`,status:"Pass"});
    }
    const own=await fetch(`${base}/documents/${doc.id}/download`,{headers:headers()});assert.equal(own.status,200);assert.deepEqual(Buffer.from(await own.arrayBuffer()),png);checks.push({name:"encrypted document round trip",status:"Pass"});
    const publicOperation=(op:string)=>op==="GET /health"||op==="GET /api/billing/plans"||op==="POST /api/billing/webhook"||op.includes("/waitlist")||(/^POST \/auth\//.test(op)&&!op.includes("/account/")&&!op.endsWith("/logout-all"))||op.includes("/trust/invitations/")||op.includes("/digilocker/callback");
    for(const operation of mountedApiOperations().filter(op=>!publicOperation(op))){
      const [method,path]=operation.split(" ");const response=await fetch(base+path.replace(/\{[^}]+\}/g,"audit-unowned"),{method});await response.text();
      checks.push({name:`unauthenticated ${operation}`,status:[401,403].includes(response.status)?"Pass":"Fail",http:response.status});
    }
    assert(checks.every(check=>(check as {status:string}).status==="Pass"),"Unauthenticated endpoint inventory failed");
    const multipart=()=>{const body=new FormData();const {ciphertext,...metadata}=envelope;body.append("encryptedFiles",new Blob([new Uint8Array(ciphertext)],{type:"application/octet-stream"}),"encrypted.bin");body.append("envelopes",JSON.stringify([metadata]));return body;};
    let analyzerCalls=0;setDocumentAnalyzerForTests({analyzeDocument:async()=>{analyzerCalls++;throw new Error("AI must not run when disabled in settings");}});
    const noConsent=await fetch(`${base}/documents/analyze`,{method:"POST",headers:headers(2),body:multipart()});assert.equal(noConsent.status,200,await noConsent.text());assert.equal(analyzerCalls,0);checks.push({name:"settings-disabled upload never calls AI",status:"Pass"});
    async function load(name:string,count:number,work:(index:number)=>Promise<Response>){
      // Establish transport connections with idempotent health requests first.
      // macOS somaxconn=128 resets cold bursts before Express sees requests.
      let warmupResets = 0;
      await Promise.all(Array.from({length:count}, async () => {
        for (let attempt=0;attempt<5;attempt++) {
          try { const response=await fetch(base+"/health"); await response.arrayBuffer(); return; }
          catch { warmupResets++; await new Promise(resolve=>setTimeout(resolve,25)); }
        }
        throw new Error("Unable to establish local transport connections.");
      }));
      peakRSS=0;peakHeap=0;const cpu=process.cpuUsage(),start=performance.now();const latencies:number[]=[],statuses:Record<string,number>={};let timeouts=0; const errors: Record<string,number> = {};
      await Promise.all(Array.from({length:count},async(_,i)=>{const t=performance.now();try{const response=await work(i);await response.arrayBuffer();statuses[response.status]=(statuses[response.status]||0)+1;}catch(error){ const failure=error as {name?:string;cause?:{code?:string}}; const code=failure.cause?.code??failure.name??"unknown"; errors[code]=(errors[code]||0)+1; if(failure.name==="TimeoutError")timeouts++;}latencies.push(performance.now()-t);sample();}));
      latencies.sort((a,b)=>a-b);const elapsed=performance.now()-start;const usage=process.cpuUsage(cpu);const connections=await raw.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()`;
      results.push({name,count,warmupResets,rps:count/(elapsed/1000),statuses,errors,timeouts,p50:latencies[Math.floor(count*.5)],p95:latencies[Math.floor(count*.95)],p99:latencies[Math.min(count-1,Math.floor(count*.99))],peakRSS,peakHeap,cpuMs:(usage.user+usage.system)/1000,databaseConnections:Number(connections[0].count)});
    }
    for(const count of [100,250,500]){
      await load("packages",count,i=>fetch(base+"/packages?limit=20",{headers:headers(i),signal:AbortSignal.timeout(60000)}));
      await load("login",count,i=>fetch(base+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:`${users[i].id}@example.test`,password:"Audit-password-123!"}),signal:AbortSignal.timeout(60000)}));
      await load("mixed",count,i=>fetch(base+["/auth/me","/packages?limit=20","/api/search?q=audit","/api/health/home-attention","/documents"][i%5],{headers:headers(i),signal:AbortSignal.timeout(60000)}));
    }
    for(const count of [100,250])await load("search",count,i=>fetch(base+"/api/search?q=audit",{headers:headers(i),signal:AbortSignal.timeout(60000)}));
    for(const count of [25,50,100]){
      await load("upload",count,i=>fetch(base+"/documents/analyze",{method:"POST",headers:headers(i),body:multipart(),signal:AbortSignal.timeout(60000)}));
      await load("encrypted-download",count,()=>fetch(`${base}/documents/${doc.id}/download`,{headers:headers(),signal:AbortSignal.timeout(60000)}));
    }
    const memory=[];for(let cycle=0;cycle<5;cycle++){await load("upload-download-cycle",20,i=>i%2?fetch(`${base}/documents/${doc.id}/download`,{headers:headers()}):fetch(base+"/documents/analyze",{method:"POST",headers:headers(i),body:multipart()}));global.gc?.();memory.push(process.memoryUsage());}
    checks.push({name:"AI generation external-provider load 10/25/50",status:"Not Tested",reason:"No provider requests allowed; no synthetic provider timings reported as real AI performance."});
    await fs.mkdir("docs/security/audit-evidence",{recursive:true});await fs.writeFile("docs/security/audit-evidence/local-http.json",JSON.stringify({date:"2026-10-25",notes:["500 synthetic accounts; bcrypt cost 4; local PostgreSQL; provider requests blocked","Rate limits raised only in test process for capacity measurement","Client and server share process; memory/CPU include both","Upload payload: 64x64 synthetic PNG; not large-file capacity evidence","Package GET stage warms connections before non-idempotent login POST stage; cold-connection failures retained separately"],checks,results,memory,gcCount,gcMs},null,2));
    console.log(`Completed ${checks.length} security checks and ${results.length} load scenarios.`);
  } finally {
    clearInterval(sampler);observer.disconnect();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await raw.document.deleteMany({where:{ownerProfileId:{in:users.map(u=>u.id)}}});await raw.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});await raw.readinessPack.deleteMany({where:{id:packId}});
    await Promise.all([prisma.$disconnect(),raw.$disconnect()]);
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
