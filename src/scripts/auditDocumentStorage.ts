import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";
import { prisma } from "../lib/prisma";

type DocumentWithFiles = Prisma.DocumentGetPayload<{ include: { files: true } }>;

type Location = {
  label: string;
  table: "Document" | "DocumentFile";
  id: string;
  storageKey: string | null;
  path: string | null;
  storedName: string | null;
  encryptedSize: number | null;
  ciphertextHash: string | null;
  encryptedSha256?: string | null;
};

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function usage() {
  console.log([
    "Usage:",
    "  npm run documents:audit-storage -- --id <document-id>",
    "  npm run documents:audit-storage -- --id <document-id> --recover-file <encrypted-file> [--target document|page:<index>] [--apply]",
  ].join("\n"));
}

function locationsFor(document: DocumentWithFiles) {
  const locations: Location[] = [{
    label: "document",
    table: "Document",
    id: document.id,
    storageKey: document.storageKey,
    path: document.path,
    storedName: document.storedName,
    encryptedSize: document.encryptedSize,
    ciphertextHash: document.ciphertextHash,
    encryptedSha256: document.encryptedSha256,
  }];
  for (const file of [...document.files].sort((a, b) => a.pageIndex - b.pageIndex)) {
    locations.push({
      label: `page:${file.pageIndex}`,
      table: "DocumentFile",
      id: file.id,
      storageKey: file.storageKey,
      path: file.storageKey,
      storedName: file.storedName,
      encryptedSize: file.encryptedSize,
      ciphertextHash: file.ciphertextHash,
    });
  }
  return locations;
}

function candidateKeys(location: Location) {
  return Array.from(new Set([location.storageKey, location.path].filter(Boolean))) as string[];
}

async function exists(candidate: string) {
  if (path.isAbsolute(candidate)) {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      return false;
    }
  }
  return getStorageProvider().exists(candidate);
}

async function audit(document: DocumentWithFiles) {
  const checks = [];
  for (const location of locationsFor(document)) {
    for (const candidate of candidateKeys(location)) {
      checks.push({
        label: location.label,
        candidate,
        exists: await exists(candidate),
        encryptedSize: location.encryptedSize,
        ciphertextHash: location.ciphertextHash ?? location.encryptedSha256 ?? null,
      });
    }
  }
  return checks;
}

function targetLocation(document: DocumentWithFiles, target: string | null) {
  const locations = locationsFor(document);
  if (!target) return locations[0]!;
  const location = locations.find((item) => item.label === target);
  if (!location) throw new Error(`Unknown target ${target}. Use document or page:<index>.`);
  return location;
}

async function recover(document: DocumentWithFiles, inputPath: string, target: string | null, apply: boolean) {
  const location = targetLocation(document, target);
  const bytes = await fs.readFile(inputPath);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const expectedHash = location.ciphertextHash ?? location.encryptedSha256;
  if (location.encryptedSize !== null && location.encryptedSize !== bytes.length) {
    throw new Error(`Recovered file size ${bytes.length} does not match recorded encryptedSize ${location.encryptedSize}.`);
  }
  if (expectedHash && expectedHash !== hash) {
    throw new Error("Recovered file hash does not match recorded ciphertext hash.");
  }
  const existingKey = candidateKeys(location).find((item) => !path.isAbsolute(item));
  const key = existingKey ?? `${document.ownerProfileId}/${document.id}/v1.bin`;
  console.log(JSON.stringify({ action: apply ? "upload" : "dry_run", target: location.label, key, bytes: bytes.length, sha256: hash }, null, 2));
  if (!apply) return;

  const uploaded = await getStorageProvider().upload({
    key,
    body: bytes,
    contentType: "application/octet-stream",
  });
  if (location.table === "Document") {
    await prisma.document.update({
      where: { id: location.id },
      data: { storageKey: uploaded.key, path: uploaded.key, storedName: path.basename(uploaded.key), storageBucket: uploaded.bucket ?? null },
    });
    return;
  }
  await prisma.documentFile.update({
    where: { id: location.id },
    data: { storageKey: uploaded.key, storedName: path.basename(uploaded.key) },
  });
}

async function main() {
  const id = readArg("--id");
  if (!id) {
    usage();
    process.exitCode = 1;
    return;
  }
  const document = await prisma.document.findUnique({ where: { id }, include: { files: true } });
  if (!document) throw new Error(`Document ${id} not found.`);
  console.log(JSON.stringify({
    id: document.id,
    ownerProfileId: document.ownerProfileId,
    sourceProvider: document.sourceProvider,
    driveFileId: document.driveFileId,
    storageKey: document.storageKey,
    path: document.path,
    files: document.files.map((file) => ({ pageIndex: file.pageIndex, storageKey: file.storageKey })),
  }, null, 2));
  console.log(JSON.stringify(await audit(document), null, 2));
  const recoverFile = readArg("--recover-file");
  if (recoverFile) await recover(document, recoverFile, readArg("--target"), hasFlag("--apply"));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
