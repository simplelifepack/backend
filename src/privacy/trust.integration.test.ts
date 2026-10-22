import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { withPrivateMigration, withPrivateUser } from "./access";
const url=process.env.PRIVACY_TEST_DATABASE_URL;
if(!url||!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(url))throw new Error("Use isolated privacy_test.");
process.env.DATABASE_URL=url;process.env.DIRECT_URL=url;process.env.EMAIL_PROVIDER="disabled";
process.env.PRIVATE_DATA_KEYRING_JSON=JSON.stringify({trust:`base64:${randomBytes(32).toString("base64")}`});process.env.PRIVATE_DATA_ACTIVE_KEY_ID="trust";process.env.PRIVATE_DATA_LOOKUP_KEY=`base64:${randomBytes(32).toString("base64")}`;
const raw=new PrismaClient({log:[]});const id=randomUUID(),memberId=randomUUID(),strangerId=randomUUID(),sample=`PRIVATE-TRUST-${randomUUID()}`,token=randomBytes(32).toString("hex");
async function run(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"privacy-trust-"));process.env.STORAGE_DRIVER="local";process.env.LOCAL_STORAGE_PATH=directory;
 const {prisma}=await import("../lib/prisma");const trust=await import("../services/trustCenter.service");
 const sql=(await fs.readFile("prisma/migrations/20261015233000_private_family_fields/migration.sql","utf8")).replace(/^\s*--.*$/gm,"").split(";").filter(item=>item.trim());
 await raw.$executeRawUnsafe('ALTER TABLE "trust_members" DROP CONSTRAINT IF EXISTS "trust_members_private_v2"');
 try{
  await withPrivateMigration("synthetic fixture",()=>prisma.user.createMany({data:[{id,name:sample,email:`${id}@example.test`},{id:memberId,name:"Recipient",email:`${memberId}@example.test`},{id:strangerId,name:"Other",email:`${strangerId}@example.test`}]}));
  const legacy=await raw.trustMember.create({data:{ownerUserId:id,email:`${memberId}@example.test`,name:sample,relation:"CHILD",customRelation:sample,dateOfBirth:"1988-02-14",bloodGroup:"AB+",accessType:"FAMILY_MEMBER",status:"INVITED",inviteTokenHash:createHash("sha256").update(token).digest("hex"),invitePinHash:await bcrypt.hash("012345",4),inviteExpiresAt:new Date(Date.now()+60_000)}});
  for(const statement of sql.filter(item=>item.includes("ADD CONSTRAINT")))await raw.$executeRawUnsafe(statement);
  const migrate=(...args:string[])=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/scripts/migratePrivateRecords.ts",...args],{env:process.env,encoding:"utf8"}).trim());
  assert.equal(migrate().models.TrustMember.pending,1);assert.equal(migrate("--apply").models.TrustMember.updated,1);assert.equal(migrate("--verify").models.TrustMember.pending,0);
  assert(!JSON.stringify(await raw.trustMember.findUniqueOrThrow({where:{id:legacy.id}})).includes(sample));
  const preview=await trust.getInvitation(token);assert(!JSON.stringify(preview).includes(sample));assert.equal(preview.relationLabel,"Private");
  await assert.rejects(trust.acceptInvitation(token,{pin:"999999"}),/could not be verified/);
  await trust.acceptInvitation(token,{pin:"012345"});
  await withPrivateUser(memberId,async()=>{
   const center=await trust.getTrustCenter(memberId);assert.equal(center.connections[0].owner.name,sample);
   await assert.rejects(prisma.user.findUnique({where:{id}}),/not found/);
   await assert.rejects(prisma.trustMember.findUnique({where:{id:legacy.id},include:{owner:true}}),/PROJECTION_REJECTED/);
  });
  await withPrivateUser(strangerId,()=>assert.rejects(prisma.trustMember.findUnique({where:{id:legacy.id}}),/not found/));
  await withPrivateUser(id,async()=>{
   const created=await trust.addFamilyMember(id,{name:sample,email:`family-${id}@example.test`,relation:"PARENT",dateOfBirth:"1958-03-04",bloodGroup:"O+",accessTypeCode:"FAMILY_MEMBER",permissions:[{module:"WEALTH",canView:true,canDownload:false}]});
   assert.equal(created.name,sample);assert.equal(created.relation,"PARENT");assert.equal(created.permissions[0].canDownload,false);
   const { getWealthHandoffSummary, sendWealthHandoff } = await import("../services/wealthHandoff.service");
   const handoff = await getWealthHandoffSummary(id);
   assert.equal(handoff.recipients.family.find(item => item.id === created.id)?.canReceiveHandoff, false);
   await assert.rejects(sendWealthHandoff(id, { familyRecipientIds: [created.id], emergencyRecipientIds: [] }), /Only verified recipients/);
   const center=await trust.getTrustCenter(id);assert.equal(center.members.length,2);
   await trust.revokeTrustMember(id,legacy.id);
  });
  await withPrivateUser(memberId,()=>assert.rejects(prisma.trustMember.findUnique({where:{id:legacy.id}}),/not found/));
  await withPrivateUser(memberId,async()=>{
   const exports=await import("../services/accountExport.service");
   const job=await prisma.accountExportJob.create({data:{userId:memberId,status:"REQUESTED"}});
   await exports.prepareAccountExport(job.id);
   const archive=await exports.downloadAccountExport(memberId,job.id);
   assert(!archive.data.includes(Buffer.from(sample)));assert(!archive.data.includes(Buffer.from(legacy.invitePinHash!)));archive.data.fill(0);
  });

  await assert.rejects(raw.trustMember.update({where:{id:legacy.id},data:{name:sample}}));
  await raw.$executeRawUnsafe('ALTER TABLE "trust_members" VALIDATE CONSTRAINT "trust_members_private_v2"');
  console.log("PASS: family/trust ciphertext, migration, private invitation preview, PIN-gated acceptance, linked-owner restricted projection, revocation, permissions and unrelated-user denial.");
 }finally{await raw.user.deleteMany({where:{id:{in:[id,memberId,strangerId]}}});await Promise.all([raw.$disconnect(),prisma.$disconnect()]);await fs.rm(directory,{recursive:true,force:true});}
}
run().catch(error=>{console.error("Trust privacy test failed.",{name:error.name,code:error.code,frames:String(error.stack).split("\n").filter((line:string)=>/^\s+at /.test(line)).slice(-5)});process.exitCode=1;});
