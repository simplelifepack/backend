import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PostgresRateLimitStore } from "./postgresRateLimitStore";
const url=new URL(process.env.DATABASE_URL||"http://invalid");
test("rate limits share atomic counters across clients, isolate scopes and expire",{skip:url.hostname!=="127.0.0.1"||url.port!=="55439"||url.pathname!=="/readines_audit_test"},async()=>{
  const one=new PrismaClient({log:[]}),two=new PrismaClient({log:[]});const key=randomUUID();const a=new PostgresRateLimitStore("audit-a",60000,one),b=new PostgresRateLimitStore("audit-a",60000,two),c=new PostgresRateLimitStore("audit-b",60000,two);
  try{
    const increments=await Promise.all(Array.from({length:40},(_,i)=>(i%2?a:b).increment(key)));assert.deepEqual(increments.map(r=>r.totalHits).sort((a,b)=>a-b),Array.from({length:40},(_,i)=>i+1));
    assert.equal((await c.increment(key)).totalHits,1);
    await one.$executeRaw`UPDATE "WaitlistRateLimit" SET "expiresAt" = timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '1 second' WHERE "key" LIKE 'api:%'`;
    assert.equal((await b.increment(key)).totalHits,1);
    const rows=await one.$queryRaw<Array<{key:string}>>`SELECT "key" FROM "WaitlistRateLimit" WHERE "key" LIKE 'api:%'`;assert(rows.every(row=>!row.key.includes(key)));
    await a.resetKey(key);assert.equal((await b.increment(key)).totalHits,1);
  }finally{await Promise.all([a.resetKey(key),c.resetKey(key)]);await Promise.all([one.$disconnect(),two.$disconnect()]);}
});
