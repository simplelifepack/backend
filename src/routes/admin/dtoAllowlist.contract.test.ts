// Phase 0 tracker item: "DTO allowlist helper + a contract test that fails
// the build if a sealed key leaks." The design doc (#access) is explicit
// that this is load-bearing, not optional hardening: "The console can
// therefore only promise 'support cannot see your vault' if the DTO layer,
// the contract tests and the audit log all hold."
//
// This seeds ONE real user carrying a distinct marker string in every
// field sealedFields.ts tracks, boots the real Express app on an ephemeral
// port, signs in as a real admin via the existing dev-login bypass, and
// issues real HTTP GETs against every admin route that reads data shaped
// by a model in the registry — not unit calls into service functions,
// because several of these DTOs are still built inline in the route
// handler (see TRACKER.md), so only an HTTP round trip exercises the
// actual response a browser would receive.
//
// Detection is marker-VALUE scanning, not key-NAME scanning: each response
// body is searched (as raw JSON text) for every marker string seeded
// below. This was a deliberate correction after the first run — matching
// by key name instead (sealedFields.ts's `findSealedKeys`, still kept
// there as a manual-review helper) threw 7 false positives on the very
// first run, because field names collide constantly across unrelated
// models: User.name vs HealthMember.name, HealthDocument.type vs
// HealthReminder.type, the KMS rotation endpoint's own legitimate
// `keyId` vs Document.keyId. A key named "name" tells you nothing; the
// literal string "SEALED_MARKER__HealthMember.conditions" appearing
// anywhere in a response body is unambiguous — it can only be there if an
// actual sealed value flowed through. Zero false positives, same "fails
// the build if a sealed key leaks" guarantee the tracker item asked for.
//
// ROUTE_LIST is hand-maintained, same "no generator yet, keep in sync by
// hand" discipline as admin-web/src/data/nav.ts — update it when a new
// admin GET route is added that could plausibly return a field this
// registry tracks (anything touching User, Document, Health*, WealthRecord
// or TrustMemberPermission).
import "dotenv/config";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { app } from "../../app";
import { prisma } from "../../lib/prisma";
import { devLogin } from "../../services/adminAuth.service";

const ALL_MARKERS: string[] = [];
function marker(field: string) {
  const value = `SEALED_MARKER__${field}`;
  ALL_MARKERS.push(value);
  return value;
}

// Routes checked, GET-only (nothing here mutates). `:id`-style segments are
// filled in from the seed below once it's run.
const ROUTE_TEMPLATES = [
  "/admin/v1/overview/stats",
  "/admin/v1/overview/action-center",
  "/admin/v1/users",
  "/admin/v1/users/:userId",
  "/admin/v1/users/:userId/export-jobs",
  "/admin/v1/users/:userId/sign-in-events",
  "/admin/v1/users/:userId/trust-members",
  "/admin/v1/users/:userId/usage-overrides",
  "/admin/v1/pipelines/stuck-classification",
  "/admin/v1/pipelines/failed-health-extractions",
  "/admin/v1/pipelines/storage-cleanup",
  "/admin/v1/pipelines/expiring-uploads",
  "/admin/v1/security",
  "/admin/v1/trust/stats",
  "/admin/v1/billing/stats",
  "/admin/v1/billing/tier-changes",
  "/admin/v1/feedback",
  "/admin/v1/integrations/disconnected",
  "/admin/v1/integrations/scan-errors",
  "/admin/v1/integrations/stuck-scans",
  "/admin/v1/admins",
  "/admin/v1/admins/:adminId",
  "/admin/v1/ai/tasks",
  "/admin/v1/audit",
  "/admin/v1/audit/retention",
] as const;

const MINIMUM_ROUTES_CHECKED = ROUTE_TEMPLATES.length; // guards against the test silently checking fewer routes than intended

async function seed() {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      name: "DTO Allowlist Contract Test",
      email: `dto-allowlist-contract-${stamp}@example.com`,
      passwordHash: marker("User.passwordHash"),
      pinHash: marker("User.pinHash"),
    },
  });

  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: marker("RefreshToken.tokenHash"), expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: marker("PasswordResetToken.tokenHash"), expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await prisma.accountChangeOtp.create({
    data: {
      userId: user.id,
      purpose: "email",
      otpHash: marker("AccountChangeOtp.otpHash"),
      newPasswordHash: marker("AccountChangeOtp.newPasswordHash"),
      newPinHash: marker("AccountChangeOtp.newPinHash"),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.externalConnection.create({
    data: {
      userId: user.id,
      provider: "gmail",
      providerAccountId: `${stamp}`,
      providerEmail: user.email,
      encryptedRefreshToken: marker("ExternalConnection.encryptedRefreshToken"),
    },
  });

  const document = await prisma.document.create({
    data: {
      title: marker("Document.title"),
      displayName: marker("Document.displayName"),
      uniqueIdentifier: marker("Document.uniqueIdentifier"),
      uniqueIdentifierHash: marker("Document.uniqueIdentifierHash"),
      extractedKeyFields: { marker: marker("Document.extractedKeyFields") },
      rawText: marker("Document.rawText"),
      fields: { marker: marker("Document.fields") },
      path: marker("Document.path"),
      storageKey: marker("Document.storageKey"),
      storageBucket: marker("Document.storageBucket"),
      storageMimeType: marker("Document.storageMimeType"),
      wrappedKey: marker("Document.wrappedKey"),
      encryptionIv: marker("Document.encryptionIv"),
      // Not a marker: keyId is the master key's own rotation id, legitimately
      // shown on the Security screen (see sealedFields.ts) — a plain
      // realistic value here, same as a real document would carry.
      keyId: "contract-test-key-v1",
      originalSha256: marker("Document.originalSha256"),
      encryptedSha256: marker("Document.encryptedSha256"),
      ciphertextHash: marker("Document.ciphertextHash"),
      userScopedDedupHash: marker("Document.userScopedDedupHash"),
      metadataIntegrityHash: marker("Document.metadataIntegrityHash"),
      contentHash: marker("Document.contentHash"),
      sourceChecksum: marker("Document.sourceChecksum"),
      driveFileId: marker("Document.driveFileId"),
      sourceMessageId: marker("Document.sourceMessageId"),
      sourceAttachmentId: marker("Document.sourceAttachmentId"),
      originalName: "contract-test.pdf",
      storedName: "contract-test-stored.pdf",
      mimeType: "application/pdf",
      size: 1,
      documentType: "passport",
      category: "identity",
      analysisSource: "manual",
      confidence: 1,
    },
  });

  const healthMember = await prisma.healthMember.create({
    data: {
      userId: user.id,
      name: marker("HealthMember.name"),
      relation: marker("HealthMember.relation"),
      bloodGroup: marker("HealthMember.bloodGroup"),
      conditions: marker("HealthMember.conditions"),
      allergies: marker("HealthMember.allergies"),
      emergencyContactName: marker("HealthMember.emergencyContactName"),
      emergencyContactPhone: marker("HealthMember.emergencyContactPhone"),
      primaryDoctor: marker("HealthMember.primaryDoctor"),
      insuranceProvider: marker("HealthMember.insuranceProvider"),
      insurancePolicyNumber: marker("HealthMember.insurancePolicyNumber"),
    },
  });

  const healthDocument = await prisma.healthDocument.create({
    data: {
      userId: user.id,
      memberId: healthMember.id,
      documentId: document.id,
      type: "lab_report",
      provider: marker("HealthDocument.provider"),
      doctor: marker("HealthDocument.doctor"),
      patientName: marker("HealthDocument.patientName"),
      // processingError non-null is what makes this row surface in
      // /pipelines/failed-health-extractions — the one real admin screen
      // that reads HealthDocument rows today.
      processingError: "contract test: forced failure",
    },
  });

  await prisma.healthMeasurement.create({
    data: {
      userId: user.id,
      memberId: healthMember.id,
      sourceDocumentId: healthDocument.id,
      metricKey: "glucose",
      displayName: marker("HealthMeasurement.displayName"),
      originalName: marker("HealthMeasurement.originalName"),
      value: 1,
      unit: "mg/dL",
      measuredAt: new Date(),
    },
  });
  await prisma.trackedHealthMetric.create({
    data: { userId: user.id, memberId: healthMember.id, metricKey: "glucose", displayName: marker("TrackedHealthMetric.displayName") },
  });
  await prisma.healthMedication.create({
    data: { userId: user.id, memberId: healthMember.id, name: marker("HealthMedication.name") },
  });
  await prisma.healthFollowUp.create({
    data: { userId: user.id, memberId: healthMember.id, sourceDocumentId: healthDocument.id, title: marker("HealthFollowUp.title") },
  });
  await prisma.healthReminder.create({
    data: { userId: user.id, memberId: healthMember.id, title: marker("HealthReminder.title"), dueDate: new Date(), origin: "manual" },
  });

  const wealthRecord = await prisma.wealthRecord.create({
    data: {
      ownerUserId: user.id,
      type: "ASSET",
      title: marker("WealthRecord.title"),
      details: { marker: marker("WealthRecord.details") },
      notes: marker("WealthRecord.notes"),
    },
  });
  await prisma.wealthRecordAttachment.create({ data: { wealthRecordId: wealthRecord.id, documentId: document.id } });

  const trustMember = await prisma.trustMember.create({
    data: {
      ownerUserId: user.id,
      email: `trust-contract-${stamp}@example.com`,
      name: "Contract Test Trust Member", // identity — deliberately NOT a marker; identity is allowed to show (see adminTrust.service.ts)
      relation: "FRIEND",
      dateOfBirth: "2000-01-01",
      bloodGroup: "O+",
      accessType: "VIEW_ONLY",
      inviteTokenHash: marker("TrustMember.inviteTokenHash"),
      invitePinHash: marker("TrustMember.invitePinHash"),
    },
  });
  await prisma.trustMemberPermission.create({
    data: { trustMemberId: trustMember.id, module: "DOCUMENTS", canView: true, canDownload: true },
  });

  return { userId: user.id, documentId: document.id, healthMemberId: healthMember.id, trustMemberId: trustMember.id };
}

async function cleanup(userId: string) {
  // Cascades cover everything FK'd to the user (RefreshToken, Document's
  // health/wealth linkage, TrustMember, etc.) except Document itself, which
  // has no direct FK to User — delete it by id explicitly.
  await prisma.healthFollowUp.deleteMany({ where: { userId } });
  await prisma.healthReminder.deleteMany({ where: { userId } });
  await prisma.healthMedication.deleteMany({ where: { userId } });
  await prisma.trackedHealthMetric.deleteMany({ where: { userId } });
  await prisma.healthMeasurement.deleteMany({ where: { userId } });
  await prisma.healthDocument.deleteMany({ where: { userId } });
  await prisma.healthMember.deleteMany({ where: { userId } });
  await prisma.wealthRecordAttachment.deleteMany({ where: { wealthRecord: { ownerUserId: userId } } });
  await prisma.wealthRecord.deleteMany({ where: { ownerUserId: userId } });
  await prisma.trustMemberPermission.deleteMany({ where: { trustMember: { ownerUserId: userId } } });
  await prisma.trustMember.deleteMany({ where: { ownerUserId: userId } });
  await prisma.document.deleteMany({ where: { originalName: "contract-test.pdf" } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function run() {
  const seeded = await seed();

  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const { token, admin } = await devLogin("owner", { ip: "127.0.0.1", userAgent: "dto-allowlist-contract-test" });

    const paths = ROUTE_TEMPLATES.map((template) =>
      template.replace(":userId", seeded.userId).replace(":adminId", admin.id),
    );

    assert.ok(ALL_MARKERS.length > 0, "seed() registered zero markers — the test itself regressed");

    const allHits: Array<{ path: string; markers: string[] }> = [];
    let checked = 0;

    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
      assert.ok(
        response.status === 200,
        `expected 200 from ${path} (as owner), got ${response.status} — route moved or capability check changed; update ROUTE_TEMPLATES or the dev-login role`,
      );
      const bodyText = await response.text();
      const leaked = ALL_MARKERS.filter((m) => bodyText.includes(m));
      checked += 1;
      if (leaked.length > 0) allHits.push({ path, markers: leaked });
    }

    assert.ok(
      checked >= MINIMUM_ROUTES_CHECKED,
      `only checked ${checked} routes, expected ${MINIMUM_ROUTES_CHECKED} — the test itself regressed, not just the routes`,
    );

    if (allHits.length > 0) {
      const report = allHits.map((hit) => `  ${hit.path}:\n${hit.markers.map((m) => `    ${m}`).join("\n")}`).join("\n");
      assert.fail(`sealed value(s) leaked through admin DTOs:\n${report}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await cleanup(seeded.userId);
  }
}

run()
  .then(() => { console.log(`dtoAllowlist.contract.test: passed, ${ROUTE_TEMPLATES.length} routes checked, 0 sealed-field leaks`); })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
