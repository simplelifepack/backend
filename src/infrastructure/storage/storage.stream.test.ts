import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { S3CompatibleStorageProvider } from "./S3CompatibleStorageProvider";
import { LocalStorageProvider } from "./LocalStorageProvider";

test("local and S3-compatible providers stream ciphertext files without optional AWS trailers",async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"storage-stream-test-"));const bytes=randomBytes(1024*1024);const source=path.join(directory,"source.enc");await fs.writeFile(source,bytes);
  let stored:Buffer|undefined;
  const server=http.createServer(async(req,res)=>{if(req.method==="PUT"){assert(!req.headers["content-encoding"]?.includes("aws-chunked"));assert.equal(Number(req.headers["content-length"]),bytes.length);const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));stored=Buffer.concat(chunks);res.writeHead(200,{ETag:'"synthetic"'}).end();}else if(req.method==="GET"){res.writeHead(200,{"Content-Length":stored!.length});res.end(stored);}else res.writeHead(404).end();});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    const providers=[new LocalStorageProvider(path.join(directory,"local")),new S3CompatibleStorageProvider({driver:"s3",region:"test",bucket:"test",endpoint,forcePathStyle:true,accessKeyId:"synthetic",secretAccessKey:"synthetic"})];
    for(let index=0;index<providers.length;index++){
      await providers[index].uploadFile({key:"synthetic/archive.enc",filePath:source,contentType:"application/octet-stream"});const target=path.join(directory,`download-${index}.enc`);await providers[index].downloadFile("synthetic/archive.enc",target);assert.deepEqual(await fs.readFile(target),bytes);
    }
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(directory,{recursive:true,force:true});}
});
