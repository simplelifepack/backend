import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { withPrivateUser, withPrivateMigration } from "./access";
import { decryptCleanupLocator } from "./storageLocator";
const url = process.env.PRIVACY_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(url)) throw new Error("Use isolated privacy_test on port 55439.");
process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ docs: `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "docs";
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
const raw = new PrismaClient({ log: [] });
const userId = randomUUID(), otherId = randomUUID(), sample = `PRIVATE-DOC-${randomUUID()}`;
async function run() {
 const { prisma } = await import("../lib/prisma");
 const { storedBytes } = await import("../services/accountUsage.service");
 const { queueStorageCleanup } = await import("../services/storageCleanup.service");
 const statements: string[] = [];
 for (const folder of ["20261015220000_private_document_fields", "20261015223000_private_cleanup_locators"]) {
  const sql = (await fs.readFile(`prisma/migrations/${folder}/migration.sql`, "utf8")).replace(/^\s*--.*$/gm, "");
  statements.push(...sql.split(";").filter(item => item.trim()));
 }
 const present = await raw.$queryRaw<Array<{present:boolean}>>`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Document' AND column_name='private_title') AS present`;
 if (!present[0].present) for (const sql of statements.filter(item => !item.includes("ADD CONSTRAINT"))) await raw.$executeRawUnsafe(sql);
 for (const [table, constraint] of [["Document","Document_private_v2"],["DocumentFile","DocumentFile_private_v2"],["DocumentFile","DocumentFile_private_owner_fk"],["storage_cleanup","storage_cleanup_private_v2"]]) await raw.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
 try {
  await withPrivateMigration("synthetic user fixtures", () => prisma.user.createMany({data:[{id:userId,name:"Owner",email:`${userId}@example.test`},{id:otherId,name:"Other",email:`${otherId}@example.test`}]}));
  const data = {ownerProfileId:userId,title:sample,displayName:sample,uniqueIdentifier:sample,rawText:sample,originalName:sample,storedName:sample,mimeType:"application/pdf",size:100,path:`${userId}/${sample}`,storageKey:`${userId}/${sample}`,wrappedKey:sample,originalSha256:sample,documentType:sample,normalizedType:sample,category:"medical",analysisSource:"manual",ownershipStatus:"verified",confidence:98,fields:{sample},extractedKeyFields:{sample},classificationSignals:[{label:sample}],ownershipMatchedFields:[sample],sourceMessageId:sample,driveFileId:sample};
  const legacy = await raw.document.create({data});
  const nullable = { ...data, contentHash: null, driveFileId: null, size: 0, path: "", storageKey: null, confidence: 0 };
  await raw.document.createMany({ data: [nullable, nullable] });
  const page = await raw.documentFile.create({data:{documentId:legacy.id,pageIndex:0,originalName:sample,mimeType:"application/pdf",size:100,storageKey:data.storageKey,storedName:sample,originalSha256:sample,wrappedKey:sample}});
  await raw.storageCleanup.create({data:{storageKey:`${userId}/${sample}-cleanup`,ownerUserId:userId,sizeBytes:11}});
  for (const sql of statements.filter(item=>item.includes("ADD CONSTRAINT"))) await raw.$executeRawUnsafe(sql);
  const migrate=(...args:string[])=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/scripts/migratePrivateRecords.ts",...args],{env:process.env,encoding:"utf8"}).trim());
  assert.equal(migrate().models.Document.pending,3);
  assert.equal(migrate("--apply").models.DocumentFile.updated,1);
  assert.equal(migrate("--verify").models.StorageCleanup.pending,0);
  assert.equal(migrate("--apply").models.DocumentFile.updated,0);
  for(const row of [await raw.document.findUniqueOrThrow({where:{id:legacy.id}}),await raw.documentFile.findUniqueOrThrow({where:{id:page.id}}),...(await raw.storageCleanup.findMany({where:{ownerUserId:userId}}))]) assert(!JSON.stringify(row, (_key, value) => typeof value === "bigint" ? String(value) : value).includes(sample));
  await withPrivateUser(userId,async()=>{
   const loaded=await prisma.document.findUniqueOrThrow({where:{id:legacy.id},include:{files:{orderBy:{pageIndex:"asc"}}}});
   assert.equal(loaded.ownershipStatus,"verified");
   assert.match((await raw.document.findUniqueOrThrow({where:{id:legacy.id}})).ownershipStatus,/^hmac:v2:/);
   assert.equal(loaded.originalName,sample);assert.equal(loaded.files[0].storageKey,data.storageKey);
   assert.deepEqual(loaded.fields,{sample});assert.equal(loaded.confidence,98);
   assert.equal(await storedBytes(userId),111);
   await prisma.document.createMany({ data: [nullable, nullable] });
   assert.equal((await prisma.document.findMany({ where: { ownerProfileId: userId, contentHash: null, driveFileId: null } })).length, 4);
   const created=await prisma.document.create({data:{...data,id:randomUUID(),contentHash:"second",driveFileId:"second",files:{create:{pageIndex:0,originalName:sample,mimeType:"application/pdf",size:100,storageKey:data.storageKey,storedName:sample}}},include:{files:true}});
   assert.equal(created.files[0].originalName,sample);
   await prisma.document.update({where:{id:created.id},data:{displayName:`${sample}-updated`,confidence:86}});
   assert.equal((await prisma.document.findMany({where:{ownerProfileId:userId,confidence:{gt:90},category:"medical"}})).length,1);
   await prisma.$transaction(tx=>queueStorageCleanup(tx,userId,[{storageKey:data.storageKey,size:100}]));
   assert.equal(await storedBytes(userId),111);
   const cleanup=await prisma.storageCleanup.findMany({where:{ownerUserId:userId}});
   assert(cleanup.map(decryptCleanupLocator).includes(data.storageKey));
   const other=await raw.document.create({data:{...data,id:randomUUID(),ownerProfileId:otherId}}).catch(()=>null);
   assert.equal(other,null); // SQL constraint rejects this deliberately raw plaintext path.
   await assert.rejects(raw.document.update({where:{id:legacy.id},data:{displayName:sample}}));
   await assert.rejects(raw.documentFile.update({where:{id:page.id},data:{originalName:sample}}));
  });
  await withPrivateUser(otherId,async()=>{
   await assert.rejects(prisma.document.findUnique({where:{id:legacy.id}}),/not found/);
   await assert.rejects(prisma.documentFile.findUnique({where:{id:page.id}}),/not found/);
  });
  for(const [table,constraint] of [["Document","Document_private_v2"],["DocumentFile","DocumentFile_private_v2"],["DocumentFile","DocumentFile_private_owner_fk"],["storage_cleanup","storage_cleanup_private_v2"]])await raw.$executeRawUnsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"`);
  console.log("PASS: document/page ciphertext, classifications/content/filenames/locators/digests, nested writes, resumable migration, raw plaintext rejection, owner isolation, storage-quota dedupe and encrypted cleanup locators.");
 }finally{
  await raw.document.deleteMany({where:{ownerProfileId:{in:[userId,otherId]}}});
  await raw.user.deleteMany({where:{id:{in:[userId,otherId]}}});
  await Promise.all([raw.$disconnect(),prisma.$disconnect()]);
 }
}
run().catch(error=>{console.error("Document privacy test failed.",{name:error.name,code:error.code,argument:String(error.message).match(/Unknown argument `([A-Za-z_]+)`/)?.[1],frames:String(error.stack).split("\n").filter((line:string)=>/^\s+at /.test(line)).slice(-5)});process.exitCode=1;});
