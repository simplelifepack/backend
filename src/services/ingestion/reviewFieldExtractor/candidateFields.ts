import type { DocumentAnalysis } from "../../rules/types";
import type { ReviewField } from "../types";
const datePattern = /\b(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;
const amountPattern = /(?:rs\.?|inr|₹)\s*[0-9,]+(?:\.\d{1,2})?/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g;
const panPattern = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const aadhaarPattern = /\b(?:\d{4}\s?\d{4}\s?\d{4}|[xX]{4}\s?[xX]{4}\s?\d{4})\b/g;
const ifscPattern = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const labelAliases = new Map<string, string>([
  ["a/c no", "Account number"], ["acct no", "Account number"],
  ["account no", "Account number"], ["account number", "Account number"],
  ["amount due", "Amount due"], ["bill no", "Bill number"],
  ["consumer no", "Consumer number"], ["dob", "Date of birth"],
  ["d.o.b", "Date of birth"], ["date of birth", "Date of birth"],
  ["dl no", "Licence number"], ["dl number", "Licence number"],
  ["email", "Email"], ["employee id", "Employee ID"],
  ["epic no", "EPIC number"], ["father name", "Father's name"],
  ["father's name", "Father's name"], ["ifsc", "IFSC"],
  ["mobile", "Mobile number"], ["mob", "Mobile number"],
  ["name", "Name"], ["pan", "PAN number"],
  ["pan number", "PAN number"], ["permanent account number", "PAN number"],
  ["phone", "Phone number"], ["policy no", "Policy number"],
  ["policy number", "Policy number"], ["valid till", "Valid until"],
  ["valid until", "Valid until"],
]);
const fieldLabels = new Map<string, string>([
  ["aadhaarLast4", "Aadhaar last 4 digits"],
  ["accountNumberMasked", "Account number"],
  ["amount", "Amount"],
  ["date", "Date"],
  ["dateOfExpiry", "Date of expiry"],
  ["dateOfIssue", "Date of issue"],
  ["dob", "Date of birth"],
  ["epicNumber", "EPIC number"],
  ["fatherName", "Father's name"],
  ["gender", "Gender"],
  ["ifsc", "IFSC"],
  ["licenseNumber", "Licence number"],
  ["name", "Full name"],
  ["nationality", "Nationality"],
  ["panNumber", "PAN number"],
  ["passportNumber", "Passport number"],
  ["placeOfBirth", "Place of birth"],
  ["validTill", "Valid until"],
  ["vehicleClass", "Vehicle class"],
  ["yearOfBirth", "Year of birth"],
]);
const templateImportantKeys = new Set([
  "aadhaarLast4", "accountNumberMasked", "dob", "epicNumber", "fatherName",
  "ifsc", "licenseNumber", "name", "panNumber", "passportNumber",
  "policyNumber",
]);
export function toTitleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
function normalizeLabel(label: string) {
  const key = label.toLowerCase().replace(/[._]/g, "").replace(/\s+/g, " ").trim();
  return labelAliases.get(key) ?? toTitleCase(label);
}
function normalizeKey(label: string) {
  const words = normalizeLabel(label).replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/);
  const [first = "detail", ...rest] = words;
  return `${first.toLowerCase()}${rest.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`).join("")}`;
}
function cleanValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value).replace(/\s+/g, " ").trim();
}
function makeField(
  input: Omit<ReviewField, "id" | "editable"> & { editable?: boolean },
): ReviewField {
  const key = input.key || normalizeKey(input.label);
  return { id: key, editable: true, ...input, key };
}
export function addField(
  fields: ReviewField[],
  seen: Set<string>,
  field: ReviewField,
) {
  const value = cleanValue(field.value);
  if (!value || value.length < 2) return;
  const fingerprint = `${field.key.toLowerCase()}::${value.toLowerCase()}`;
  const valueOnly = value.toLowerCase();
  if (seen.has(fingerprint) || seen.has(valueOnly)) return;
  seen.add(fingerprint);
  seen.add(valueOnly);
  fields.push({ ...field, id: field.id || `${field.key}-${fields.length + 1}`, value });
}
function extractTemplateFields(analysis: DocumentAnalysis) {
  return Object.entries(analysis.fields).flatMap(([key, value]) => {
    const cleaned = cleanValue(value);
    if (!cleaned) return [];
    return [
      makeField({
        key,
        label: fieldLabels.get(key) ?? toTitleCase(key),
        value: cleaned,
        confidence: Math.max(analysis.confidence - 5, 40),
        source: "rule",
        important: templateImportantKeys.has(key),
      }),
    ];
  });
}
function isNoisyLine(line: string) {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 140) return true;
  if (/^[-_=*#.\s]+$/.test(trimmed)) return true;
  if (/^(?:page\s*)?\d+\s*(?:of\s*\d+)?$/i.test(trimmed)) return true;
  return (trimmed.match(/[A-Za-z0-9]/g)?.length ?? 0) < 3;
}
function extractGenericKeyValues(text: string) {
  const fields: ReviewField[] = [];
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const keyValuePattern = /^([A-Za-z][A-Za-z0-9\s./'()]{1,45})\s*[:=\-–—]\s*(.{2,120})$/;
  for (const line of lines) {
    const match = line.match(keyValuePattern);
    if (!match?.[1] || !match[2]) continue;
    const rawLabel = match[1].trim();
    const value = match[2].trim();
    if (isNoisyLine(value)) continue;
    const label = normalizeLabel(rawLabel);
    fields.push(
      makeField({
        key: normalizeKey(label),
        label,
        value,
        confidence: 70,
        source: "generic",
        important: /name|number|date|dob|amount|account|policy|valid|ifsc|email|phone/i.test(label),
      }),
    );
  }
  return fields;
}
function extractPatternFields(text: string) {
  const fields: ReviewField[] = [];
  const patterns: Array<{ key: string; label: string; pattern: RegExp; important?: boolean }> = [
    { key: "panNumber", label: "PAN number", pattern: panPattern, important: true },
    { key: "aadhaarNumber", label: "Aadhaar number", pattern: aadhaarPattern, important: true },
    { key: "ifsc", label: "IFSC", pattern: ifscPattern, important: true },
    { key: "email", label: "Email", pattern: emailPattern, important: true },
    { key: "phone", label: "Phone number", pattern: phonePattern, important: true },
    { key: "dateFound", label: "Date found", pattern: datePattern },
    { key: "amountFound", label: "Amount found", pattern: amountPattern, important: true },
  ];
  for (const item of patterns) {
    const matches = [...text.matchAll(item.pattern)].slice(0, 4);
    matches.forEach((match, index) => {
      if (!match[0]) return;
      fields.push(
        makeField({
          key: index ? `${item.key}${index + 1}` : item.key,
          label: item.label,
          value: match[0],
          confidence: 65,
          source: "generic",
          important: item.important,
        }),
      );
    });
  }
  return fields;
}
function looksLikeName(line: string) {
  return /^[A-Z][A-Z .'-]{3,60}$/i.test(line) && !/(AADHAAR|CARD|DEPARTMENT|GOVT|GOVERNMENT|INDIA|NUMBER|SIGNATURE|UIDAI|AUTHORITY)$/i.test(line);
}
function importantLineLabel(line: string) {
  if (emailPattern.test(line)) return "Email";
  emailPattern.lastIndex = 0;
  if (phonePattern.test(line)) return "Phone number";
  phonePattern.lastIndex = 0;
  if (amountPattern.test(line)) return "Amount found";
  amountPattern.lastIndex = 0;
  if (datePattern.test(line)) return "Date found";
  datePattern.lastIndex = 0;
  if (looksLikeName(line)) return "Possible name";
  if (/(department|authority|bank|hospital|university|school|insurance|limited|ltd|pvt|govt|government)/i.test(line)) return "Organization";
  return /(number|no\.?|account|policy|passport|licen[cs]e|epic|consumer|bill|valid|address)/i.test(line)
    ? "Important detail"
    : "Important detail";
}
function extractImportantLines(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isNoisyLine(line));
  const scored = lines
    .map((line, index) => {
      let score = 0;
      if (looksLikeName(line)) score += 4;
      if (datePattern.test(line)) score += 3;
      datePattern.lastIndex = 0;
      if (amountPattern.test(line)) score += 3;
      amountPattern.lastIndex = 0;
      if (emailPattern.test(line) || phonePattern.test(line)) score += 4;
      emailPattern.lastIndex = 0;
      phonePattern.lastIndex = 0;
      if (/(number|account|policy|passport|licen[cs]e|epic|consumer|valid|address|department|authority|bank|hospital|university)/i.test(line)) score += 2;
      if (line.length >= 8 && line.length <= 80) score += 1;
      return { line, index, score };
    })
    .filter((item) => item.score >= 2)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 12);
  return scored.map((item, index) =>
    makeField({
      key: `${normalizeKey(importantLineLabel(item.line))}${index + 1}`,
      label: importantLineLabel(item.line),
      value: item.line,
      confidence: Math.min(80, 45 + item.score * 5),
      source: "generic",
      important: item.score >= 4,
    }),
  );
}
function extractPanFallback(text: string) {
  if (!/permanent account number|income tax department|\bPAN\b/i.test(text)) return [];
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isNoisyLine(line));
  const candidateNames = lines.filter(looksLikeName);
  const afterPermanentAccount = lines.find((line, index) =>
    /permanent account number/i.test(lines[index - 1] ?? "") && /^[A-Z0-9]{8,12}$/.test(line.replace(/\s/g, "")),
  );
  const loosePan = text.match(/\b[A-Z0-9]{9,10}\b/)?.[0];
  const fields = [];
  if (candidateNames[0]) fields.push(makeField({ key: "fullName", label: "Full name", value: candidateNames[0], confidence: 80, source: "rule", important: true }));
  if (candidateNames[1]) fields.push(makeField({ key: "fatherName", label: "Father's name", value: candidateNames[1], confidence: 70, source: "rule", important: true }));
  if (afterPermanentAccount || loosePan) fields.push(makeField({ key: "panNumber", label: "PAN number", value: afterPermanentAccount ?? loosePan ?? "", confidence: 65, source: "rule", important: true }));
  return fields;
}
export function collectReviewFieldCandidates(analysis: DocumentAnalysis, text: string) {
  return [
    ...extractTemplateFields(analysis),
    ...extractPanFallback(text),
    ...extractGenericKeyValues(text),
    ...extractPatternFields(text),
    ...extractImportantLines(text),
  ];
}
