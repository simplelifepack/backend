import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { gmail_v1 } from "googleapis";

import { prisma } from "../../lib/prisma";
import { deleteTemporaryUploadFile } from "../documentFileStorage";
import { candidatesFromMessage, flattenParts, GMAIL_RELEVANCE_THRESHOLDS, gmailSearchQueries } from "./candidates";
import { importGmailCandidates } from "./importer";
import { completeAuthorization, createAuthorizationUrl, consumeOAuthState, GmailOAuthError } from "./oauth";
import { completeOAuthPopupCallback } from "../oauthPopupCallback";
import { scanGmail } from "./scanner";
import { decryptGmailToken, encryptGmailToken } from "./tokenEncryption";

const runId = crypto.randomUUID();
process.env.GOOGLE_CLIENT_ID ||= "test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET ||= "test-secret";
process.env.GOOGLE_GMAIL_REDIRECT_URI ||= "http://localhost:4000/api/integrations/gmail/callback";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = `base64:${Buffer.alloc(32, 7).toString("base64")}`;

function message(id: string, withAttachment = true): gmail_v1.Schema$Message {
  return {
    id, internalDate: String(Date.now()), snippet: "Your bank statement is ready",
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "From", value: "alerts@unionbankofindia.bank" }, { name: "Subject", value: "Monthly bank statement" }],
      parts: withAttachment ? [{ filename: "statement.pdf", mimeType: "application/pdf", body: { attachmentId: `attachment-${id}`, size: 100 } }] : [{ mimeType: "text/plain", body: { data: Buffer.from("Bank statement account summary").toString("base64url") } }],
    },
  };
}

function observedMessage(input: {
  id: string; filename: string; sender: string; subject: string; snippet?: string;
  mimeType?: string; disposition?: string; labels?: string[]; partId?: string;
}): gmail_v1.Schema$Message {
  return {
    id: input.id, internalDate: String(Date.now()), snippet: input.snippet ?? "", labelIds: input.labels,
    payload: {
      headers: [{ name: "From", value: input.sender }, { name: "Subject", value: input.subject }],
      parts: [{
        partId: input.partId ?? "1", filename: input.filename, mimeType: input.mimeType ?? "application/pdf",
        headers: input.disposition ? [{ name: "Content-Disposition", value: input.disposition }] : [],
        body: { attachmentId: `attachment-${input.id}-${input.partId ?? "1"}`, size: 5000 },
      }],
    },
  };
}

function gmailMock(messages: Record<string, gmail_v1.Schema$Message>, attachment = Buffer.from("%PDF-1.7\nMock statement")) {
  let listCall = 0;
  const ids = Object.keys(messages);
  return {
    users: { messages: {
      list: async () => {
        listCall += 1;
        if (listCall === 1) return { data: { messages: ids.slice(0, 1).map((id) => ({ id })), nextPageToken: ids.length > 1 ? "page-2" : undefined } };
        if (listCall === 2 && ids.length > 1) return { data: { messages: ids.slice(1).map((id) => ({ id })) } };
        return { data: { messages: [] } };
      },
      get: async ({ id }: { id: string }) => ({ data: messages[id] }),
      attachments: { get: async () => ({ data: { data: attachment.toString("base64url"), size: attachment.length } }) },
    } },
  } as unknown as gmail_v1.Gmail;
}

async function run() {
  assert.deepEqual(GMAIL_RELEVANCE_THRESHOLDS, { relevant: 70, needsReview: 45 });
  assert.equal(gmailSearchQueries.length, 3);
  assert.ok(gmailSearchQueries.every(({ query }) => query.includes("-in:spam") && query.includes("-in:trash")));
  assert.ok(gmailSearchQueries.every(({ query }) => !/passport|ticket|invoice|shopping/i.test(query)));
  const callbackSuccess = await completeOAuthPopupCallback(
    { code: "mock-code", state: "mock-state" },
    {
      provider: "gmail",
      authorize: async (code, state) => { assert.equal(code, "mock-code"); assert.equal(state, "mock-state"); },
      mapError: (error) => error instanceof GmailOAuthError ? error.safeCode : "authorization_failed",
    },
  );
  assert.deepEqual(callbackSuccess, { provider: "gmail", status: "connected" });
  for (const reason of ["invalid_state", "token_exchange_failed", "missing_refresh_token", "database_error"] as const) {
    const failed = await completeOAuthPopupCallback(
      { code: "mock-code", state: "mock-state" },
      {
        provider: "gmail",
        authorize: async () => { throw new GmailOAuthError(reason); },
        mapError: (error) => error instanceof GmailOAuthError ? error.safeCode : "authorization_failed",
      },
    );
    assert.deepEqual(failed, { provider: "gmail", status: "error", reason });
  }
  const denied = await completeOAuthPopupCallback(
    { error: "access_denied", state: "mock-state" },
    {
      provider: "gmail",
      authorize: completeAuthorization,
      consumeDeniedState: async () => undefined,
      mapError: (error) => error instanceof GmailOAuthError ? error.safeCode : "authorization_failed",
    },
  );
  assert.deepEqual(denied, { provider: "gmail", status: "error", reason: "access_denied" });

  const encrypted = encryptGmailToken("refresh-token-value");
  assert.equal(decryptGmailToken(encrypted), "refresh-token-value");
  assert.ok(!encrypted.includes("refresh-token-value"));

  const nested = message("nested");
  assert.equal(flattenParts(nested.payload).length, 2);
  assert.equal(candidatesFromMessage(nested)[0]?.externalAttachmentId, "attachment-nested");
  const logo = candidatesFromMessage(observedMessage({ id: "logo", filename: "Logo.jpg", sender: "alerts@paytmmoney.com", subject: "Account update", mimeType: "image/jpeg", disposition: "inline" }))[0]!;
  assert.equal(logo.status, "ignored"); assert.equal(logo.ignoredReason, "Inline email image");
  const opaquePaytm = candidatesFromMessage(observedMessage({ id: "opaque", filename: "RL_AB216427_Grp1_03072026_sign.pdf", sender: "reports@paytmmoney.com", subject: "Your document" }))[0]!;
  assert.equal(opaquePaytm.status, "needs_review");
  const paytmStatement = candidatesFromMessage(observedMessage({ id: "paytm-statement", filename: "Paytm_Statement_June_2026.pdf", sender: "reports@paytm.com", subject: "Monthly statement" }))[0]!;
  assert.equal(paytmStatement.suggestedCategory, "finance"); assert.match(paytmStatement.suggestedDocumentType, /statement/i);
  const unionInline = ["4.1", "4.2"].map((partId) => candidatesFromMessage(observedMessage({ id: "union-inline", partId, filename: "image001.jpg", sender: "alerts@unionbankofindia.bank", subject: "Account statement", mimeType: "image/jpeg", disposition: "inline" }))[0]!);
  assert.ok(unionInline.every((item) => item.status === "ignored")); assert.notEqual(unionInline[0].sourceKey, unionInline[1].sourceKey);
  const unionPdf = candidatesFromMessage(observedMessage({ id: "union-pdf", filename: "1077247_0900.pdf", sender: "alerts@unionbankofindia.bank", subject: "Your account statement" }))[0]!;
  assert.equal(unionPdf.suggestedCategory, "finance"); assert.notEqual(unionPdf.status, "ignored");
  const uiic = candidatesFromMessage(observedMessage({ id: "uiic", filename: "PA_CERTIFICATE_4140913015.pdf", sender: "service@uiic.co.in", subject: "Policy document" }))[0]!;
  assert.equal(uiic.suggestedCategory, "insurance"); assert.equal(uiic.suggestedDocumentType, "Insurance policy certificate");
  for (const item of [
    observedMessage({ id: "ticket", filename: "Ticket.pdf", sender: "tickets@paytm.com", subject: "Your ticket" }),
    observedMessage({ id: "tax-invoice", filename: "Invoice_22.pdf", sender: "receipts@paytm.com", subject: "Tax Invoice" }),
    observedMessage({ id: "bms", filename: "BMS_Invoice_99.pdf", sender: "tickets@bookmyshow.com", subject: "Movie booking invoice" }),
  ]) assert.equal(candidatesFromMessage(item)[0]?.status, "ignored");
  const health = candidatesFromMessage(observedMessage({ id: "health", filename: "Pathology_Report.pdf", sender: "reports@citydiagnostics.com", subject: "Your lab report" }))[0]!;
  assert.equal(health.suggestedCategory, "medical"); assert.equal(health.status, "candidate");
  const healthOffer = candidatesFromMessage(observedMessage({ id: "health-offer", filename: "brochure.pdf", sender: "marketing@healthinsurance.com", subject: "Exclusive health insurance offer", labels: ["CATEGORY_PROMOTIONS"] }))[0]!;
  assert.equal(healthOffer.status, "ignored"); assert.equal(healthOffer.ignoredReason, "Promotional email");
  const actualPolicy = candidatesFromMessage(observedMessage({ id: "health-policy", filename: "Health_Insurance_Policy.pdf", sender: "service@healthinsurance.com", subject: "Your health insurance policy - exclusive offer", labels: ["CATEGORY_PROMOTIONS"] }))[0]!;
  assert.equal(actualPolicy.status, "candidate");

  const user = await prisma.user.create({ data: { name: "Gmail Test", email: `gmail-${runId}@example.test`, passwordHash: null } });
  const other = await prisma.user.create({ data: { name: "Other", email: `gmail-other-${runId}@example.test`, passwordHash: null } });
  const url = new URL(await createAuthorizationUrl(user.id));
  const state = url.searchParams.get("state");
  assert.ok(state);
  assert.equal((await consumeOAuthState(state!)).userId, user.id);
  await assert.rejects(() => consumeOAuthState(state!), /invalid_state/);

  const connection = await prisma.externalConnection.create({ data: {
    userId: user.id, provider: "gmail", providerAccountId: `gmail-${runId}@example.test`,
    providerEmail: `gmail-${runId}@example.test`, encryptedRefreshToken: encrypted,
    grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  } });
  const scan = await scanGmail(user.id, gmailMock({ scan: message("scan"), "scan-page-2": message("scan-page-2") }));
  assert.equal(scan.discovered, 2);
  assert.equal(scan.relevant, 2);
  assert.ok((await prisma.externalConnection.findUniqueOrThrow({ where: { id: connection.id } })).lastScannedAt);
  assert.equal(await prisma.externalDocumentCandidate.count({ where: { connectionId: connection.id } }), 2);
  await scanGmail(user.id, gmailMock({ scan: message("scan") }));
  assert.equal(await prisma.externalDocumentCandidate.count({ where: { connectionId: connection.id } }), 2);

  const bodyCandidate = await prisma.externalDocumentCandidate.create({ data: {
    userId: user.id, connectionId: connection.id, provider: "gmail", sourceKey: "body-import",
    externalMessageId: "body-import", externalAttachmentId: null, filename: "statement.txt", mimeType: "text/plain", size: 0,
    sender: "bank@example.com", subject: "Bank statement", receivedAt: new Date(), suggestedCategory: "finance",
    suggestedDocumentType: "Financial document", relevanceReason: "Matched bank statement", relevanceScore: 80,
  } });
  const imported = await importGmailCandidates(user.id, [bodyCandidate.id], gmailMock({ "body-import": message("body-import", false) }));
  assert.equal(imported[0]?.status, "ready_for_review");
  assert.equal(imported[0]?.analysis?.analysisSource, "rules");
  assert.ok(imported[0]?.analysis?.tempFileId);
  const importedUpload = await prisma.temporaryUpload.findUniqueOrThrow({ where: { id: imported[0]!.analysis!.tempFileId } });
  await prisma.document.create({ data: {
    ownerProfileId: user.id, originalName: "statement.txt", storedName: "test", mimeType: "text/plain", size: 30,
    path: "test-only", documentType: "bank_statement", normalizedType: "bank_statement", category: "finance",
    analysisSource: "rules", confidence: 50, fields: {}, contentHash: importedUpload.contentHash,
  } });
  const duplicateCandidate = await prisma.externalDocumentCandidate.create({ data: {
    userId: user.id, connectionId: connection.id, provider: "gmail", sourceKey: "duplicate-body",
    externalMessageId: "duplicate-body", externalAttachmentId: null, filename: "statement.txt", mimeType: "text/plain", size: 0,
    sender: "bank@example.com", subject: "Bank statement", receivedAt: new Date(), suggestedCategory: "finance",
    suggestedDocumentType: "Financial document", relevanceReason: "Matched bank statement", relevanceScore: 80,
  } });
  const duplicate = await importGmailCandidates(user.id, [duplicateCandidate.id], gmailMock({ "duplicate-body": message("duplicate-body", false) }));
  assert.equal(duplicate[0]?.status, "already_imported");
  await assert.rejects(() => importGmailCandidates(other.id, [bodyCandidate.id], gmailMock({})), /unavailable/);

  const unsupported = await prisma.externalDocumentCandidate.create({ data: {
    userId: user.id, connectionId: connection.id, provider: "gmail", sourceKey: "bad", externalMessageId: "bad",
    externalAttachmentId: "bad", filename: "bad.zip", mimeType: "application/zip", size: 5, sender: "x", subject: "x",
    receivedAt: new Date(), suggestedCategory: "other", suggestedDocumentType: "Document", relevanceReason: "test", relevanceScore: 1,
  } });
  await assert.rejects(() => importGmailCandidates(user.id, [unsupported.id], gmailMock({})), /Unsupported/);
  const oversized = await prisma.externalDocumentCandidate.create({ data: {
    userId: user.id, connectionId: connection.id, provider: "gmail", sourceKey: "large", externalMessageId: "large",
    externalAttachmentId: "large", filename: "large.pdf", mimeType: "application/pdf", size: 26 * 1024 * 1024,
    sender: "x", subject: "x", receivedAt: new Date(), suggestedCategory: "other", suggestedDocumentType: "Document",
    relevanceReason: "test", relevanceScore: 1,
  } });
  await assert.rejects(() => importGmailCandidates(user.id, [oversized.id], gmailMock({})), /25 MB/);
  console.log("Gmail integration tests passed.");
}

run().finally(async () => {
  const uploads = await prisma.temporaryUpload.findMany({ where: { ownerProfileId: { in: (await prisma.user.findMany({ where: { email: { contains: runId } }, select: { id: true } })).map((user) => user.id) } } });
  for (const upload of uploads) await deleteTemporaryUploadFile(upload);
  await prisma.temporaryUpload.deleteMany({ where: { id: { in: uploads.map((upload) => upload.id) } } });
  await prisma.document.deleteMany({ where: { ownerProfileId: { in: (await prisma.user.findMany({ where: { email: { contains: runId } }, select: { id: true } })).map((user) => user.id) } } });
  await prisma.user.deleteMany({ where: { email: { contains: runId } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error instanceof Error ? error.message : "Gmail tests failed."); process.exitCode = 1; });
