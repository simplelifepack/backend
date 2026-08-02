import {
  createRule,
  extractAadhaarLast4,
  extractNameNearLabel,
  extractPanNumber,
  extractPassportNumber,
  extractValueAfterLabel,
} from "./helpers";
import { genericRules } from "./genericRules";
import type { DocumentRule, WeightedSignal } from "./types";

const signal = (label: string, pattern: RegExp, points: number, strong = false): WeightedSignal => ({
  label,
  pattern,
  points,
  strong,
});

function extractPassportMrzFields(text: string) {
  const compactLines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9<]/g, ""))
    .filter(Boolean);
  const nameLine = compactLines
    .map((line) => {
      const start = line.indexOf("P<IND");
      return start >= 0 ? line.slice(start) : line;
    })
    .find((line) => /^P<+[A-Z]{3}/.test(line));
  const dataLine = compactLines.find((line) => line.includes("<") && /[A-Z][$S5]?[0-9]{7}<.*IND/.test(line));
  const rawMrzPassport = text.match(/([A-Z])[^A-Z0-9]{0,2}([0-9]{7})<[^A-Z0-9]{0,2}[0-9A-Z]?IND/i);
  const passportNumber =
    rawMrzPassport
      ? `${rawMrzPassport[1].toUpperCase()}${rawMrzPassport[2]}`
      : dataLine
      ?.match(/[A-Z][$S5]?[0-9]{7}/)?.[0]
      ?.replace(/[$S5](?=[0-9]{7}$)/, "") ?? extractPassportNumber(text);
  let holderName: string | undefined;

  if (nameLine) {
    const namePart = nameLine.replace(/^P<+[A-Z]{3}/, "");
    const [surname, givenNames] = namePart.split("<<");
    const parts = [givenNames, surname]
      .filter(Boolean)
      .flatMap((part) => part.split("<"))
      .map((part) => part.replace(/[^A-Z]/g, ""))
      .map((part) => (part.endsWith("S") && part.length > 5 ? part.slice(0, -1) : part))
      .filter((part) => part.length >= 2 && part.length <= 18 && part !== "INDM" && !/^(.)\1{2,}/.test(part) && !/[CL]{5,}/.test(part));
    if (parts.length) {
      holderName = parts
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join(" ");
    }
  }

  return { passportNumber, holderName };
}

export const rules: DocumentRule[] = [
  createRule({
    documentType: "aadhaar",
    category: "identity",
    positives: [
      signal("aadhaar", /\baadhaar\b/i, 35, true),
      signal("uidai", /\buidai\b/i, 35, true),
      signal("unique identification authority of india", /unique identification authority of india/i, 40, true),
      signal("government of india", /government of india/i, 10),
      signal("aadhaar number", /\b\d{4}\s?\d{4}\s?\d{4}\b/i, 30, true),
      signal("masked aadhaar", /\b[xX]{4}\s?[xX]{4}\s?\d{4}\b/i, 20, true),
      signal("dob", /\b(?:year of birth|dob)\b/i, 10),
      signal("gender", /\b(?:male|female)\b/i, 5),
    ],
    negatives: [
      signal("income tax department", /income tax department/i, 50),
      signal("permanent account number", /permanent account number/i, 50),
      signal("passport mrz", /<{6,}/i, 40),
    ],
    extractFields: (text) => ({
      name: extractNameNearLabel(text, ["name"]),
      dob: extractValueAfterLabel(text, ["dob", "date of birth"]),
      yearOfBirth: extractValueAfterLabel(text, ["year of birth", "yob"]),
      gender: text.match(/\b(?:male|female)\b/i)?.[0],
      aadhaarLast4: extractAadhaarLast4(text),
    }),
  }),
  createRule({
    documentType: "pan",
    category: "identity",
    positives: [
      signal("income tax department", /income tax department/i, 45, true),
      signal("permanent account number", /permanent account number/i, 45, true),
      signal("PAN word", /\bPAN\b/i, 15),
      signal("PAN number", /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i, 45, true),
      signal("father name", /father'?s? name/i, 10),
    ],
    negatives: [
      signal("uidai", /\buidai\b/i, 50),
      signal("unique identification authority", /unique identification authority/i, 50),
      signal("aadhaar", /\baadhaar\b/i, 40),
    ],
    extractFields: (text) => ({
      panNumber: extractPanNumber(text),
      name: extractNameNearLabel(text, ["name"]),
      fatherName: extractNameNearLabel(text, ["father's name", "father name"]),
      dob: extractValueAfterLabel(text, ["dob", "date of birth"]),
    }),
  }),
  createRule({
    documentType: "passport",
    category: "identity",
    positives: [
      signal("passportHeading", /\b(?:passport|republic of india)\b/i, 20),
      signal("passportNumber", /\b[A-Z][0-9]{7}\b/i, 25, true),
      signal("mrzDetected", /P<+[A-Z]{3}|[A-Z][0-9]{7}[A-Z0-9<]*IND[0-9]{6,}|<{6,}/i, 30, true),
      signal("expiryDate", /(?:date of expiry|expiry date|expires?)\s*[:\-]?\s*\d/i, 10),
      signal("nationality", /\bnationality\b/i, 5),
      signal("dateOfBirth", /(?:date of birth|dob)\s*[:\-]?\s*\d/i, 5),
      signal("holderName", /\b(?:surname|given names?|name)\s*[:\-]\s*[A-Z]/i, 5),
    ],
    negatives: [signal("uidai", /\buidai\b/i, 40), signal("income tax department", /income tax department/i, 40)],
    extractFields: (text) => {
      const mrz = extractPassportMrzFields(text);
      const holderName = extractNameNearLabel(text, ["given name", "name", "surname"]) ?? mrz.holderName;

      return {
        passportNumber: mrz.passportNumber,
        holderName,
        name: holderName,
        nationality: extractValueAfterLabel(text, ["nationality"]),
        dob: extractValueAfterLabel(text, ["date of birth", "dob"]),
        placeOfBirth: extractValueAfterLabel(text, ["place of birth"]),
        dateOfIssue: extractValueAfterLabel(text, ["date of issue"]),
        dateOfExpiry: extractValueAfterLabel(text, ["date of expiry"]),
      };
    },
  }),
  createRule({
    documentType: "driving_license",
    category: "identity",
    positives: [
      signal("indian union driving licence", /indian union driving licen[cs]e/i, 65, true),
      signal("driving licence", /driving licen[cs]e/i, 55, true),
      signal("licence", /\blicen[cs]e\b/i, 30, true),
      signal("licensing authority", /licen[cs]ing authority/i, 35, true),
      signal("dl number", /\bdl (?:no|number)\b/i, 35, true),
      signal("telangana state", /telangana state/i, 45, true),
      signal("telangana", /\btelangana\b/i, 25),
      signal("rta", /\brta\b/i, 35, true),
      signal("licence number", /\b[A-Z]{2}[0-9]{2,}[0-9A-Z]{8,}\b/i, 45, true),
      signal("transport", /\btransport\b/i, 10),
      signal("non transport", /non transport/i, 10),
      signal("lmv", /\blmv\b/i, 15),
      signal("mcwg", /\bmcwg\b/i, 15),
      signal("valid till", /valid till/i, 15),
      signal("rto", /\brto\b/i, 15),
    ],
    extractFields: (text) => ({
      licenseNumber:
        text.match(/\b[A-Z]{2}[0-9]{2,}[0-9A-Z]{8,}\b/i)?.[0]?.toUpperCase() ??
        extractValueAfterLabel(text, ["dl no", "dl number", "license number", "licence number"]),
      name: extractNameNearLabel(text, ["name"]),
      dob: extractValueAfterLabel(text, ["dob", "date of birth"]),
      validTill: extractValueAfterLabel(text, ["valid till"]),
      vehicleClass: text.match(/\b(?:LMV|MCWG|HMV)\b/i)?.[0],
      state: /telangana/i.test(text) || /\bTS[0-9]{2,}[0-9A-Z]{8,}\b/i.test(text) ? "Telangana" : undefined,
      issuingAuthority:
        text.match(/\bRTA\s+[A-Z][A-Z\s]{2,30}\b/i)?.[0]?.replace(/\s+/g, " ").trim() ??
        (/\brta\b/i.test(text) ? "RTA" : undefined),
    }),
  }),
  createRule({
    documentType: "voter_id",
    category: "identity",
    positives: [
      signal("election commission of india", /election commission of india/i, 45, true),
      signal("elector photo identity card", /elector photo identity card/i, 45, true),
      signal("voter id", /voter id/i, 30),
      signal("epic number", /epic (?:no|number)/i, 35, true),
    ],
    extractFields: (text) => ({ epicNumber: extractValueAfterLabel(text, ["epic no", "epic number"]), name: extractNameNearLabel(text, ["name"]) }),
  }),
  ...genericRules,
];
