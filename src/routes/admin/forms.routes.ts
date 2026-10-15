import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp, requireWriteGrant } from "../../middleware/adminRbac";
import { documentDefinitions } from "../../services/ingestion/documentDefinitions.registry";
import type { DocumentDefinition } from "../../services/ingestion/documentDefinitions";
import {
  AdminWealthFormError,
  createField,
  createSubtype,
  getCategoryTree,
  listCategoriesAdmin,
  updateCategory,
  updateField,
  updateSubtype,
} from "../../services/adminWealthForms.service";

const router = Router();
router.use(requireAdminAuth, requireCapability("forms.edit"));

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

function handleError(error: unknown, next: (e?: unknown) => void, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (error instanceof AdminWealthFormError) return res.status(error.statusCode).json({ message: error.message });
  return next(error);
}

// --- Document-type registry (read-only) ---------------------------------
// Deliberately view-only: the design doc itself phases a versioned, editable
// registry as a later/optional step ("w" field: ["versioned DB table for the
// registry (optional)"]). This is a hardcoded code constant, not DB-backed —
// editing it here would mean editing source and redeploying anyway, so this
// surface just makes the 60+ entries browsable, nothing more.

function serializeDefinition(def: DocumentDefinition) {
  return {
    ...def,
    validationRules: Object.fromEntries(
      Object.entries(def.validationRules).map(([key, rule]) => [key, rule ? rule.toString() : null]),
    ),
  };
}

router.get("/document-types", (_req, res) => {
  const items = Object.values(documentDefinitions)
    .map(serializeDefinition)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return res.json({ items });
});

router.get("/document-types/:type", (req, res) => {
  const def = documentDefinitions[req.params.type];
  if (!def) return res.status(404).json({ message: "Document type not found in registry." });
  return res.json({ item: serializeDefinition(def) });
});

// --- Wealth form catalogue (DB-backed, self-seeding) ---------------------
// See adminWealthForms.service.ts for the seeding/scope notes. Scope for
// this pass: edit existing categories/subtypes/fields, create new subtypes
// and fields. Creating brand-new top-level categories is out of scope (see
// tracker) — rarer operation, needs a WealthRecordType enum decision.

router.get("/wealth/categories", async (_req, res, next) => {
  try {
    const categories = await listCategoriesAdmin();
    return res.json({ categories });
  } catch (error) {
    return next(error);
  }
});

router.get("/wealth/categories/:id", async (req, res, next) => {
  try {
    const category = await getCategoryTree(z.string().min(1).parse(req.params.id));
    return res.json({ category });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const reasonSchema = z.string().trim().min(3).max(500);

const categoryUpdateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  wealthRecordType: z.enum(["ASSET", "LOAN_TAKEN", "LOAN_GIVEN", "INSURANCE", "PAYMENT_PROOF"]).nullable().optional(),
  reason: reasonSchema,
});

router.patch("/wealth/categories/:id", requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const { reason, ...updates } = categoryUpdateSchema.parse(req.body);
    const category = await updateCategory(adminCtx(req as unknown as AdminAuthenticatedRequest), z.string().min(1).parse(req.params.id), updates, reason);
    return res.json({ category });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const subtypeCreateSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
  reason: reasonSchema,
});

router.post("/wealth/categories/:id/subtypes", requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const { reason, ...input } = subtypeCreateSchema.parse(req.body);
    const subtype = await createSubtype(adminCtx(req as unknown as AdminAuthenticatedRequest), z.string().min(1).parse(req.params.id), input, reason);
    return res.status(201).json({ subtype });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const subtypeUpdateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  reason: reasonSchema,
});

router.patch("/wealth/subtypes/:id", requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const { reason, ...updates } = subtypeUpdateSchema.parse(req.body);
    const subtype = await updateSubtype(adminCtx(req as unknown as AdminAuthenticatedRequest), z.string().min(1).parse(req.params.id), updates, reason);
    return res.json({ subtype });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const fieldCreateSchema = z.object({
  fieldId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  inputType: z.string().trim().min(1),
  required: z.boolean().optional(),
  placeholder: z.string().trim().min(1).nullable().optional(),
  options: z.unknown().optional(),
  group: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
  reason: reasonSchema,
});

router.post("/wealth/subtypes/:id/fields", requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const { reason, ...input } = fieldCreateSchema.parse(req.body);
    const field = await createField(adminCtx(req as unknown as AdminAuthenticatedRequest), z.string().min(1).parse(req.params.id), input, reason);
    return res.status(201).json({ field });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const fieldUpdateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  inputType: z.string().trim().min(1).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().trim().min(1).nullable().optional(),
  group: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  reason: reasonSchema,
});

router.patch("/wealth/fields/:id", requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const { reason, ...updates } = fieldUpdateSchema.parse(req.body);
    const field = await updateField(adminCtx(req as unknown as AdminAuthenticatedRequest), z.string().min(1).parse(req.params.id), updates, reason);
    return res.json({ field });
  } catch (error) {
    return handleError(error, next, res);
  }
});

export default router;
