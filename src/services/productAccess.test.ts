import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";

test("Trust and Wealth work without subscriptions; anonymous access rejected", async()=>{
  const previous=global.__prisma__;
  global.__prisma__={
    user:{findUnique:async()=>({id:"member",name:"Member",email:"member@example.test"})},
    trustMember:{findMany:async()=>[]},
    wealthRecord:{findMany:async(query:{where:{ownerUserId:string}})=>{assert.equal(query.where.ownerUserId,"member");return[];}},
    $queryRaw:async()=>[{exists:true}],
  } as unknown as PrismaClient;
  try{
    const {getTrustCenter}=await import("./trustCenter.service");const {listWealthRecords}=await import("./wealthRecords.service");const {requireAuth}=await import("../middleware/requireAuth");
    const trust=await getTrustCenter("member");assert.equal(trust.owner?.id,"member");
    for(const field of ["plan","entitlements","memberLimit","remainingSlots","subscription"])assert.equal(field in trust,false);
    assert.deepEqual(await listWealthRecords("member"),[]);
    let status=0,nextCalled=false;
    const response={setHeader(){},status(value:number){status=value;return response;},json(){return response;}};
    await requireAuth({headers:{},get:()=>undefined} as never,response as never,()=>{nextCalled=true;});assert.equal(status,401);assert.equal(nextCalled,false);
  }finally{global.__prisma__=previous;}
});
