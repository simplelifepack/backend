import path from "node:path";
import type { gmail_v1 } from "googleapis";

export const GMAIL_RELEVANCE_THRESHOLDS = { relevant: 70, needsReview: 45 } as const;
const supportedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

const categoryTerms = {
  finance: [
    ["credit card statement", "Credit card statement"], ["loan account statement", "Loan statement"],
    ["loan statement", "Loan statement"], ["account statement", "Account statement"],
    ["bank statement", "Bank statement"], ["monthly statement", "Account statement"],
    ["e-statement", "Account statement"], ["paytm statement", "Payment statement"],
    ["transaction statement", "Transaction statement"], ["interest certificate", "Interest certificate"],
    ["deposit certificate", "Deposit certificate"], ["fixed deposit", "Fixed deposit document"],
    ["form 16", "Form 16"], ["payslip", "Payslip"], ["salary slip", "Salary slip"],
    ["mutual fund statement", "Mutual fund statement"], ["demat statement", "Demat statement"],
    ["cas statement", "CAS statement"],
  ],
  insurance: [
    ["certificate of insurance", "Insurance policy certificate"], ["policy certificate", "Insurance policy certificate"],
    ["insurance policy", "Insurance policy"], ["policy document", "Insurance policy"],
    ["policy schedule", "Insurance policy schedule"], ["health insurance", "Health insurance policy"],
    ["motor insurance", "Motor insurance policy"], ["vehicle insurance", "Vehicle insurance policy"],
    ["life insurance", "Life insurance policy"], ["term insurance", "Term insurance policy"],
    ["premium receipt", "Insurance premium receipt"], ["insurance e-card", "Insurance e-card"],
    ["health card", "Insurance health card"], ["claim settlement", "Insurance claim settlement"],
    ["claim document", "Insurance claim document"], ["renewal document", "Insurance renewal document"],
  ],
  medical: [
    ["pathology report", "Pathology report"], ["radiology report", "Radiology report"],
    ["diagnostic report", "Diagnostic report"], ["medical report", "Medical report"],
    ["lab report", "Lab report"], ["scan report", "Medical scan report"],
    ["blood test", "Blood test report"], ["prescription", "Prescription"],
    ["discharge summary", "Discharge summary"], ["hospital bill", "Hospital bill"],
    ["vaccination certificate", "Vaccination certificate"], ["health checkup report", "Health checkup report"],
  ],
} as const;

const institutionPatterns = {
  finance: /bank|paytm|hdfc|icici|axis|sbi|unionbank|kotak|federalbank|indusind|mutualfund|nsdl|cdsl/i,
  insurance: /insurance|uiic|licindia|policy|insurer|hdfclife|iciciprulife|starhealth/i,
  medical: /hospital|diagnostic|pathology|radiology|laborator|healthcare|clinic/i,
};
const decorativePattern = /(?:^|[_\-.])(logo|icon|banner|header|footer|signature|spacer|pixel|tracking|image00[12]|social)(?:[_\-.]|$)/i;
const marketingPattern = /\b(offer|cashback|discount|sale|limited time|apply now|buy now|upgrade now|congratulations|pre-approved offer|exclusive deal|coupon|rewards|marketing|newsletter)\b/i;
const unrelatedPattern = /bookmyshow|bms[_ -]?invoice|(?:^|[_ .-])ticket(?:[_ .-]|$)|tax invoice|shopping order|food delivery/i;

export const gmailSearchQueries = Object.entries(categoryTerms).map(([category, entries]) => ({
  category,
  query: `-in:spam -in:trash {${[...new Set(entries.map(([term]) => `"${term}"`))].join(" ")}} {has:attachment filename:pdf filename:jpg filename:jpeg filename:png}`,
}));

export type CandidateInput = {
  sourceKey: string; externalMessageId: string; externalAttachmentId: string | null; externalPartId: string | null;
  filename: string; mimeType: string; size: number; sender: string; subject: string; receivedAt: Date;
  suggestedCategory: string; suggestedDocumentType: string; relevanceReason: string; relevanceScore: number;
  legitimacyReason: string; legitimacyScore: number; reviewRequired: boolean; matchedSignals: string[];
  rejectedSignals: string[]; ignoredReason: string | null; status: "candidate" | "needs_review" | "ignored";
};

function header(part: gmail_v1.Schema$MessagePart | undefined, name: string) {
  return part?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function flattenParts(part: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}

function bestCategory(filename: string, subject: string, snippet: string, senderDomain: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[_-]+/g, " ").replace(/\bpa certificate\b/g, "policy certificate");
  const locations = [{ name: "filename", text: normalize(filename), points: 35 }, { name: "subject", text: normalize(subject), points: 30 }, { name: "message", text: normalize(snippet), points: 15 }];
  let best = { category: "other", type: "Document", score: 0, signals: [] as string[], strong: 0 };
  for (const [category, entries] of Object.entries(categoryTerms)) {
    let score = 0; let type = "Document"; let strong = 0; const signals: string[] = [];
    for (const location of locations) {
      const match = entries.find(([term]) => location.text.includes(term));
      if (match) { score += location.points; if (type === "Document") type = match[1]; signals.push(`${location.name}: ${match[0]}`); if (location.name !== "message") strong += 1; }
    }
    if (institutionPatterns[category as keyof typeof institutionPatterns].test(senderDomain)) {
      score += 20; signals.push(`institution domain: ${senderDomain}`);
    }
    if (score > best.score) best = { category, type, score, signals, strong };
  }
  return best;
}

function disposition(part: gmail_v1.Schema$MessagePart) {
  return header(part, "Content-Disposition").toLowerCase();
}

function fallbackName(messageId: string, part: gmail_v1.Schema$MessagePart) {
  const identity = part.partId || part.body?.attachmentId || "part";
  const extension = part.mimeType === "application/pdf" ? ".pdf" : part.mimeType === "image/png" ? ".png" : ".jpg";
  return `gmail-${messageId}-${identity.replace(/[^a-z0-9_-]/gi, "-")}${extension}`;
}

export function evaluatePart(message: gmail_v1.Schema$Message, part: gmail_v1.Schema$MessagePart, cidReferences = new Set<string>()): CandidateInput {
  const messageId = message.id!; const sender = header(message.payload, "From"); const replyTo = header(message.payload, "Reply-To");
  const subject = header(message.payload, "Subject") || "Gmail message"; const filename = part.filename?.trim() || fallbackName(messageId, part);
  const senderDomain = sender.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? "unknown sender"; const contentId = header(part, "Content-ID").replace(/[<>]/g, "").toLowerCase();
  const classification = bestCategory(filename, subject, message.snippet ?? "", senderDomain);
  const matchedSignals = [...classification.signals]; const rejectedSignals: string[] = [];
  const isInline = disposition(part).includes("inline") || Boolean(contentId && cidReferences.has(contentId));
  const decorative = decorativePattern.test(filename); const supported = supportedMimeTypes.has(part.mimeType ?? "");
  const marketing = marketingPattern.test(`${subject} ${message.snippet ?? ""}`);
  const unrelated = unrelatedPattern.test(`${sender} ${subject} ${filename}`) && classification.score < 30;
  if (isInline) rejectedSignals.push("inline email image");
  if (decorative) rejectedSignals.push("decorative asset filename");
  if (!supported) rejectedSignals.push("unsupported attachment");
  if (unrelated) rejectedSignals.push("unrelated entertainment or shopping document");
  if (marketing) rejectedSignals.push("promotional language");
  let relevanceScore = classification.score + (part.mimeType === "application/pdf" ? 10 : 0);
  if (classification.score === 20 && part.mimeType === "application/pdf") { relevanceScore += 15; matchedSignals.push("opaque PDF from institution domain"); }
  const strongEvidence = classification.strong >= 2 && classification.score >= 65;
  if (marketing) relevanceScore -= strongEvidence ? 15 : 35;
  if (message.labelIds?.includes("CATEGORY_PROMOTIONS")) { relevanceScore -= strongEvidence ? 5 : 20; rejectedSignals.push("Gmail promotions category"); }
  if (unrelated) relevanceScore -= 50;
  relevanceScore = Math.max(0, Math.min(100, relevanceScore));
  let legitimacyScore = senderDomain === "unknown sender" ? 10 : 45;
  if (classification.score >= 20) legitimacyScore += 25;
  if (replyTo && replyTo.toLowerCase().includes(senderDomain)) legitimacyScore += 10;
  if (header(message.payload, "List-Unsubscribe") || /bulk|list/i.test(header(message.payload, "Precedence"))) legitimacyScore -= 10;
  if (marketing) legitimacyScore -= 15;
  legitimacyScore = Math.max(0, Math.min(100, legitimacyScore));
  let ignoredReason: string | null = null;
  if (isInline || decorative) ignoredReason = "Inline email image";
  else if (!supported) ignoredReason = "Unsupported attachment";
  else if (unrelated) ignoredReason = "Unrelated invoice";
  else if (marketing && !strongEvidence) ignoredReason = "Promotional email";
  else if (relevanceScore < GMAIL_RELEVANCE_THRESHOLDS.needsReview) ignoredReason = "Insufficient document evidence";
  const status = ignoredReason ? "ignored" : relevanceScore >= GMAIL_RELEVANCE_THRESHOLDS.relevant ? "candidate" : "needs_review";
  const relevanceReason = matchedSignals.length ? `Document relevance: ${matchedSignals.slice(0, 3).join("; ")}` : "Insufficient document evidence";
  const legitimacyReason = legitimacyScore >= 70 ? "Likely legitimate institution email" : legitimacyScore >= 45 ? "Document relevance confirmed; sender needs review" : "Needs review";
  const partIdentity = part.body?.attachmentId || part.partId || "body";
  return {
    sourceKey: `${messageId}:${partIdentity}`, externalMessageId: messageId,
    externalAttachmentId: part.body?.attachmentId ?? null, externalPartId: part.partId ?? null,
    filename, mimeType: part.mimeType ?? "application/octet-stream", size: Number(part.body?.size ?? 0), sender, subject,
    receivedAt: new Date(Number(message.internalDate || Date.now())), suggestedCategory: classification.category,
    suggestedDocumentType: classification.type, relevanceReason, relevanceScore, legitimacyReason, legitimacyScore,
    reviewRequired: status === "needs_review", matchedSignals, rejectedSignals, ignoredReason, status,
  };
}

export function candidatesFromMessage(message: gmail_v1.Schema$Message): CandidateInput[] {
  if (!message.id) return [];
  const parts = flattenParts(message.payload);
  const html = parts.filter((part) => part.mimeType === "text/html" && part.body?.data).map((part) => Buffer.from(part.body!.data!, "base64url").toString("utf8")).join(" ");
  const cidReferences = new Set([...html.matchAll(/cid:([^"'\s>]+)/gi)].map((match) => match[1].toLowerCase()));
  return parts.filter((part) => Boolean(part.body?.attachmentId || part.filename || part.mimeType === "application/pdf" || part.mimeType?.startsWith("image/"))).map((part) => evaluatePart(message, part, cidReferences));
}

export function isSupportedGmailMime(mimeType: string) {
  return supportedMimeTypes.has(mimeType) || mimeType === "text/plain";
}

export function fileExtension(filename: string) { return path.extname(filename).toLowerCase(); }
