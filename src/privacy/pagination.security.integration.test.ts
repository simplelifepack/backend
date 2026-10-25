import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { encryptedClient } from "./encryptedClient";
import { withPrivateUser } from "./access";
const url=new URL(process.env.DATABASE_URL||"http://invalid");
test("operational pagination executes in PostgreSQL while private filtering retains correct results",{skip:url.hostname!=="127.0.0.1"||url.port!=="55439"||url.pathname!=="/readines_audit_test"},async()=>{
  const raw=new PrismaClient({log:[{emit:"event",level:"query"}]});const queries:string[]=[];raw.$on("query",event=>queries.push(event.query));const db=encryptedClient(raw);const id=randomUUID();
  try{await withPrivateUser(id,async()=>{
    await db.user.create({data:{id,name:"Page owner",email:`${id}@example.test`},select:{id:true}});
    for(let i=0;i<30;i++)await db.healthMember.create({data:{id:randomUUID(),userId:id,name:`Member ${String(i).padStart(2,"0")}`,relation:"SELF"}});
    queries.length=0;
    const page=await db.healthMember.findMany({where:{userId:id},orderBy:{id:"asc"},skip:5,take:4});assert.equal(page.length,4);assert(queries.some(query=>query.includes("LIMIT")&&query.includes("OFFSET")));
    const all=await db.healthMember.findMany({where:{userId:id},orderBy:{id:"asc"}});assert.deepEqual(page.map(row=>row.id),all.slice(5,9).map(row=>row.id));
    const privatePage=await db.healthMember.findMany({where:{userId:id,name:{contains:"Member 2"}},orderBy:{name:"asc"},skip:2,take:3});assert.deepEqual(privatePage.map(row=>row.name),["Member 22","Member 23","Member 24"]);
    const one=await db.healthMember.findFirst({where:{userId:id},orderBy:{id:"asc"}});assert.equal(one?.id,all[0].id);
  });}finally{await raw.user.deleteMany({where:{id}});await raw.$disconnect();}
});
