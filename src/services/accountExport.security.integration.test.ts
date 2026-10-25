import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { withPrivateUser } from "../privacy/access";
import { prisma } from "../lib/prisma";
import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";
import { requestAccountExport, getAccountExportJob, prepareAccountExport, downloadAccountExport, streamAccountExport } from "./accountExport.service";

const url = new URL(process.env.DATABASE_URL || "http://invalid");
const isolated=url.hostname==="127.0.0.1"&&url.port==="55439"&&url.pathname==="/readines_audit_test";
test("exports reserve one job, serialize preparation, retain ciphertext and preserve owner isolation", {skip:!isolated}, async()=>{
  const raw=new PrismaClient({log:[]});const ids=[randomUUID(),randomUUID()];const storage=getStorageProvider();const upload=storage.upload.bind(storage);const uploadFile=storage.uploadFile?.bind(storage);let uploads=0,active=0,maximum=0;
  storage.upload=async input=>{uploads++;active++;maximum=Math.max(active,maximum);assert(input.body.toString().startsWith("enc:v2:"));try{return await upload(input);}finally{active--;}};
  if (uploadFile) storage.uploadFile=async input=>{uploads++;active++;maximum=Math.max(active,maximum);assert((await fs.readFile(input.filePath,"utf8")).startsWith("enc:v2:"));try{return await uploadFile(input);}finally{active--;}};
  try{
    for(const id of ids)await withPrivateUser(id,()=>prisma.user.create({data:{id,name:"PRIVATE-AUDIT-EXPORT",email:`${id}@example.test`},select:{id:true}}));
    const first=await withPrivateUser(ids[0],()=>Promise.all([requestAccountExport(ids[0]),requestAccountExport(ids[0])]));
    assert.equal(first[0].id,first[1].id);assert.equal(await raw.accountExportJob.count({where:{userId:ids[0]}}),1);
    const second=await withPrivateUser(ids[1],()=>requestAccountExport(ids[1]));
    await Promise.all([prepareAccountExport(first[0].id),prepareAccountExport(first[0].id),prepareAccountExport(second.id)]);
    for(const [id,jobId] of [[ids[0],first[0].id],[ids[1],second.id]]){
      let ready=false;
      for(let i=0;i<100;i++){
        const job=await withPrivateUser(id,()=>getAccountExportJob(id,jobId));
        if(job.status==="READY"){ready=true;break;}
        assert.notEqual(job.status,"FAILED");await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert(ready,"requested export completes when a slot is free");
      const downloaded=await withPrivateUser(id,()=>downloadAccountExport(id,jobId));assert.equal(downloaded.data.subarray(0,2).toString(),"PK");
      const streamed = await withPrivateUser(id,()=>streamAccountExport(id,jobId));
      const chunks: Buffer[]=[];try{for await(const chunk of streamed.stream)chunks.push(Buffer.from(chunk));assert.deepEqual(Buffer.concat(chunks),downloaded.data);}finally{await streamed.dispose();}
      await assert.rejects(withPrivateUser(ids.find(other=>other!==id)!,()=>downloadAccountExport(ids.find(other=>other!==id)!,jobId)));
    }
    assert.equal(uploads,2);assert.equal(maximum,1);
  }finally{
    storage.upload=upload;storage.uploadFile=uploadFile;
    for(const job of await raw.accountExportJob.findMany({where:{userId:{in:ids}}}))if(job.storageKey)await storage.delete(job.storageKey);
    await raw.user.deleteMany({where:{id:{in:ids}}});await Promise.all([raw.$disconnect(),prisma.$disconnect()]);
  }
});
