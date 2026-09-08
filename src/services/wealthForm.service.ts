import { Prisma, WealthRecordType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { createWealthRecord } from "./wealthRecords.service";

const moduleCode = "WEALTH";
let formTablesAvailable: boolean | null = null;

type FieldSeed = {
  fieldId: string;
  label: string;
  inputType: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: Prisma.InputJsonValue;
  options?: Prisma.InputJsonValue;
  validation?: Prisma.InputJsonValue;
  group?: string;
  sortOrder: number;
};

type FormDelegates = {
  readinessFormCategory?: typeof prisma.readinessFormCategory;
  readinessFormSubtype?: typeof prisma.readinessFormSubtype;
  readinessFormField?: typeof prisma.readinessFormField;
};

const commonFields: FieldSeed[] = [
  { fieldId: "attachmentDocumentIds", label: "Attach documents", inputType: "file", group: "Proof", sortOrder: 900 },
  { fieldId: "notes", label: "Notes", inputType: "textarea", group: "Notes", sortOrder: 910 },
  { fieldId: "followUpDate", label: "Follow-up date", inputType: "date", group: "Follow-up", sortOrder: 920 },
  { fieldId: "followUpNote", label: "Follow-up note", inputType: "textarea", group: "Follow-up", sortOrder: 930 },
];

const catalog = [
  { code: "asset", label: "Asset", type: "ASSET" as WealthRecordType, subtypes: ["Property", "Savings Account", "Fixed Deposit", "PF", "EPF", "PPF", "NPS", "Mutual Fund", "Stocks", "Gold", "Bank Locker", "Vehicle", "Other"] },
  { code: "loan", label: "Loan", type: "LOAN_TAKEN" as WealthRecordType, subtypes: ["Personal Loan", "Home Loan", "Vehicle Loan", "Education Loan", "Business Loan", "Loan Given", "Other"] },
  { code: "insurance", label: "Insurance", type: "INSURANCE" as WealthRecordType, subtypes: ["Life Insurance", "Health Insurance", "Vehicle Insurance", "Property Insurance", "Crop Insurance", "Other"] },
  { code: "payment_proof", label: "Payment / Proof", type: "PAYMENT_PROOF" as WealthRecordType, subtypes: ["Receipt", "Bank Transfer", "UPI Payment", "Cash Payment", "Tax Payment", "Other"] },
  { code: "other", label: "Other", type: "PAYMENT_PROOF" as WealthRecordType, subtypes: ["General Record"] },
];

function categorySeed(code: string) {
  return catalog.find((category) => category.code === code);
}

function subtypeCode(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function catalogCategories() {
  return catalog.map(({ code, label }) => ({ code, label, description: null }));
}

function catalogSubtypes(categoryCode: string) {
  const category = categorySeed(categoryCode);
  if (!category) throw Object.assign(new Error("Unknown Wealth category."), { statusCode: 404 });
  return category.subtypes.map((label) => ({ code: subtypeCode(label), label, description: null }));
}

function fieldsFor(category: string): FieldSeed[] {
  const core: FieldSeed[] = [
    { fieldId: "institution", label: "Person or institution", inputType: "text", placeholder: "Name, bank, provider, or organization", group: "Details", sortOrder: 10 },
    { fieldId: "referenceNumber", label: "Reference / account / policy number", inputType: "text", group: "Details", sortOrder: 20 },
    { fieldId: "location", label: "Location / details", inputType: "text", group: "Details", sortOrder: 30 },
  ];
  if (category === "asset") return [...core, { fieldId: "nominee", label: "Nominee", inputType: "text", group: "Access", sortOrder: 40 }, { fieldId: "accessInstruction", label: "Access instruction", inputType: "textarea", group: "Access", sortOrder: 50 }, ...commonFields];
  if (category === "loan") return [
    { fieldId: "principalAmount", label: "Principal amount", inputType: "number", required: true, group: "Loan", sortOrder: 5 },
    ...core,
    { fieldId: "startDate", label: "Loan start date", inputType: "date", group: "Loan", sortOrder: 40 },
    { fieldId: "durationMonths", label: "Timeline / maturity period in months", inputType: "number", group: "Loan", sortOrder: 50 },
    { fieldId: "interestRate", label: "Interest rate %", inputType: "number", group: "Loan", sortOrder: 60 },
    { fieldId: "interestFrequency", label: "Interest frequency", inputType: "select", options: ["monthly", "yearly"], group: "Loan", sortOrder: 70 },
    { fieldId: "interestCalculationType", label: "Interest calculation", inputType: "select", options: ["simple", "reducing", "compound", "flat", "no-interest"], group: "Loan", sortOrder: 80 },
    { fieldId: "paymentsMade", label: "Payments made", inputType: "number", group: "Loan", sortOrder: 90 },
    ...commonFields,
  ];
  if (category === "insurance") return [...core, { fieldId: "premiumFrequency", label: "Premium frequency", inputType: "select", options: ["Monthly", "Quarterly", "Yearly", "One-time"], group: "Policy", sortOrder: 40 }, { fieldId: "renewalDate", label: "Renewal date", inputType: "date", group: "Policy", sortOrder: 50 }, { fieldId: "nominee", label: "Nominee", inputType: "text", group: "Policy", sortOrder: 60 }, ...commonFields];
  return [...core, ...commonFields];
}

async function ensureWealthCatalog() {
  const delegates = prisma as FormDelegates;
  if (!delegates.readinessFormCategory) return false;
  if (formTablesAvailable === null) {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass('public.readiness_form_categories') IS NOT NULL AS "exists"`;
    formTablesAvailable = Boolean(rows[0]?.exists);
  }
  if (!formTablesAvailable) return false;
  const existing = await delegates.readinessFormCategory.count({ where: { module: moduleCode } });
  if (existing) return true;
  for (const [categoryIndex, category] of catalog.entries()) {
    const savedCategory = await delegates.readinessFormCategory.create({
      data: { module: moduleCode, code: category.code, label: category.label, wealthRecordType: category.type, sortOrder: categoryIndex + 1 },
    });
    for (const [subtypeIndex, label] of category.subtypes.entries()) {
      const subtype = await delegates.readinessFormSubtype!.create({
        data: { categoryId: savedCategory.id, code: subtypeCode(label), label, sortOrder: subtypeIndex + 1 },
      });
      await delegates.readinessFormField!.createMany({ data: fieldsFor(category.code).map((field) => ({ ...field, subtypeId: subtype.id })) });
    }
  }
  return true;
}

function fieldDto(field: { fieldId: string; label: string; inputType: string; required: boolean; placeholder: string | null; defaultValue: unknown; options: unknown; validation: unknown; group: string | null; visibility: unknown; sortOrder: number }) {
  return { id: field.fieldId, label: field.label, inputType: field.inputType, required: field.required, placeholder: field.placeholder, defaultValue: field.defaultValue, options: field.options, validation: field.validation, group: field.group, visibility: field.visibility, order: field.sortOrder };
}

export async function listWealthFormCategories() {
  try {
    if (!await ensureWealthCatalog()) return catalogCategories();
    return prisma.readinessFormCategory.findMany({ where: { module: moduleCode, isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { code: true, label: true, description: true } });
  } catch {
    return catalogCategories();
  }
}

export async function listWealthFormSubtypes(categoryCode: string) {
  try {
    if (!await ensureWealthCatalog()) return catalogSubtypes(categoryCode);
    const category = await prisma.readinessFormCategory.findUnique({ where: { module_code: { module: moduleCode, code: categoryCode } } });
    if (!category?.isActive) throw Object.assign(new Error("Unknown Wealth category."), { statusCode: 404 });
    return prisma.readinessFormSubtype.findMany({ where: { categoryId: category.id, isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { code: true, label: true, description: true } });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) throw error;
    return catalogSubtypes(categoryCode);
  }
}

export async function getWealthFormSchema(categoryCode: string, subtypeCode: string) {
  try {
    if (!await ensureWealthCatalog()) return catalogSchema(categoryCode, subtypeCode);
    const category = await prisma.readinessFormCategory.findUnique({ where: { module_code: { module: moduleCode, code: categoryCode } } });
    if (!category?.isActive) throw Object.assign(new Error("Unknown Wealth category."), { statusCode: 404 });
    const subtype = await prisma.readinessFormSubtype.findUnique({ where: { categoryId_code: { categoryId: category.id, code: subtypeCode } }, include: { fields: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } });
    if (!subtype?.isActive) throw Object.assign(new Error("Unknown Wealth subtype."), { statusCode: 404 });
    return { category: { code: category.code, label: category.label }, subtype: { code: subtype.code, label: subtype.label }, fields: subtype.fields.map(fieldDto) };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) throw error;
    return catalogSchema(categoryCode, subtypeCode);
  }
}

function catalogSchema(categoryCode: string, subtype: string) {
  const category = categorySeed(categoryCode);
  const subtypeItem = catalogSubtypes(categoryCode).find((item) => item.code === subtype);
  if (!category || !subtypeItem) throw Object.assign(new Error("Unknown Wealth subtype."), { statusCode: 404 });
  return { category: { code: category.code, label: category.label }, subtype: { code: subtypeItem.code, label: subtypeItem.label }, fields: fieldsFor(category.code).map((field) => fieldDto({ ...field, required: field.required ?? false, placeholder: field.placeholder ?? null, defaultValue: field.defaultValue ?? null, options: field.options ?? null, validation: field.validation ?? null, group: field.group ?? null, visibility: null })) };
}

const submitSchema = z.object({
  categoryCode: z.string().trim().min(1),
  subtypeCode: z.string().trim().min(1),
  values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])),
}).strict();

export async function createWealthRecordFromForm(userId: string, input: unknown) {
  const data = submitSchema.parse(input);
  const schema = await getWealthFormSchema(data.categoryCode, data.subtypeCode);
  const required = schema.fields.filter((field) => field.required && !data.values[field.id]);
  if (required.length) throw Object.assign(new Error(`Missing required fields: ${required.map((field) => field.label).join(", ")}`), { statusCode: 400 });
  const category = categorySeed(data.categoryCode);
  const attachments = Array.isArray(data.values.attachmentDocumentIds) ? data.values.attachmentDocumentIds.filter((id): id is string => typeof id === "string") : [];
  const details = {
    ...data.values,
    principalAmount: data.categoryCode === "loan" ? data.values.principalAmount || data.values.amount : data.values.principalAmount,
    categoryCode: data.categoryCode,
    categoryLabel: schema.category.label,
    subtypeCode: data.subtypeCode,
    subtypeLabel: schema.subtype.label,
  };
  return createWealthRecord(userId, {
    type: category?.type ?? "PAYMENT_PROOF",
    title: String(data.values.title || schema.subtype.label),
    details,
    notes: typeof data.values.notes === "string" ? data.values.notes : undefined,
    followUpDate: typeof data.values.followUpDate === "string" ? data.values.followUpDate : null,
    followUpNote: typeof data.values.followUpNote === "string" ? data.values.followUpNote : undefined,
    attachmentDocumentIds: attachments,
  });
}
