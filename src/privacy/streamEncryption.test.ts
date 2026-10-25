import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decryptPrivateBytes, encryptPrivateBytes, encryptPrivateStreamToFile, openVerifiedPrivateFile } from "./fieldEncryption";
process.env.PRIVATE_DATA_KEYRING_JSON=JSON.stringify({stream:`base64:${randomBytes(32).toString("base64")}`});process.env.PRIVATE_DATA_ACTIVE_KEY_ID="stream";process.env.PRIVATE_DATA_LOOKUP_KEY=`base64:${randomBytes(32).toString("base64")}`;
const binding={model:"AccountExportJob",recordId:"synthetic-job",ownerId:"synthetic-owner",field:"archive"};
test("streamed ciphertext retains existing enc:v2 format across arbitrary chunk boundaries",async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"stream-encryption-test-"));
  try{for(const size of [0,1,2,3,4,1000,1024*1024+7]){
    const bytes=randomBytes(size),file=path.join(directory,`archive-${size}.enc`);
    async function* source(){for(let i=0;i<bytes.length;i+=31)yield bytes.subarray(i,i+31);}
    assert.equal((await encryptPrivateStreamToFile(source(),binding,file)).sizeBytes,size);
    const encrypted=await fs.readFile(file,"utf8");assert.deepEqual(decryptPrivateBytes(encrypted,binding),bytes);assert.throws(()=>decryptPrivateBytes(encrypted,{...binding,ownerId:"other-owner"}));
    assert.equal((await fs.stat(file)).mode&0o777,0o600);
  }}finally{await fs.rm(directory,{recursive:true,force:true});}
});
test("failed archive generation removes incomplete ciphertext files",async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"stream-encryption-failure-"));const file=path.join(directory,"incomplete.enc");
  try{async function* source(){yield Buffer.from("synthetic-private-data");throw Error("cancelled");}await assert.rejects(encryptPrivateStreamToFile(source(),binding,file),/cancelled/);await assert.rejects(fs.stat(file));}
  finally{await fs.rm(directory,{recursive:true,force:true});}
});

test("verified download streams accept old ciphertext and reject corruption before exposing plaintext",async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"verified-private-stream-"));const file=path.join(directory,"archive.enc");
  const bytes=randomBytes(1024*1024+7);
  try{
    await fs.writeFile(file,encryptPrivateBytes(bytes,binding),{mode:0o600});
    const verified=await openVerifiedPrivateFile(file,binding);const chunks:Buffer[]=[];
    try{for await(const chunk of verified.stream)chunks.push(Buffer.from(chunk));assert.deepEqual(Buffer.concat(chunks),bytes);}finally{await verified.dispose();}
    await assert.rejects(openVerifiedPrivateFile(file,{...binding,ownerId:"other-owner"}));
    const corrupt=await fs.readFile(file);corrupt[200]=corrupt[200]===65?66:65;await fs.writeFile(file,corrupt);await assert.rejects(openVerifiedPrivateFile(file,binding));
    await fs.writeFile(file,encryptPrivateBytes(bytes,binding));const controller=new AbortController();controller.abort();await assert.rejects(openVerifiedPrivateFile(file,binding,controller.signal));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
