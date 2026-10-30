import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID, randomBytes } from "node:crypto";
import { test } from "node:test";
import express from "express";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { withPrivateUser } from "../privacy/access";
import { prisma } from "../lib/prisma";
import documentsRouter from "./documents.routes";
import { errorHandler } from "../middleware/errorHandling";
import { signAccessToken } from "../utils/jwt";
import { encryptDocumentOnBackend } from "../services/documentHybridEncryption";
import { setDocumentAnalyzerForTests, fallbackDocumentAIResult } from "../services/documentAnalyzer";
import { extractHealthDocument, setHealthExtractionRequestForTests } from "../services/healthExtraction.service";
const url = new URL(process.env.DATABASE_URL || "http://invalid");
test("document and Health processing do not consume or depend on package search AI allowance", { skip: url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/readines_audit_test" }, async () => {
  process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
  const raw = new PrismaClient({ log: [] }); const id = randomUUID(); let calls = 0;
  const app = express(); app.use("/documents", documentsRouter); app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await withPrivateUser(id, () => prisma.user.create({ data: { id, name: "Quota audit", email: `${id}@example.test`, aiProcessingEnabled: true }, select: { id: true } }));
    const period = new Date().toISOString().slice(0, 7);
    await raw.userAIUsage.create({ data: { userId: id, period, actionCount: 3 } });
    setDocumentAnalyzerForTests({ analyzeDocument: async () => { calls++; return fallbackDocumentAIResult; } });
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    const { ciphertext, ...metadata } = encryptDocumentOnBackend(bytes, { filename: "synthetic.png", mimeType: "image/png" });
    const upload = async (consent: boolean) => {
      const form = new FormData(); form.append("encryptedFiles", new Blob([new Uint8Array(ciphertext)], { type: "application/octet-stream" }), "file.bin");
      form.append("envelopes", JSON.stringify([metadata])); form.append("aiAnalysisConsent", String(consent));
      const response = await fetch(base + "/documents/analyze", { method: "POST", headers: { Authorization: `Bearer ${signAccessToken({ sub: id })}` }, body: form });
      await response.arrayBuffer(); return response.status;
    };
    for (let i = 0; i < 4; i++) assert.equal(await upload(true), 200);
    assert.equal(calls, 4); assert.equal(await upload(false), 200); assert.equal(calls, 5);
    await withPrivateUser(id, () => prisma.user.update({ where: { id }, data: { aiProcessingEnabled: false } }));
    assert.equal(await upload(true), 200); assert.equal(calls, 5);
    setHealthExtractionRequestForTests(async () => ({ output_text: JSON.stringify({ documentType: "lab_report", measurements: [], medications: [], followUps: [] }) }));
    await extractHealthDocument({ files: [{ name: "synthetic.png", mimeType: "image/png", bytes }] });
    assert.equal((await raw.userAIUsage.findUniqueOrThrow({ where: { userId_period: { userId: id, period } } })).actionCount, 3);
  } finally {
    setDocumentAnalyzerForTests(null); setHealthExtractionRequestForTests(null); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await raw.temporaryUpload.deleteMany({ where: { ownerProfileId: id } }); await raw.user.deleteMany({ where: { id } });
    await Promise.all([raw.$disconnect(), prisma.$disconnect()]);
  }
});
