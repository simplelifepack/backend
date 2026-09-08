import { withIsolatedPlaintextFile } from "../documentSecurityValidation";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { prisma } from "../../lib/prisma";
import { temporaryUploadsDir } from "../../middleware/upload";
import { createTemporaryUpload } from "../documentFileStorage";
import { ingestDocument } from "../ingestion/pipeline";
import { flattenParts, isSupportedGmailMime } from "./candidates";
import { authorizedGmail, type createOAuthClient } from "./oauth";
import { userScopedDocumentHash } from "../../utils/documentEncryption";

const MAX_SIZE = 25 * 1024 * 1024;
const extensionByMime: Record<string, string> = {
  "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "text/plain": ".txt",
};

function decode(data: string | null | undefined) {
  return Buffer.from(data ?? "", "base64url");
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '\"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyContent(message: Awaited<ReturnType<ReturnType<typeof createOAuthClient>["getTokenInfo"]>> | never): never {
  throw message;
}
void bodyContent;

function extractMessageBody(payload: import("googleapis").gmail_v1.Schema$MessagePart | undefined) {
  const parts = flattenParts(payload);
  const plain = parts.find((part) => part.mimeType === "text/plain" && part.body?.data);
  if (plain?.body?.data) return decode(plain.body.data);
  const html = parts.find((part) => part.mimeType === "text/html" && part.body?.data);
  if (html?.body?.data) {
    return Buffer.from(htmlToPlainText(decode(html.body.data).toString("utf8")), "utf8");
  }
  if (payload?.body?.data) return decode(payload.body.data);
  return Buffer.alloc(0);
}

function localAnalysisResponse(temporaryUpload: Awaited<ReturnType<typeof createTemporaryUpload>>, analysis: Awaited<ReturnType<typeof ingestDocument>>) {
  const category = analysis.suggestedCategory.charAt(0).toUpperCase() + analysis.suggestedCategory.slice(1);
  const fields = analysis.extractedFields as Record<string, unknown>;
  return {
    success: analysis.success,
    analysisSource: "rules" as const,
    analysis: {
      category, documentType: analysis.documentType,
      uniqueNumber: typeof fields.uniqueIdentifier === "string" ? fields.uniqueIdentifier : analysis.validation.uniqueIdentifier,
      nameOnDocument: typeof fields.name === "string" ? fields.name : null,
    },
    title: analysis.title, documentType: analysis.documentType,
    normalizedType: analysis.validation.normalizedType, confidence: analysis.confidence,
    suggestedCategory: analysis.suggestedCategory, extractedFields: analysis.extractedFields,
    reviewFields: analysis.reviewFields, validation: analysis.validation,
    extractedText: analysis.extractedText, preview: analysis.preview, warnings: analysis.warnings,
    extraction: analysis.extraction, reason: analysis.reason, tempFileId: temporaryUpload.id,
    file: { originalName: temporaryUpload.originalName, mimeType: temporaryUpload.detectedMimeType, size: temporaryUpload.size },
    extractedTextPreview: analysis.preview,
  };
}

function importFailureMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unable to import this Gmail document.";
}

function importFailureStatus(error: unknown) {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : undefined;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
  return { statusCode, code };
}

export async function importGmailCandidates(userId: string, candidateIds: string[], providedGmail?: import("googleapis").gmail_v1.Gmail) {
  const gmail = providedGmail ?? (await authorizedGmail(userId)).gmail;
  const candidates = await prisma.externalDocumentCandidate.findMany({
    where: { id: { in: candidateIds }, userId, provider: "gmail", status: { in: ["candidate", "needs_review", "pending_review"] } },
  });
  if (candidates.length !== new Set(candidateIds).size) throw Object.assign(new Error("One or more Gmail candidates are unavailable."), { statusCode: 404 });
  const results = [];
  for (const candidate of candidates) {
    let content: Buffer | undefined;
    try {
      if (!isSupportedGmailMime(candidate.mimeType)) throw Object.assign(new Error("Unsupported Gmail attachment type."), { statusCode: 400 });
      if (candidate.size > MAX_SIZE) throw Object.assign(new Error("Gmail attachment exceeds the 25 MB upload limit."), { statusCode: 413 });
      const message = await gmail.users.messages.get({ userId: "me", id: candidate.externalMessageId, format: "full" });
      if (candidate.externalAttachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me", messageId: candidate.externalMessageId, id: candidate.externalAttachmentId,
        });
        content = decode(attachment.data.data);
      } else if (candidate.externalPartId) {
        const selectedPart = flattenParts(message.data.payload).find((part) => part.partId === candidate.externalPartId);
        content = selectedPart?.body?.data ? decode(selectedPart.body.data) : extractMessageBody(message.data.payload);
      } else {
        content = extractMessageBody(message.data.payload);
      }
      if (!content.length || content.length > MAX_SIZE) throw Object.assign(new Error("Gmail document is empty or too large."), { statusCode: 400 });
      if (candidate.mimeType === "application/pdf" && content.includes(Buffer.from("/Encrypt"))) {
        throw Object.assign(new Error("This PDF is password protected. Enter the password to analyse it."), { statusCode: 422, code: "PASSWORD_PROTECTED_PDF" });
      }
      const contentHash = crypto.createHash("sha256").update(content).digest("hex");
      const duplicate = await prisma.document.findFirst({
        where: { ownerProfileId: userId, userScopedDedupHash: userScopedDocumentHash(userId, contentHash), deletedAt: null },
      });
      if (duplicate) {
        await prisma.externalDocumentCandidate.update({ where: { id: candidate.id }, data: { status: "imported", ignoredReason: null } });
        results.push({ candidateId: candidate.id, status: "already_imported", documentId: duplicate.id });
        continue;
      }
      const extension = extensionByMime[candidate.mimeType] ?? path.extname(candidate.filename);
      const filePath = path.join(temporaryUploadsDir, `${crypto.randomUUID()}${extension}`);
      await fsp.writeFile(filePath, content, { flag: "wx", mode: 0o600 });
      const upload = await createTemporaryUpload(userId, {
        path: filePath, originalname: candidate.filename, mimetype: candidate.mimeType, size: content.length,
      } as Express.Multer.File);
      const temporaryUpload = await prisma.temporaryUpload.update({
        where: { id: upload.id }, data: {
          contentHash, sourceProvider: "gmail", sourceMessageId: candidate.externalMessageId,
          sourceAttachmentId: candidate.externalAttachmentId, externalCandidateId: candidate.id,
        },
      });
      const analysis = await withIsolatedPlaintextFile(content, extension, plaintextPath => ingestDocument({
        path: plaintextPath, originalName: temporaryUpload.originalName,
        mimeType: temporaryUpload.detectedMimeType, size: temporaryUpload.size,
      }));
      await prisma.externalDocumentCandidate.update({ where: { id: candidate.id }, data: { status: "pending_review", ignoredReason: null } });
      results.push({ candidateId: candidate.id, status: "ready_for_review", analysis: localAnalysisResponse(temporaryUpload, analysis) });
    } catch (error) {
      const message = importFailureMessage(error);
      const { statusCode, code } = importFailureStatus(error);
      console.warn("[Gmail Import] candidate failed", {
        candidateId: candidate.id,
        filename: candidate.filename,
        mimeType: candidate.mimeType,
        statusCode,
        code,
        message,
      });
      await prisma.externalDocumentCandidate.update({
        where: { id: candidate.id },
        data: { status: "import_failed", ignoredReason: message },
      });
      results.push({ candidateId: candidate.id, status: "failed", message });
    } finally { content?.fill(0); }
  }
  return results;
}
