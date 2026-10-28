import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { prisma } from "../lib/prisma";
import { withPrivateUser } from "../privacy/access";
import { signAccessToken } from "../utils/jwt";
import { startDigiLockerSession } from "../services/digilocker/digilocker.service";

// Offline build/CLI verification only. Never mount this script on an HTTP route.
// All writes are to unique synthetic owners; existing accounts are never used.
async function main() {
  if (process.env.DIGILOCKER_HOSTED_VERIFICATION !== "1") throw new Error("Explicit hosted verification opt-in required");
  const base = "https://backend-three-sage-78.vercel.app";
  const ids = [randomUUID(), randomUUID()];
  const checks: { name: string; passed: boolean }[] = [];
  const timings: number[] = [];
  const statuses: Record<string, number> = {};
  let peakConnections = 0;
  const asOwner = <T>(index: number, work: () => T) => withPrivateUser(ids[index], work);
  const tokens = ids.map(id => signAccessToken({ sub: id, authVersion: 0 }));
  async function request(path: string, owner = 0, init: RequestInit = {}) {
    const start = performance.now();
    const response = await fetch(base + path, { ...init, redirect: "manual", signal: AbortSignal.timeout(25_000), headers: {
      Authorization: `Bearer ${tokens[owner]}`, "Content-Type": "application/json", Origin: "https://readines.com", ...init.headers,
    } });
    return { response, elapsed: performance.now() - start };
  }
  const check = (name: string, value: boolean) => { checks.push({name,passed:value}); console.log(JSON.stringify({event:"digilocker_hosted_check",name,passed:value})); assert(value,name); };
  try {
    for (let index = 0; index < ids.length; index++) await asOwner(index, () => prisma.user.create({ data: {
      id: ids[index], name: "Disposable DigiLocker verification", email: `${ids[index]}@example.invalid`, aiProcessingEnabled: false,
    } }));
    const session = await asOwner(0, () => startDigiLockerSession({ userId: ids[0] }));
    const own = await request(`/api/integrations/digilocker/sessions/${session.id}/status`);
    check("authenticated owner can read pending session", own.response.status === 200);
    check("private response disables caching", (own.response.headers.get("cache-control") ?? "").includes("no-store"));
    for (const suffix of ["status","documents","cancel","import"]) {
      const mutation = ["cancel","import"].includes(suffix);
      const result = await request(`/api/integrations/digilocker/sessions/${session.id}/${suffix}`,1, mutation ? {method:"POST",body:JSON.stringify(suffix==="import"?{references:["fixture"],consent:true,consentVersion:"digilocker-copy-v1"}:{})}:{});
      check(`cross-account ${suffix} denied`,result.response.status===404);
    }
    for (const body of [{references:["fixture"],consent:false,consentVersion:"digilocker-copy-v1"},{references:Array.from({length:51},(_,i)=>String(i)),consent:true,consentVersion:"digilocker-copy-v1"}]) {
      const result=await request(`/api/integrations/digilocker/sessions/${session.id}/import`,0,{method:"POST",body:JSON.stringify(body)});
      check("invalid consent or batch boundary rejected",result.response.status===400);
    }
    const pendingImport=await request(`/api/integrations/digilocker/sessions/${session.id}/import`,0,{method:"POST",body:JSON.stringify({references:["fixture"],consent:true,consentVersion:"digilocker-copy-v1"})});
    check("pending OAuth session cannot import",pendingImport.response.status===409);
    const forged=await fetch(base+`/api/integrations/digilocker/sessions/${session.id}/status`,{headers:{Authorization:"Bearer forged"},signal:AbortSignal.timeout(25000)});
    check("forged access token denied",forged.status===401);
    const worker=await fetch(base+"/api/integrations/digilocker/worker",{signal:AbortSignal.timeout(25000)});
    check("scheduler endpoint rejects unauthenticated calls",worker.status===401);
    const fakeState="verification-invalid-state-"+randomUUID();
    for(let attempt=0;attempt<2;attempt++) {
      const result=await request("/api/integrations/digilocker/callback?state="+fakeState+"&code=invalid-code");
      check("invalid/replayed OAuth state never authenticates",result.response.status===303 && (result.response.headers.get("location")??"").includes("invalid_state"));
    }
    // Expired crash fixture has no provider token or document consent. Recovery
    // must be autonomous: do not poll its status or invoke the worker manually.
    const expired=await asOwner(1,()=>startDigiLockerSession({userId:ids[1]}));
    await asOwner(1,()=>prisma.digiLockerConsentSession.update({where:{id:expired.id},data:{status:"IMPORTING",expiresAt:new Date(Date.now()-120000),encryptedCredentials:null,importLeaseToken:"synthetic-crashed-worker",importLeaseUntil:new Date(Date.now()-120000)}}));
    const deadline=Date.now()+100000;
    let recovered=false;
    while(Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,5000));
      const row=await asOwner(1,()=>prisma.digiLockerConsentSession.findFirstOrThrow({where:{id:expired.id,userId:ids[1]}}));
      if(row.status==="EXPIRED" && row.importLeaseToken===null && row.encryptedCredentials===null){recovered=true;break;}
    }
    check("minute scheduler expires abandoned lease without browser polling",recovered);
    const sampleConnections=async()=>{const rows=await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity`;peakConnections=Math.max(peakConnections,Number(rows[0].count));};
    const stages=[];
    for(const concurrency of [1,4,8]) {
      const stage:number[]=[];
      await Promise.all(Array.from({length:concurrency},async()=>{
        for(let i=0;i<8;i++) { const result=await request(`/api/integrations/digilocker/sessions/${session.id}/status`);await result.response.arrayBuffer();stage.push(result.elapsed);timings.push(result.elapsed);statuses[result.response.status]=(statuses[result.response.status]??0)+1; }
      }));
      await sampleConnections();stage.sort((a,b)=>a-b);stages.push({concurrency,requests:stage.length,p95Ms:stage[Math.ceil(stage.length*.95)-1],p99Ms:stage[Math.ceil(stage.length*.99)-1]});
    }
    check("bounded authenticated load has no failed responses",Object.keys(statuses).every(status=>status==="200"));
    const cancelled=await request(`/api/integrations/digilocker/sessions/${session.id}/cancel`,0,{method:"POST"});
    check("owner cancellation succeeds",cancelled.response.status===200);
    const importAfterCancel=await request(`/api/integrations/digilocker/sessions/${session.id}/import`,0,{method:"POST",body:JSON.stringify({references:["fixture"],consent:true,consentVersion:"digilocker-copy-v1"})});
    check("cancelled session cannot replay imports",importAfterCancel.response.status===409);
    console.log(JSON.stringify({event:"digilocker_hosted_verification",checks,stages,statuses,observedConnections:peakConnections,scope:"Current deployed API; bounded authenticated fixture load; no real provider download; not saturation testing"}));
  } finally {
    for(let index=0;index<ids.length;index++) await asOwner(index,()=>prisma.user.deleteMany({where:{id:ids[index]}}));
    await prisma.$disconnect();
  }
}
void main().catch(()=>{console.error(JSON.stringify({event:"digilocker_hosted_verification_failed",details:"Inspect the preceding named assertion; no credentials or private content are logged"}));process.exitCode=1;});
