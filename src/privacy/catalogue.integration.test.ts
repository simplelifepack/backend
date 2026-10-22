import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { withPrivateMigration, withPrivateUser } from "./access";
const url=process.env.PRIVACY_TEST_DATABASE_URL;
if(!url||!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(url))throw new Error("Use isolated privacy_test.");
process.env.DATABASE_URL=url;process.env.DIRECT_URL=url;process.env.PRIVATE_DATA_KEYRING_JSON=JSON.stringify({catalogue:`base64:${randomBytes(32).toString("base64")}`});process.env.PRIVATE_DATA_ACTIVE_KEY_ID="catalogue";process.env.PRIVATE_DATA_LOOKUP_KEY=`base64:${randomBytes(32).toString("base64")}`;
const raw=new PrismaClient({log:[]});const owner=randomUUID(),stranger=randomUUID(),sample=`PRIVATE-PACK-${randomUUID()}`;
async function run(){
 const {prisma}=await import("../lib/prisma");const packs=await import("../services/packs.service");const admin=await import("../services/adminPackages.service");
 const ids:string[]=[];
 await raw.$executeRawUnsafe('ALTER TABLE "Requirement" DROP CONSTRAINT IF EXISTS "Requirement_privacy_owner_fkey"');
 await raw.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ReadinessPack_id_createdBy_key" ON "ReadinessPack"("id", "createdBy")');
 const sql=(await fs.readFile("prisma/migrations/20261015234500_private_catalogue_fields/migration.sql","utf8")).replace(/^\s*--.*$/gm,"").split(";").filter(item=>item.trim());
 for(const table of ["ReadinessPack","Requirement","account_export_jobs"])await raw.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_private_v2"`);
 await raw.$executeRawUnsafe('ALTER TABLE "ReadinessPack" DROP CONSTRAINT IF EXISTS "catalogue_provenance_v2"');
 try{
  await withPrivateMigration("synthetic fixture",()=>prisma.user.createMany({data:[{id:owner,name:"Owner",email:`${owner}@example.test`},{id:stranger,name:"Other",email:`${stranger}@example.test`}]}));
  const custom=await raw.readinessPack.create({data:{title:sample,slug:sample.toLowerCase(),category:sample,description:sample,aliases:[sample],keywords:[sample],createdBy:owner,requirements:{create:{id:`${sample}:private-title`,title:sample,description:sample,group:sample,acceptedDocumentTypes:[sample],alternativeLabels:[sample],metadata:{sample}}}}});ids.push(custom.id);
  const legacyAi=await raw.readinessPack.create({data:{title:sample,slug:`ai-${sample.toLowerCase()}`,category:sample,description:sample,aliases:[sample],keywords:[sample],createdBy:"ai"}});ids.push(legacyAi.id);
  const publicPack=await raw.readinessPack.create({data:{title:"Public requirements",slug:`public-${owner}`,category:"Public",description:"Official checklist",aliases:[sample],keywords:[sample],searchMetadata:{sample},createdBy:"seed",cataloguePrivacyVersion:null}});ids.push(publicPack.id);
  for(const statement of sql.filter(item=>item.includes("ADD CONSTRAINT")))await raw.$executeRawUnsafe(statement);
  const provenance=(await fs.readFile("prisma/migrations/20261015235000_quarantine_legacy_catalogue_metadata/migration.sql","utf8")).replace(/^\s*--.*$/gm,"").split(";").find(item=>item.includes("ADD CONSTRAINT"))!;await raw.$executeRawUnsafe(provenance);
  const migrate=(...args:string[])=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/scripts/migratePrivateRecords.ts",...args],{env:process.env,encoding:"utf8"}).trim());
  assert.equal(migrate().models.ReadinessPack.pending,3);assert.equal(migrate("--apply").models.Requirement.updated,1);assert.equal(migrate("--verify").models.ReadinessPack.pending,0);assert.equal(migrate("--apply").models.Requirement.updated,0);
  for(const row of await raw.readinessPack.findMany({where:{id:{in:ids}}}))assert(!JSON.stringify(row).includes(sample));
  const req=await raw.requirement.findFirstOrThrow({where:{packId:custom.id}});assert(!JSON.stringify(req).includes(sample));assert.match(req.id,/^[0-9a-f-]{36}$/);
  assert.equal((await prisma.readinessPack.findMany({where:{id:{in:ids}}})).length,1);
  assert(!JSON.stringify(await admin.listAdminPackages({page:1,limit:100})).includes(sample));
  await withPrivateUser(owner,async()=>{
   const loaded=await packs.getReadinessPackDefinitionBySlugForUser(custom.slug,owner);assert.equal(loaded?.title,sample);assert.equal(loaded?.requirements[0].title,sample);
   const created=await packs.createCustomPack(owner,{title:sample,description:sample,requirements:[sample]});assert(created);ids.push(created!.id);
   assert.equal(created!.requirements[0].title,sample);
   await packs.updateCustomPack(owner,created!.slug,{title:`${sample}-updated`,requirements:[sample]});
   assert.equal((await packs.getReadinessPackDefinitionBySlugForUser(created!.slug,owner))?.title,`${sample}-updated`);
   const listed=await packs.listPackageSummaries({userId:owner,page:1,limit:100,sort:"title"});assert(listed.items.some(item=>item.id===custom.id));
   assert.equal(await admin.getAdminPackage(custom.slug),null);
  });
  await withPrivateUser(stranger,async()=>{assert.equal(await packs.getReadinessPackDefinitionBySlugForUser(custom.slug,stranger),null);assert.equal(await prisma.readinessPack.findUnique({where:{id:legacyAi.id}}),null);});
  await assert.rejects(raw.requirement.create({data:{packId:custom.id,title:sample,description:sample,group:sample,acceptedDocumentTypes:[],alternativeLabels:[]}}));
  await assert.rejects(raw.requirement.create({data:{packId:custom.id,privacyOwnerId:"seed",title:sample,description:sample,group:sample,acceptedDocumentTypes:[],alternativeLabels:[]}}));
  await raw.$executeRawUnsafe('ALTER TABLE "Requirement" VALIDATE CONSTRAINT "Requirement_privacy_owner_fkey"');
  for(const table of ["ReadinessPack","Requirement","account_export_jobs"])await raw.$executeRawUnsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${table}_private_v2"`);
  await raw.$executeRawUnsafe('ALTER TABLE "ReadinessPack" VALIDATE CONSTRAINT "catalogue_provenance_v2"');
  console.log("PASS: private catalogue/query duplicates encrypted, legacy global AI quarantined, contaminated seed metadata archived, requirement IDs made opaque, authorized custom CRUD/search, public/admin redaction and isolation.");
 }finally{await raw.readinessPack.deleteMany({where:{id:{in:ids}}});await raw.user.deleteMany({where:{id:{in:[owner,stranger]}}});await Promise.all([raw.$disconnect(),prisma.$disconnect()]);}
}
run().catch(error=>{console.error("Catalogue privacy test failed.",{name:error.name,code:error.code,argument:String(error.message).match(/Unknown argument `([A-Za-z_]+)`/)?.[1],frames:String(error.stack).split("\n").filter((line:string)=>/^\s+at /.test(line)).slice(-5)});process.exitCode=1;});
