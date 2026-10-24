import { WealthRecordType } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./adminAudit.service";
import { listWealthFormCategories } from "./wealthForm.service";

export class AdminWealthFormError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminWealthFormError";
    this.statusCode = statusCode;
  }
}

const MODULE = "WEALTH";
type AdminCtx = { adminId: string; actorEmail: string };

/** The customer-facing `wealthForm.service.ts` lazily seeds the DB tables
 * from a hardcoded catalog the first time any of its functions is called —
 * calling one here (ignoring the result) guarantees the admin view below is
 * never looking at an unseeded, empty table. Same seeding logic, not
 * duplicated. */
async function ensureSeeded() {
  await listWealthFormCategories();
}

export async function listCategoriesAdmin() {
  await ensureSeeded();
  return prisma.readinessFormCategory.findMany({
    where: { module: MODULE },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    include: { subtypes: { select: { id: true, isActive: true, _count: { select: { fields: true } } } } },
  });
}

export async function getCategoryTree(categoryId: string) {
  const category = await prisma.readinessFormCategory.findUnique({
    where: { id: categoryId },
    include: {
      subtypes: {
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        include: { fields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } },
      },
    },
  });
  if (!category || category.module !== MODULE) throw new AdminWealthFormError("Category not found.", 404);
  return category;
}

function slugify(label: string) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export async function updateCategory(ctx: AdminCtx, id: string, updates: {
  label?: string; description?: string | null; sortOrder?: number; isActive?: boolean; wealthRecordType?: WealthRecordType | null;
}, reason: string) {
  const before = await prisma.readinessFormCategory.findUnique({ where: { id } });
  if (!before || before.module !== MODULE) throw new AdminWealthFormError("Category not found.", 404);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.readinessFormCategory.update({ where: { id }, data: updates });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "wealth_form.category.update",
      targetType: "ReadinessFormCategory", targetId: id, reason, diff: { updates },
    });
    return updated;
  });
}

export async function createSubtype(ctx: AdminCtx, categoryId: string, input: { label: string; description?: string | null; sortOrder?: number }, reason: string) {
  const category = await prisma.readinessFormCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.module !== MODULE) throw new AdminWealthFormError("Category not found.", 404);
  const code = slugify(input.label);
  if (!code) throw new AdminWealthFormError("Label must contain at least one letter or number.", 400);
  const existing = await prisma.readinessFormSubtype.findUnique({ where: { categoryId_code: { categoryId, code } } });
  if (existing) throw new AdminWealthFormError(`A subtype with code "${code}" already exists in this category.`, 409);

  return prisma.$transaction(async (tx) => {
    const created = await tx.readinessFormSubtype.create({
      data: { categoryId, code, label: input.label, description: input.description ?? null, sortOrder: input.sortOrder ?? 0 },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "wealth_form.subtype.create",
      targetType: "ReadinessFormSubtype", targetId: created.id, reason, diff: { categoryId, code, label: input.label },
    });
    return created;
  });
}

export async function updateSubtype(ctx: AdminCtx, id: string, updates: {
  label?: string; description?: string | null; sortOrder?: number; isActive?: boolean;
}, reason: string) {
  const before = await prisma.readinessFormSubtype.findUnique({ where: { id }, include: { category: true } });
  if (!before || before.category.module !== MODULE) throw new AdminWealthFormError("Subtype not found.", 404);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.readinessFormSubtype.update({ where: { id }, data: updates });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "wealth_form.subtype.update",
      targetType: "ReadinessFormSubtype", targetId: id, reason, diff: { updates },
    });
    return updated;
  });
}

export async function createField(ctx: AdminCtx, subtypeId: string, input: {
  fieldId: string; label: string; inputType: string; required?: boolean; placeholder?: string | null;
  options?: unknown; group?: string | null; sortOrder?: number;
}, reason: string) {
  const subtype = await prisma.readinessFormSubtype.findUnique({ where: { id: subtypeId }, include: { category: true } });
  if (!subtype || subtype.category.module !== MODULE) throw new AdminWealthFormError("Subtype not found.", 404);
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(input.fieldId)) throw new AdminWealthFormError("Field ID must start with a letter and contain only letters/numbers (camelCase).", 400);
  const existing = await prisma.readinessFormField.findUnique({ where: { subtypeId_fieldId: { subtypeId, fieldId: input.fieldId } } });
  if (existing) throw new AdminWealthFormError(`A field with id "${input.fieldId}" already exists on this subtype.`, 409);

  return prisma.$transaction(async (tx) => {
    const created = await tx.readinessFormField.create({
      data: {
        subtypeId, fieldId: input.fieldId, label: input.label, inputType: input.inputType,
        required: input.required ?? false, placeholder: input.placeholder ?? null,
        options: input.options === undefined ? undefined : (input.options as object),
        group: input.group ?? null, sortOrder: input.sortOrder ?? 0,
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "wealth_form.field.create",
      targetType: "ReadinessFormField", targetId: created.id, reason, diff: { subtypeId, fieldId: input.fieldId, label: input.label },
    });
    return created;
  });
}

export async function updateField(ctx: AdminCtx, id: string, updates: {
  label?: string; inputType?: string; required?: boolean; placeholder?: string | null;
  group?: string | null; sortOrder?: number; isActive?: boolean;
}, reason: string) {
  const before = await prisma.readinessFormField.findUnique({ where: { id }, include: { subtype: { include: { category: true } } } });
  if (!before || before.subtype.category.module !== MODULE) throw new AdminWealthFormError("Field not found.", 404);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.readinessFormField.update({ where: { id }, data: updates });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "wealth_form.field.update",
      targetType: "ReadinessFormField", targetId: id, reason, diff: { updates },
    });
    return updated;
  });
}
