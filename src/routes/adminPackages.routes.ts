import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { requireFreshAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import {
  PACKAGES_ADMIN_EMAIL,
  createAdminPackage,
  csvTemplate,
  deleteAdminPackage,
  getAdminPackage,
  importCsv,
  listAdminPackages,
  packageAdminInputSchema,
  previewCsvWithDatabase,
  updateAdminPackage,
} from "../services/adminPackages.service";

const router = Router();

const listSchema = z.object({
  category: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
  page: z.coerce.number().int().min(1).catch(1),
  search: z.string().trim().min(1).max(160).optional(),
});
const slugSchema = z.object({ slug: z.string().trim().min(1) });
const csvSchema = z.object({ csv: z.string().min(1, "CSV is required.").max(2_000_000) });

function requirePackagesAdmin(req: Request, res: Response, next: NextFunction) {
  const { authUser } = req as unknown as AuthenticatedRequest;
  if (authUser.email.toLowerCase() !== PACKAGES_ADMIN_EMAIL) {
    return res.status(403).json({ message: "Forbidden." });
  }
  return next();
}

router.use(requireFreshAuth, requirePackagesAdmin);

router.get("/template.csv", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"readiness-packages-template.csv\"");
  return res.send(csvTemplate());
});

router.post("/import/preview", async (req, res, next) => {
  try {
    const { csv } = csvSchema.parse(req.body);
    return res.json(await previewCsvWithDatabase(csv));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Upload a valid CSV file." });
    return next(error);
  }
});

router.post("/import", async (req, res, next) => {
  try {
    const { csv } = csvSchema.parse(req.body);
    return res.status(201).json(await importCsv(csv));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Upload a valid CSV file." });
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    return res.json(await listAdminPackages(listSchema.parse(req.query)));
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    return res.status(201).json({ package: await createAdminPackage(packageAdminInputSchema.parse(req.body)) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Package fields are invalid.", issues: error.issues });
    return next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const { slug } = slugSchema.parse(req.params);
    const pack = await getAdminPackage(slug);
    if (!pack) return res.status(404).json({ message: "Package not found." });
    return res.json(pack);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:slug", async (req, res, next) => {
  try {
    const { slug } = slugSchema.parse(req.params);
    const pack = await updateAdminPackage(slug, packageAdminInputSchema.parse(req.body));
    if (!pack) return res.status(404).json({ message: "Package not found." });
    return res.json({ package: pack });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Package fields are invalid.", issues: error.issues });
    return next(error);
  }
});

router.delete("/:slug", async (req, res, next) => {
  try {
    const { slug } = slugSchema.parse(req.params);
    const deleted = await deleteAdminPackage(slug);
    if (!deleted) return res.status(404).json({ message: "Package not found." });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
