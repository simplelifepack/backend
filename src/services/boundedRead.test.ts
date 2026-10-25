import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { readBoundedBytes } from "./boundedRead";
import { createWorkLimit } from "../middleware/resourceLimits";
test("bounded provider reads enforce size without advertised Content-Length and close source", async()=>{
  const source=Readable.from([Buffer.alloc(6),Buffer.alloc(6)]);
  await assert.rejects(readBoundedBytes(source,10),{statusCode:413});assert(source.destroyed);
  assert.equal((await readBoundedBytes(Readable.from([Buffer.alloc(4),Buffer.alloc(6)]),10)).length,10);
});
test("service admission rejects excess work and releases slots after errors", async()=>{
  const run=createWorkLimit(1);let finish!:()=>void;const first=run(()=>new Promise<void>(resolve=>{finish=resolve;}));
  await assert.rejects(run(async()=>undefined),{statusCode:503});finish();await first;
  await assert.rejects(run(async()=>{throw Error("synthetic");}));assert.equal(await run(async()=>42),42);
});
