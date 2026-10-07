import { Prisma } from "@prisma/client";

type SummaryValue = string | number | boolean | null | string[];

const copiedKeys = [
  "accessInstruction",
  "assetType",
  "categoryCode",
  "currency",
  "direction",
  "followUpDone",
  "insuranceType",
  "loanType",
  "location",
  "nominee",
  "nomineeName",
  "policyNumber",
  "proofStatus",
  "provider",
  "recordKind",
  "subtype",
  "subtypeCode",
  "type",
] as const;

const amountKeys = ["amount", "value", "marketValue", "coverageAmount", "sumAssured", "premium", "principalAmount"] as const;
const partyKeys = ["party", "who", "paidTo", "receivedFrom"] as const;
const dateKeys = ["transactionDate", "date"] as const;

function isSummaryValue(value: unknown): value is SummaryValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null || Array.isArray(value);
}

function shouldKeep(value: SummaryValue) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value === true || typeof value === "number";
}

export function summaryDetails(details: Prisma.JsonValue) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const source = details as Record<string, unknown>;
  const summary: Record<string, SummaryValue> = {};
  copiedKeys.forEach((key) => {
    const value = source[key];
    if (isSummaryValue(value) && shouldKeep(value)) summary[key] = value;
  });
  const amount = amountKeys.map((key) => source[key]).find((value) => isSummaryValue(value) && shouldKeep(value));
  if (amount !== undefined && isSummaryValue(amount)) summary.amount = amount;
  const party = partyKeys.map((key) => source[key]).find((value) => isSummaryValue(value) && shouldKeep(value));
  if (party !== undefined && isSummaryValue(party)) summary.party = party;
  const transactionDate = dateKeys.map((key) => source[key]).find((value) => isSummaryValue(value) && shouldKeep(value));
  if (transactionDate !== undefined && isSummaryValue(transactionDate)) summary.transactionDate = transactionDate;
  return summary;
}
