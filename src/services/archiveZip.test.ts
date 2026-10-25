import assert from "node:assert/strict";
import { test } from "node:test";
import { createStoredZip, streamStoredZip } from "./archiveZip";
test("streamed ZIP is byte-for-byte compatible with existing format", async () => {
  const files = [{name:"one.pdf",data:Buffer.from("first"),modifiedAt:new Date(2026,1,1)}, {name:"folder/two.png",data:Buffer.from("second"),modifiedAt:new Date(2026,1,2)}];
  async function* source() {yield* files;}
  const chunks: Buffer[] = []; for await (const chunk of streamStoredZip(source())) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), createStoredZip(files));
});
test("stream cancellation stops requesting more files", async () => {
  let reads = 0; let closed = false;
  async function* source() {try {for (let i=0;i<100;i++) {reads++;yield {name:`${i}.pdf`,data:Buffer.alloc(100)};}} finally {closed=true;}}
  for await (const _chunk of streamStoredZip(source())) break;
  assert.equal(reads,1);assert.equal(closed,true);
});
