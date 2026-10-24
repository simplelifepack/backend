import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp } from "../../middleware/adminRbac";
import { KNOWN_KEYS, SystemSettingsError, listSettings, setKnownSetting } from "../../services/systemSettings.service";

const router = Router();
router.use(requireAdminAuth, requireCapability("system.settings.manage"));

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

router.get("/", async (_req, res, next) => {
  try {
    return res.json({ settings: await listSettings(), knownKeys: KNOWN_KEYS });
  } catch (error) {
    return next(error);
  }
});

const setSchema = z.object({ value: z.unknown(), reason: z.string().trim().min(3).max(500) });
const keySchema = z.enum(KNOWN_KEYS);

router.put("/:key", requireStepUp, async (req, res, next) => {
  try {
    const key = keySchema.parse(req.params.key);
    const { value, reason } = setSchema.parse(req.body);
    const setting = await setKnownSetting(adminCtx(req as unknown as AdminAuthenticatedRequest), key, value, reason);
    return res.json({ setting });
  } catch (error) {
    if (error instanceof SystemSettingsError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

export default router;
