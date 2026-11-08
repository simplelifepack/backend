import { OpenAIDocumentAnalyzer } from "../services/documentAnalyzer/openaiDocumentAnalyzer";
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { setDocumentAnalyzerForTests } from '../services/documentAnalyzer';
import { prisma } from '../lib/prisma';
import { withPrivateUser } from '../privacy/access';
import healthRouter from './health.routes';
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
  // Isolate repeated test runs from the shared local IP upload limit.
  app.set('trust proxy', 'loopback');
  const testClientIp = `198.18.${crypto.randomInt(256)}.${crypto.randomInt(256)}`;
  app.use(express.json());
  app.use('/documents', documentsRouter);
  app.use('/health', healthRouter);
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
  return withPrivateUser(userId, async () => {
  try {
    await prisma.user.create({ data: { id: userId, name: 'Manual HTTP Test', email: `${userId}@example.invalid`, aiProcessingEnabled: true } });
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
    assert.equal(medical.result.healthRecord.processingStatus, 'awaiting_profile_match');

    const missingCategoryUpload = await prepare();
    const missing = await save({ tempFileIds: [missingCategoryUpload.id], analysisSource: 'manual' });
    assert.equal(missing.status, 422);
    assert.equal(missing.result.message, 'Please select a category.');
    assert.equal(await prisma.document.count({ where: { ownerProfileId: userId } }), 4);

    let analysisCalls = 0;
    let patientDob: string | null = "1990-01-01";
    let notifyStarted!: () => void;
    let finishAnalysis!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const finish = new Promise<void>(resolve => { finishAnalysis = resolve; });
    setDocumentAnalyzerForTests({ analyzeDocument: async () => {
      analysisCalls++;
      if (analysisCalls === 1) throw new Error("Simulated analysis failure");
      notifyStarted();
      await finish;
      return {
        category: 'Medical', documentType: 'Lab Report', uniqueNumber: null, nameOnDocument: 'Synthetic Patient', expiryDate: null,
        healthExtraction: {
          documentType: 'lab_report', patient: { name: 'Synthetic Patient', dateOfBirth: patientDob, bloodGroup: 'O+' },
          measurements: [{ name: 'Glucose', value: 102, unit: 'mg/dL' }], medications: [], followUps: [],
        },
      };
    } });
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());
    const scan = async (bytes = pdfBytes) => {
      const { ciphertext, ...metadata } = encryptDocumentOnBackend(bytes, { filename: 'report.pdf', mimeType: 'application/pdf' });
      const form = new FormData();
      form.append('encryptedFiles', new Blob([new Uint8Array(ciphertext)]), 'file.bin');
      form.append('envelopes', JSON.stringify([metadata]));
      const response = await fetch(`http://127.0.0.1:${address.port}/documents/analyze`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": testClientIp }, body: form });
      return { status: response.status, body: await response.json() };
    };
    const failedScan = await scan();
    assert.equal(failedScan.status, 200, JSON.stringify(failedScan.body));
    assert.equal(failedScan.body.warnings[0].code, 'AI_ANALYSIS_UNAVAILABLE');
    const failedUploadId = failedScan.body.files[0].tempFileId as string;
    pendingIds.push(failedUploadId);
    const inFlightScan = scan();
    try {
      await Promise.race([started, inFlightScan.then(result => { throw new Error(JSON.stringify(result.body)); })]);
      const overlap = await scan();
      assert.equal(overlap.status, 409, JSON.stringify(overlap.body));
      assert.equal(overlap.body.code, 'UPLOAD_ANALYSIS_PENDING');
    } finally {
      finishAnalysis();
    }
    const firstScan = await inFlightScan;
    assert.equal(firstScan.status, 200, JSON.stringify(firstScan.body));
    const aiUploadId = firstScan.body.files[0].tempFileId as string;
    assert.equal(aiUploadId, failedUploadId);
    assert.equal(firstScan.body.warnings.length, 0);
    const previousUpload = await prisma.temporaryUpload.findUniqueOrThrow({ where: { id: aiUploadId }, select: { storagePath: true } });
    const replay = await scan();
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    const replacement = await prisma.temporaryUpload.findUniqueOrThrow({ where: { id: aiUploadId }, select: { storagePath: true } });
    assert.equal(replacement.storagePath, previousUpload.storagePath);
    assert.equal(replay.body.files[0].tempFileId, aiUploadId);
    assert.deepEqual(replay.body.document, firstScan.body.document);
    await prisma.temporaryUpload.update({ where: { id: aiUploadId }, data: { expiresAt: new Date(0) } });
    const renewed = await scan();
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
    assert.equal(renewed.body.files[0].tempFileId, aiUploadId);
    assert.deepEqual(renewed.body.document, replay.body.document);
    const aiPayload = { tempFileIds: [aiUploadId], analysisSource: 'ai', category: 'Medical', documentType: 'Lab Report', confidence: 90 };
    const saves = await Promise.all([save(aiPayload), save(aiPayload)]);
    assert.deepEqual(saves.map(result => result.status).sort(), [200, 201], JSON.stringify(saves));
    assert.equal(saves[0]!.result.document.id, saves[1]!.result.document.id);
    const ai = saves.find(result => result.status === 201)!;
    assert.equal(analysisCalls, 3);
    assert.equal(ai.result.healthRecord.measurements[0].value, 102);
    const profile = await prisma.healthMember.findFirstOrThrow({ where: { id: ai.result.healthRecord.memberId, userId } });
    assert.equal(profile.relation, 'Unknown');
    assert.equal(ai.result.healthRecord.createdMember.id, profile.id);

    pdf.setTitle('Second report for the same patient');
    const secondScan = await scan(Buffer.from(await pdf.save()));
    assert.equal(secondScan.status, 200, JSON.stringify(secondScan.body));
    const secondId = secondScan.body.files[0].tempFileId as string;
    pendingIds.push(secondId);
    const matched = await save({ ...aiPayload, tempFileIds: [secondId] });
    assert.equal(matched.status, 201, JSON.stringify(matched.result));
    assert.equal(matched.result.healthRecord.memberId, profile.id);
    assert.equal(matched.result.healthRecord.createdMember, undefined);
    assert.equal(await prisma.healthMember.count({ where: { userId, name: 'Synthetic Patient' } }), 1);
    const records = await fetch(`http://127.0.0.1:${address.port}/health/members/${profile.id}/records`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(records.status, 200);
    assert.equal((await records.json()).length, 2);
    assert.equal(analysisCalls, 4);
    patientDob = null;
    pdf.setTitle('Report without patient DOB');
    const ambiguousScan = await scan(Buffer.from(await pdf.save()));
    assert.equal(ambiguousScan.status, 200, JSON.stringify(ambiguousScan.body));
    const ambiguousId = ambiguousScan.body.files[0].tempFileId as string;
    pendingIds.push(ambiguousId);
    const ambiguous = await save({ ...aiPayload, tempFileIds: [ambiguousId] });
    assert.equal(ambiguous.status, 201, JSON.stringify(ambiguous.result));
    assert.equal(ambiguous.result.healthRecord.memberId, profile.id);
    assert.equal(ambiguous.result.healthRecord.createdMember, undefined);
    assert.equal(await prisma.healthMember.count({ where: { userId, name: 'Synthetic Patient' } }), 1);
    assert.equal(analysisCalls, 5);
    let batchCalls = 0;
    const patientNames = ['Batch Patient A', 'Batch Patient B', 'Batch Patient A'];
    setDocumentAnalyzerForTests(new OpenAIDocumentAnalyzer(undefined, 'synthetic', async body => {
      batchCalls++;
      assert(Array.isArray(body.input));
      const message = body.input[0];
      assert(message && 'content' in message && Array.isArray(message.content));
      assert.equal(message.content.filter(item => item.type === 'input_file').length, 3);
      const documents = patientNames.map((name, index) => ({
        documentNumber: index + 1,
        analysis: {
          category: 'Medical', documentType: 'Lab Report', uniqueNumber: null, nameOnDocument: name,
          healthExtraction: { documentType: 'lab_report', patient: { name, age: 50, gender: 'F' } },
        },
      }));
      return { output_text: JSON.stringify({ documents: documents.reverse() }) };
    }));
    const batch = new FormData();
    const batchEnvelopes = [];
    for (const [index, filename] of ['first.pdf', 'second.pdf', 'third.pdf', 'already-saved.pdf'].entries()) {
      pdf.setTitle(filename);
      const bytes = index === 3 ? pdfBytes : Buffer.from(await pdf.save());
      const { ciphertext, ...metadata } = encryptDocumentOnBackend(bytes, { filename, mimeType: 'application/pdf' });
      batch.append('encryptedFiles', new Blob([new Uint8Array(ciphertext)]), 'file.bin');
      batchEnvelopes.push(metadata);
    }
    batch.append('envelopes', JSON.stringify(batchEnvelopes));
    const batchResponse = await fetch(`http://127.0.0.1:${address.port}/documents/analyze/batch`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": testClientIp }, body: batch,
    });
    assert.equal(batchResponse.status, 200);
    const batchResult = await batchResponse.json();
    assert.equal(batchCalls, 1);
    assert.deepEqual(batchResult.issues, [{ fileName: 'already-saved.pdf', message: 'Already in Readiness' }]);
    assert.equal(batchResult.analyses.length, 3);
    const batchMembers = [];
    for (const [index, analysis] of batchResult.analyses.entries()) {
      assert.equal(analysis.document.nameOnDocument, patientNames[index]);
      assert.equal(analysis.files.length, 1);
      const tempFileId = analysis.files[0].tempFileId as string;
      pendingIds.push(tempFileId);
      const saved = await save({ ...aiPayload, tempFileIds: [tempFileId] });
      assert.equal(saved.status, 201, JSON.stringify(saved.result));
      batchMembers.push(saved.result.healthRecord.memberId);
    }
    assert.equal(batchMembers[0], batchMembers[2]);
    assert.notEqual(batchMembers[0], batchMembers[1]);
    assert.equal(batchCalls, 1);
    setDocumentAnalyzerForTests({ analyzeDocument: async () => ({
      category: 'Employment', documentType: 'Resume', uniqueNumber: null, nameOnDocument: 'Resume Applicant', expiryDate: null,
      healthExtraction: { documentType: 'medical_report', patient: { name: 'Resume Applicant' }, measurements: [], medications: [], followUps: [] },
    }) });
    pdf.setTitle('Resume');
    const resume = await scan(Buffer.from(await pdf.save()));
    assert.equal(resume.status, 200, JSON.stringify(resume.body));
    assert.equal(resume.body.document.healthExtraction, null);
    assert.equal(resume.body.healthProfileMatch, undefined);
    const resumeId = resume.body.files[0].tempFileId as string;
    pendingIds.push(resumeId);
    const override = await save({ ...aiPayload, tempFileIds: [resumeId] });
    assert.equal(override.status, 422);
    const resumeSave = await save({ ...aiPayload, tempFileIds: [resumeId], category: 'Employment', documentType: 'Resume' });
    assert.equal(resumeSave.status, 201, JSON.stringify(resumeSave.result));
    assert.equal(resumeSave.result.healthRecord, null);
    const resumeRecord = await fetch(`http://127.0.0.1:${address.port}/health/records`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: resumeSave.result.document.id, newMember: { name: 'Resume Applicant', relation: 'Unknown' } }),
    });
    assert.equal(resumeRecord.status, 422);
    assert.equal(await prisma.healthMember.count({ where: { userId, name: 'Resume Applicant' } }), 0);

    const zipResponse = await fetch(`http://127.0.0.1:${address.port}/documents/bulk-download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [categoryOnly.result.document.id, panOnly.result.document.id] }),
    });
    assert.equal(zipResponse.status, 200);
    assert.equal(zipResponse.headers.get('content-type'), 'application/zip');
    const zip = Buffer.from(await zipResponse.arrayBuffer());
    assert.equal(zip.subarray(0, 2).toString(), 'PK');
    assert.match(zip.toString('utf8'), new RegExp(categoryOnlyUpload.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const bulkDeleteResponse = await fetch(`http://127.0.0.1:${address.port}/documents/bulk-delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [medical.result.document.id, ai.result.document.id] }),
    });
    assert.equal(bulkDeleteResponse.status, 204);
    assert.equal(await prisma.document.count({ where: { id: { in: [medical.result.document.id, ai.result.document.id] } } }), 0);
    console.log('PASS: manual saves, authenticated bulk ZIP download, bulk delete cleanup, and persisted records over HTTP.');
  } finally {
    setDocumentAnalyzerForTests(null);
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
  });
}

run().catch(error => { console.error(error); process.exitCode = 1; });
