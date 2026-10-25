import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import express from "express";
import { encryptedUpload } from "./upload";
import { createAdmissionLimit } from "./resourceLimits";

async function serve(work: (base: string) => Promise<void>) {
  const app = express();
  app.post("/upload", encryptedUpload.array("encryptedFiles", 50), (req, res) => res.json({ count: (req.files as unknown[]).length }));
  app.use((error: {statusCode?: number; code?: string}, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode ?? (error.code === "LIMIT_FILE_SIZE" ? 413 : 400)).end());
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await work(`http://127.0.0.1:${(server.address() as {port: number}).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function form(sizes: number[]) {
  const body = new FormData();
  for (const size of sizes) body.append("encryptedFiles", new Blob([new Uint8Array(size)], {type: "application/octet-stream"}), "ciphertext.bin");
  return body;
}
test("accepts exact aggregate ciphertext bound and rejects oversized multi-file request", async () => serve(async base => {
  const exact = await fetch(`${base}/upload`, {method:"POST",body:form([10*1024*1024+16])}); await exact.text(); assert.equal(exact.status,200);
  const over = await fetch(`${base}/upload`, {method:"POST",body:form([6*1024*1024,6*1024*1024])});await over.text();assert.equal(over.status,413);
  const many = await fetch(`${base}/upload`, {method:"POST",body:form(Array(51).fill(1))});await many.text();assert.equal(many.status,400);
  assert.equal((await fetch(`${base}/upload`, {method:"POST",body:form([1024])})).status, 200);
}));
test("bounds chunked multipart requests without Content-Length", async () => serve(async base => {
  const request = new Request(`${base}/upload`, {method:"POST", body:form([6*1024*1024,6*1024*1024])});
  assert.equal((await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, duplex: "half" } as RequestInit)).status, 413);
}));
test("admission releases once and removes listeners on success and cancellation", () => {
  const gate = createAdmissionLimit(1);
  const response = () => Object.assign(new EventEmitter(), {setHeader() {}, status() {return this;}, json() {}});
  const first = response(), second = response(); let admitted = 0;
  const enter = (res: unknown) => gate({} as express.Request, res as express.Response, () => {admitted++;});
  enter(first); enter(second); assert.equal(admitted, 1);
  first.emit("close"); first.emit("finish"); assert.equal(first.listenerCount("finish"), 0);
  enter(second); assert.equal(admitted, 2); second.emit("finish"); assert.equal(second.listenerCount("close"), 0);
});
