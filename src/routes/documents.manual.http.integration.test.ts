import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { prisma } from '../lib/prisma';
import documentsRouter from './documents.routes';
import { errorHandler } from '../middleware/errorHandling';
import { signAccessToken } from '../utils/jwt';
import { encryptDocumentOnBackend } from '../services/documentHybridEncryption';
import { createEncryptedTemporaryUpload } from '../services/documentFileStorage';
import { resetStorageProviderForTests } from '../infrastructure/storage/createStorageProvider';

async function run() {
  const userId = `manual-http-${crypto.randomUUID()}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'readiness-manual-http-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.LOCAL_STORAGE_PATH = directory;
  resetStorageProviderForTests();
  const app = express();
  app.use(express.json());
  app.use('/documents', documentsRouter);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address() as { port: number };
  const token = signAccessToken({ sub: userId, email: `${userId}@example.invalid` });
  const pendingIds: string[] = [];
  const pendingPaths: string[] = [];
  const savedIds: string[] = [];
  const prepare = async () => {
    const filename = `${crypto.randomUUID()}.png`;
    const envelope = encryptDocumentOnBackend(Buffer.from(filename), { filename, mimeType: 'image/png' });
    const upload = await createEncryptedTemporaryUpload(userId, envelope);
    pendingIds.push(upload.id);
    pendingPaths.push(upload.storagePath);
    return upload;
  };
  const save = async (body: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.status === 201) savedIds.push(result.document.id);
    return { status: response.status, result };
  };
  try {
    await prisma.user.create({ data: { id: userId, name: 'Manual HTTP Test', email: `${userId}@example.invalid` } });
    const categoryOnlyUpload = await prepare();
    const categoryOnly = await save({ tempFileIds: [categoryOnlyUpload.id], analysisSource: 'manual', category: 'Identity' });
    assert.equal(categoryOnly.status, 201, JSON.stringify(categoryOnly.result));
    assert.equal(categoryOnly.result.document.category, 'identity');
    assert.equal(categoryOnly.result.document.title, categoryOnlyUpload.originalName);

    const panWithoutNumber = await prepare();
    const panOnly = await save({ tempFileIds: [panWithoutNumber.id], analysisSource: 'manual', category: 'Identity', documentType: 'PAN Card' });
    assert.equal(panOnly.status, 201, JSON.stringify(panOnly.result));
    assert.equal(panOnly.result.document.uniqueIdentifier, null);

    const panWithNumber = await prepare();
    const pan = await save({ tempFileIds: [panWithNumber.id], analysisSource: 'manual', category: 'Identity', documentType: 'PAN Card', fields: { uniqueNumber: 'ABCDE1234F' } });
    assert.equal(pan.status, 201, JSON.stringify(pan.result));
    assert.equal(pan.result.document.uniqueIdentifier, 'ABCDE1234F');

    const medicalUpload = await prepare();
    const medical = await save({ tempFileIds: [medicalUpload.id], analysisSource: 'manual', category: 'Medical' });
    assert.equal(medical.status, 201, JSON.stringify(medical.result));
    assert.equal(medical.result.document.category, 'medical');

    const missingCategoryUpload = await prepare();
    const missing = await save({ tempFileIds: [missingCategoryUpload.id], analysisSource: 'manual' });
    assert.equal(missing.status, 422);
    assert.equal(missing.result.message, 'Please select a category.');
    assert.equal(await prisma.document.count({ where: { ownerProfileId: userId } }), 4);

    const aiUpload = await prepare();
    const ai = await save({ tempFileIds: [aiUpload.id], analysisSource: 'ai', category: 'Identity', documentType: 'PAN Card', confidence: 90, fields: { uniqueNumber: 'FGHIJ5678K' } });
    assert.equal(ai.status, 201, JSON.stringify(ai.result));
    console.log('PASS: manual category-only, optional PAN number, medical upload, missing-category error, AI save, and persisted records over authenticated HTTP.');
  } finally {
    for (const id of savedIds) {
      await fetch(`http://127.0.0.1:${address.port}/documents/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.document.deleteMany({ where: { ownerProfileId: userId } });
    await prisma.temporaryUpload.deleteMany({ where: { id: { in: pendingIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await Promise.all(pendingPaths.map(file => fs.rm(file, { force: true })));
    await fs.rm(directory, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
