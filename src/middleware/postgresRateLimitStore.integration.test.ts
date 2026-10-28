import assert from "node:assert/strict";
import express from "express";
import rateLimit from "express-rate-limit";
import type { AddressInfo } from "node:net";
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

test("stacked shared limiters expose independent namespaces to validation", {skip:url.hostname!=="127.0.0.1"||url.port!=="55439"||url.pathname!=="/readines_audit_test"}, async () => {
  const db = new PrismaClient({log:[]});
  const key = randomUUID();
  const stores = [new PostgresRateLimitStore("stacked-general",60000,db), new PostgresRateLimitStore("stacked-auth",60000,db)];
  const app = express();
  const errors: unknown[][] = [];
  const previousError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  for (const store of stores) app.use(rateLimit({windowMs:60000,limit:5,store,keyGenerator:()=>key}));
  app.get("/", (_req,res) => res.sendStatus(204));
  const server = app.listen(0,"127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening",resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    assert.equal(response.status,204);
    assert.equal(errors.length,0,JSON.stringify(errors));
    assert.deepEqual(await Promise.all(stores.map(async store=>(await store.increment(key)).totalHits)),[2,2]);
  } finally {
    console.error = previousError;
    await new Promise<void>(resolve => server.close(()=>resolve()));
    await Promise.all(stores.map(store=>store.resetKey(key)));
    await db.$disconnect();
  }
});
