/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { withPrivateUser, withPrivateMigration } from "./access";
import { encryptedModels, modelDefinitions, ownerField } from "./modelCodec";

const url = process.env.PRIVACY_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(url)) throw new Error("Use isolated local privacy_test on port 55439.");
process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ modules: `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "modules";
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.DOCUMENT_ENCRYPTION_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.DOCUMENT_METADATA_ENCRYPTION_KEY = `base64:${randomBytes(32).toString("base64")}`;
const raw = new PrismaClient({ log: [] });
const userId = randomUUID(), otherUserId = randomUUID(), sample = `PRIVATE-MODULE-${randomUUID()}`;
const targets = ["WealthRecord", "ExternalConnection", "ExternalDocumentCandidate", "UserIdentityProfile", "TemporaryUpload", "DigiLockerConsentSession", "PushSubscription", "AccountChangeOtp"];

async function run() {
  const { prisma } = await import("../lib/prisma");
  const wealth = await import("../services/wealthRecords.service");
  const statements = (await fs.readFile("prisma/migrations/20261015210000_private_wealth_integration_fields/migration.sql", "utf8")).replace(/^\s*--.*$/gm, "").split(";").filter(item => item.trim());
  const present = await raw.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='wealth_records' AND column_name='private_title') AS present`;
  if (!present[0].present) for (const statement of statements.filter(item => !item.includes("ADD CONSTRAINT"))) await raw.$executeRawUnsafe(statement);
  for (const model of targets) {
    const table = modelDefinitions.get(model)!.dbName || model;
    await raw.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_private_v2"`);
  }
  try {
    await withPrivateMigration("synthetic user fixtures", () => prisma.user.createMany({ data: [{ id: userId, name: "Owner", email: `${userId}@example.test` }, { id: otherUserId, name: "Other", email: `${otherUserId}@example.test` }] }));
    const oldWealth = await raw.wealthRecord.create({ data: { ownerUserId: userId, type: "INSURANCE", title: sample, details: { provider: sample, amount: 4532.79 }, followUpDate: new Date("2026-10-15"), followUpNote: sample, notes: sample } });
    const connection = await raw.externalConnection.create({ data: { userId, provider: "gmail", providerAccountId: sample, providerEmail: `${sample}@example.test`, encryptedRefreshToken: sample, grantedScopes: [sample], scanPhase: sample, lastScanError: sample } });
    const candidate = await raw.externalDocumentCandidate.create({ data: { userId, connectionId: connection.id, provider: "gmail", sourceKey: sample, externalMessageId: sample, externalAttachmentId: sample, filename: sample, mimeType: "application/pdf", size: 100, sender: sample, subject: sample, receivedAt: new Date("2026-04-05"), suggestedCategory: "medical", suggestedDocumentType: sample, relevanceReason: sample, relevanceScore: 81, matchedSignals: [sample], ignoredReason: sample } });
    const profile = await raw.userIdentityProfile.create({ data: { userId, fullName: sample, normalizedNameHash: sample, dateOfBirth: "1981-04-03", dateOfBirthHash: sample, documentNumber: sample, createdFromDocumentId: "opaque-document" } });
    const temporary = await raw.temporaryUpload.create({ data: { ownerProfileId: userId, storagePath: "/tmp/opaque-test.bin", originalName: sample, detectedMimeType: "application/pdf", size: 100, expiresAt: new Date(Date.now() + 60_000), contentHash: sample, sourceMessageId: sample, sourceAttachmentId: sample, wrappedKey: sample, originalSha256: sample } });
    const consent = await raw.digiLockerConsentSession.create({ data: { userId, verificationId: sample, environment: "sandbox", redirectUrl: `https://example.test/${sample}`, requestedDocuments: [sample], availableDocuments: [sample], consentUrl: `https://example.test/${sample}`, statusMessage: sample } });
    const push = await raw.pushSubscription.create({ data: { userId, endpoint: `https://example.test/${sample}`, p256dh: sample, auth: sample, userAgent: sample } });
    const otp = await raw.accountChangeOtp.create({ data: { userId, purpose: "email", newEmail: `${sample}@example.test`, otpHash: "restricted-one-way-verifier", expiresAt: new Date(Date.now() + 60_000) } });
    for (const statement of statements.filter(item => item.includes("ADD CONSTRAINT"))) await raw.$executeRawUnsafe(statement);
    const migrate = (...args: string[]) => {
      const output = execFileSync(process.execPath, ["--import", "tsx", "src/scripts/migratePrivateRecords.ts", ...args], { env: process.env, encoding: "utf8" });
      assert(!output.includes(sample)); return JSON.parse(output.trim());
    };
    assert.equal(migrate().models.WealthRecord.pending, 1);
    assert.equal(migrate("--apply").models.ExternalDocumentCandidate.updated, 1);
    assert.equal(migrate("--verify").models.TemporaryUpload.pending, 0);
    assert.equal(migrate("--apply").models.UserIdentityProfile.updated, 0);
    for (const model of targets) {
      const rows = await (raw as any)[model[0].toLowerCase() + model.slice(1)].findMany({ where: { [ownerField(model)]: userId } });
      assert(!JSON.stringify(rows).includes(sample));
    }
    assert.equal((await raw.wealthRecord.findUniqueOrThrow({ where: { id: oldWealth.id } })).followUpDate, null);
    assert.equal((await raw.externalDocumentCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).receivedAt.getTime(), 0);
    await withPrivateUser(userId, async () => {
      assert.equal((await wealth.getWealthRecord(userId, oldWealth.id)).title, sample);
      const created = await wealth.createWealthRecord(userId, { type: "INSURANCE", title: sample, details: { provider: sample, amount: 9847.31 }, notes: sample, followUpDate: "2026-11-03", followUpNote: sample });
      await wealth.updateWealthRecord(userId, created.id, { type: "ASSET", title: `${sample}-updated`, details: { institution: sample }, attachmentDocumentIds: [] });
      assert.equal((await wealth.getWealthRecord(userId, created.id)).type, "ASSET");
      assert.equal((await wealth.listFullWealthRecords(userId)).length, 2);
      assert.equal((await prisma.externalConnection.findUniqueOrThrow({ where: { userId_provider: { userId, provider: "gmail" } } })).providerEmail, `${sample}@example.test`);
      const loaded = await prisma.externalDocumentCandidate.findUniqueOrThrow({ where: { connectionId_sourceKey: { connectionId: connection.id, sourceKey: sample } } });
      assert.equal(loaded.subject, sample);
      assert.deepEqual(loaded.matchedSignals, [sample]);
      assert.equal(loaded.receivedAt.toISOString().slice(0, 10), "2026-04-05");
      assert.equal((await prisma.externalDocumentCandidate.findMany({ where: { userId, relevanceScore: { gt: 80 }, matchedSignals: { isEmpty: false } }, orderBy: [{ relevanceScore: "desc" }, { receivedAt: "desc" }], take: 1 }))[0].id, candidate.id);
      const updated = await prisma.externalDocumentCandidate.upsert({ where: { connectionId_sourceKey: { connectionId: connection.id, sourceKey: sample } }, create: { ...loaded, id: randomUUID() }, update: { subject: `${sample}-updated` } });
      assert.equal(updated.id, candidate.id);
      assert.equal(updated.subject, `${sample}-updated`);
      assert.equal((await prisma.userIdentityProfile.findUniqueOrThrow({ where: { userId } })).documentNumber, sample);
      assert.equal((await prisma.temporaryUpload.findUniqueOrThrow({ where: { id: temporary.id } })).originalName, sample);
      assert.equal((await prisma.digiLockerConsentSession.findUniqueOrThrow({ where: { verificationId: sample } })).id, consent.id);
      assert.equal((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: `https://example.test/${sample}` } })).id, push.id);
      assert.equal((await prisma.accountChangeOtp.findUniqueOrThrow({ where: { userId_purpose: { userId, purpose: "email" } } })).newEmail, `${sample}@example.test`);
      assert.equal((await prisma.accountChangeOtp.findUniqueOrThrow({ where: { id: otp.id } })).otpHash, "restricted-one-way-verifier");
      await wealth.deleteWealthRecord(userId, created.id);
    });
    await withPrivateUser(otherUserId, async () => {
      await assert.rejects(prisma.externalConnection.findUnique({ where: { id: connection.id } }), /not found/);
      await assert.rejects(prisma.temporaryUpload.findUnique({ where: { id: temporary.id } }), /not found/);
      await assert.rejects(prisma.userIdentityProfile.findUnique({ where: { id: profile.id } }), /not found/);
      await assert.rejects(wealth.getWealthRecord(otherUserId, oldWealth.id), /not found/);
    });
    // The operator delivery endpoint returns operational counts only; no provider is contacted.
    const { default: express } = await import("express");
    const { default: webPush } = await import("web-push");
    const vapid = webPush.generateVAPIDKeys(); process.env.VAPID_PUBLIC_KEY = vapid.publicKey; process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.ADMIN_SEED_TOKEN = randomUUID();
    const { adminNotificationsRouter } = await import("../routes/notifications.routes");
    const { errorHandler } = await import("../middleware/errorHandling");
    const app = express(); app.use(express.json()); app.use("/admin", adminNotificationsRouter); app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address() as import("node:net").AddressInfo;
      const endpoint = `http://127.0.0.1:${address.port}/admin/send`;
      assert.equal((await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: otherUserId }) })).status, 403);
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-seed-token": process.env.ADMIN_SEED_TOKEN }, body: JSON.stringify({ email: `${otherUserId}@example.test` }) });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { attempted: 0, sent: 0 });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    await assert.rejects(raw.externalDocumentCandidate.update({ where: { id: candidate.id }, data: { subject: sample } }));
    await assert.rejects(raw.wealthRecord.update({ where: { id: oldWealth.id }, data: { type: "INSURANCE" } }));
    for (const model of targets) {
      const table = modelDefinitions.get(model)!.dbName || model;
      await raw.$executeRawUnsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${table}_private_v2"`);
    }
    console.log("PASS: wealth/integration/temp/identity/push/OTP ciphertext, migration retry+verification, keyed uniqueness/upserts, clinical/financial types/dates, authorized APIs, cross-user isolation, raw plaintext rejection.");
  } finally {
    await raw.temporaryUpload.deleteMany({ where: { ownerProfileId: userId } });
    await raw.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await Promise.all([raw.$disconnect(), prisma.$disconnect()]);
  }
}
run().catch(error => {
  console.error("Module privacy integration failed.", { name: error.name, code: error.code, argument: String(error.message).match(/Unknown argument `([A-Za-z_]+)`/)?.[1], frames: String(error.stack).split("\n").filter((line: string) => /^\s+at /.test(line)).slice(-5) });
  process.exitCode = 1;
});
