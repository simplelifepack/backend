import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";

import sharp from "sharp";

import { uploadsDir } from "../../middleware/upload";
import { ingestDocument } from "./pipeline";

async function withNetworkBlocked<T>(callback: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const originalNetConnect = net.connect;
  const originalSocketConnect = net.Socket.prototype.connect;
  const fail = () => {
    throw new Error("Network access is forbidden during document extraction.");
  };

  globalThis.fetch = fail as typeof fetch;
  http.request = fail as typeof http.request;
  http.get = fail as typeof http.get;
  https.request = fail as typeof https.request;
  https.get = fail as typeof https.get;
  net.connect = fail as typeof net.connect;
  net.Socket.prototype.connect = fail as typeof net.Socket.prototype.connect;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    net.connect = originalNetConnect;
    net.Socket.prototype.connect = originalSocketConnect;
  }
}

async function writeTextFixture() {
  const filePath = path.join(uploadsDir, "ingestion-aadhaar.txt");
  await fs.writeFile(filePath, "Aadhaar Card\nUIDAI\nUnique Identification Authority of India", "utf8");
  return filePath;
}

async function writePanFixture() {
  const filePath = path.join(uploadsDir, "ingestion-pan.txt");
  await fs.writeFile(
    filePath,
    [
      "INCOME TAX DEPARTMENT @ GOVT. OF INDIA",
      "",
      "BARACK OBAMA",
      "",
      "BARACK OBAMA Sr.",
      "",
      "Permanent Account Number",
      "",
      "ZXCVB6789L",
      "",
      "Signature",
    ].join("\n"),
    "utf8",
  );
  return filePath;
}

async function writeImageFixture() {
  const filePath = path.join(uploadsDir, "ingestion-pan.png");
  await sharp({
      text: {
      text: "PAN CARD PLMNO2468Q Name Test User DOB 01/01/1990",
      font: "sans 36",
      rgba: true,
      width: 1000,
      height: 300,
    },
  })
    .png()
    .toFile(filePath);
  return filePath;
}

async function writePdfFixture() {
  const text = "Aadhaar Card UIDAI Unique Identification Authority of India";
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const filePath = path.join(uploadsDir, "ingestion-aadhaar.pdf");
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  await fs.writeFile(filePath, pdf, "utf8");
  return filePath;
}

async function run() {
  const createdFiles: string[] = [];

  try {
    const textPath = await writeTextFixture();
    createdFiles.push(textPath);
    const textResult = await withNetworkBlocked(async () =>
      ingestDocument({
        path: textPath,
        originalName: "ingestion-aadhaar.txt",
        mimeType: "text/plain",
        size: (await fs.stat(textPath)).size,
      }),
    );
    assert.equal(textResult.success, true);
    assert.equal(textResult.documentType, "aadhaar");
    assert.ok(textResult.reviewFields.length > 0);

    const panPath = await writePanFixture();
    createdFiles.push(panPath);
    const panResult = await withNetworkBlocked(async () =>
      ingestDocument({
        path: panPath,
        originalName: "ingestion-pan.txt",
        mimeType: "text/plain",
        size: (await fs.stat(panPath)).size,
      }),
    );
    assert.equal(panResult.extractedFields.panNumber, "ZXCVB6789L");
    assert.equal(panResult.validation.uniqueIdentifier, "ZXCVB6789L");

    const pdfPath = await writePdfFixture();
    createdFiles.push(pdfPath);
    const pdfResult = await withNetworkBlocked(async () =>
      ingestDocument({
        path: pdfPath,
        originalName: "ingestion-aadhaar.pdf",
        mimeType: "application/pdf",
        size: (await fs.stat(pdfPath)).size,
      }),
    );
    assert.equal(pdfResult.extraction.kind, "pdf");
  assert.match(pdfResult.extractedText, /Aadhaar/i);
    assert.ok(pdfResult.reviewFields.length > 0);

    const imagePath = await writeImageFixture();
    createdFiles.push(imagePath);
    const imageResult = await withNetworkBlocked(async () =>
      ingestDocument({
        path: imagePath,
        originalName: "ingestion-pan.png",
        mimeType: "image/png",
        size: (await fs.stat(imagePath)).size,
      }),
    );
    assert.equal(imageResult.extraction.kind, "image");
    assert.ok(imageResult.extraction.pages[0]?.confidence !== undefined);
  assert.match(imageResult.extractedText, /PAN/i);
    assert.ok(imageResult.reviewFields.length > 0);

    console.log("ingestion pipeline tests passed");
  } finally {
    await Promise.all(createdFiles.map((filePath) => fs.rm(filePath, { force: true })));
  }
}

void run();
