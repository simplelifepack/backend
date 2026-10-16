import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { drive_v3, gmail_v1 } from "googleapis";
import { PrismaClient } from "@prisma/client";
import { withPrivateMigration, withPrivateUser } from "./access";
const url = process.env.PRIVACY_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(url)) throw new Error("Use isolated privacy_test.");
process.env.DATABASE_URL=url;process.env.DIRECT_URL=url;
process.env.PRIVATE_DATA_KEYRING_JSON=JSON.stringify({imports:`base64:${randomBytes(32).toString("base64")}`});process.env.PRIVATE_DATA_ACTIVE_KEY_ID="imports";process.env.PRIVATE_DATA_LOOKUP_KEY=`base64:${randomBytes(32).toString("base64")}`;
process.env.DOCUMENT_ENCRYPTION_KEY=`base64:${randomBytes(32).toString("base64")}`;
const raw=new PrismaClient({log:[]});const userId=randomUUID(),otherId=randomUUID(),sample=`PRIVATEIMPORT${randomBytes(8).toString("hex")}`;
function pdf(text:string){
 const content=`BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
 let result="%PDF-1.4\n";const offsets=[0];objects.forEach((value,index)=>{offsets.push(Buffer.byteLength(result));result+=`${index+1} 0 obj\n${value}\nendobj\n`;});
 const start=Buffer.byteLength(result);result+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value=>`${String(value).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(result);
}
async function run(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"privacy-imports-"));process.env.UPLOADS_DIR=path.join(directory,"uploads");process.env.STORAGE_DRIVER="local";process.env.LOCAL_STORAGE_PATH=path.join(directory,"objects");
 const pair=generateKeyPairSync("rsa",{modulusLength:4096,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}});
 process.env.DOCUMENT_RSA_KEYRING_JSON=JSON.stringify([{keyId:"imports-test",keyVersion:1,publicKeyPem:pair.publicKey,privateKeyPem:pair.privateKey}]);
 const {prisma}=await import("../lib/prisma");const {importGmailCandidates}=await import("../services/gmail/importer");const {scanGmail}=await import("../services/gmail/scanner");const {scanDrive}=await import("../services/drive/scanner");
 const logs:string[]=[];const info=console.info,log=console.log;console.info=(...items)=>logs.push(JSON.stringify(items));console.log=(...items)=>logs.push(JSON.stringify(items));
 try{
  await withPrivateMigration("synthetic import fixtures",()=>prisma.user.createMany({data:[{id:userId,name:sample,email:`${userId}@example.test`},{id:otherId,name:"Other",email:`${otherId}@example.test`}]}));
  await withPrivateUser(userId,async()=>{
   await prisma.externalConnection.createMany({data:["gmail","google_drive"].map(provider=>({userId,provider,providerAccountId:sample,providerEmail:`${sample}@example.test`,encryptedRefreshToken:sample,status:"connected"}))});
   const message:gmail_v1.Schema$Message={id:sample,internalDate:String(Date.now()),snippet:`Bank account statement ${sample}`,payload:{mimeType:"multipart/mixed",headers:[{name:"From",value:`${sample} <alerts@unionbankofindia.bank>`},{name:"Subject",value:`Monthly bank statement ${sample}`}],parts:[{filename:`statement-${sample}.pdf`,mimeType:"application/pdf",body:{attachmentId:sample,size:5000}},{mimeType:"text/plain",body:{data:Buffer.from(`Bank statement account summary ${sample}`).toString("base64url")}}]}};
   const gmail={users:{messages:{list:async()=>({data:{messages:[{id:sample}]}}),get:async()=>({data:message})}}} as unknown as gmail_v1.Gmail;
   await scanGmail(userId,gmail);assert((await prisma.externalDocumentCandidate.count({where:{userId,provider:"gmail"}}))>0);
   const connection=await prisma.externalConnection.findUniqueOrThrow({where:{userId_provider:{userId,provider:"gmail"}}});
   const candidate=await prisma.externalDocumentCandidate.create({data:{userId,connectionId:connection.id,provider:"gmail",sourceKey:`body-${sample}`,externalMessageId:sample,filename:`statement-${sample}.txt`,mimeType:"text/plain",size:0,sender:sample,subject:sample,receivedAt:new Date(),suggestedCategory:"finance",suggestedDocumentType:"Financial document",relevanceReason:sample,relevanceScore:80}});
   const result=await importGmailCandidates(userId,[candidate.id],gmail);assert.equal(result[0]?.status,"ready_for_review");
   const upload=await prisma.temporaryUpload.findUniqueOrThrow({where:{id:result[0].analysis!.tempFileId}});const stored=await fs.readFile(upload.storagePath);assert(!stored.includes(Buffer.from(sample)));assert(!JSON.stringify(await raw.temporaryUpload.findUniqueOrThrow({where:{id:upload.id}})).includes(sample));
   await withPrivateUser(otherId,()=>assert.rejects(importGmailCandidates(otherId,[candidate.id],gmail),/unavailable/));
   const bytes=pdf(`Bank statement Account summary ${sample}`);
   const drive={files:{list:async()=>({data:{files:[{id:sample,name:`bank-statement-${sample}.pdf`,mimeType:"application/pdf",modifiedTime:"2026-10-01T00:00:00Z",size:String(bytes.length)}]}}),get:async()=>({data:bytes})}} as unknown as drive_v3.Drive;
   const scan=await scanDrive(userId,{drive});assert.equal(scan.indexed,1);
   const document=await prisma.document.findFirstOrThrow({where:{ownerProfileId:userId,driveFileId:sample}});assert((await import("../utils/documentEncryption")).decryptString(document.originalName)!.includes(sample));
   assert(!JSON.stringify(await raw.document.findUniqueOrThrow({where:{id:document.id}})).includes(sample));
   const again=await scanDrive(userId,{drive});assert.equal(again.unchanged,1);
   assert(!JSON.stringify(await raw.externalDocumentCandidate.findMany({where:{userId}})).includes(sample));assert(!JSON.stringify(await raw.externalConnection.findMany({where:{userId}})).includes(sample));
  });
  assert(!logs.join("").includes(sample));
 }finally{console.info=info;console.log=log;await raw.temporaryUpload.deleteMany({where:{ownerProfileId:userId}});await raw.document.deleteMany({where:{ownerProfileId:userId}});await raw.user.deleteMany({where:{id:{in:[userId,otherId]}}});await Promise.all([raw.$disconnect(),prisma.$disconnect()]);await fs.rm(directory,{recursive:true,force:true});}
 console.log("PASS: mocked Gmail scan/import and Drive scan/reimport, encrypted temporary objects and all database copies, authorized output, cross-user denial and private-free diagnostics.");
}
run().catch(error=>{console.error("Import privacy test failed.",{name:error.name,code:error.code,frames:String(error.stack).split("\n").filter((line:string)=>/^\s+at /.test(line)).slice(-5)});process.exitCode=1;});
