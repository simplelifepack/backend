import { Router } from "express";
import { z } from "zod";

import { isSupportedDigiLockerDocument, SUPPORTED_DIGILOCKER_DOCUMENTS } from "../config/digilocker";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import {
  cancelDigiLockerSession,
  digilockerStatus,
  importDigiLockerDocuments,
  listDigiLockerDocuments,
  refreshDigiLockerSession,
  startDigiLockerSession,
} from "../services/digilocker/digilocker.service";

const router = Router();
router.use(requireAuth);

const documentTypeSchema = z.string().refine(isSupportedDigiLockerDocument, "Unsupported DigiLocker document type.");
const startSchema = z.object({
  redirectUrl: z.string().url().optional(),
  documentTypes: z.array(documentTypeSchema).min(1).max(SUPPORTED_DIGILOCKER_DOCUMENTS.length).optional(),
}).strict();
const importSchema = z.object({
  documentTypes: z.array(documentTypeSchema).min(1).max(SUPPORTED_DIGILOCKER_DOCUMENTS.length),
}).strict();

router.get("/status", (_req, res) => res.json(digilockerStatus()));

router.post("/sessions", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const payload = startSchema.parse(req.body ?? {});
    const redirectBaseUrl = payload.redirectUrl ?? `${process.env.FRONTEND_URL ?? "http://localhost:5173"}/documents`;
    return res.status(201).json(await startDigiLockerSession({
      userId: authUser.id,
      redirectBaseUrl,
      documentTypes: payload.documentTypes,
    }));
  } catch (error) {
    return next(error);
  }
});

router.get("/sessions/:id/status", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await refreshDigiLockerSession(authUser.id, req.params.id));
  } catch (error) {
    return next(error);
  }
});

router.post("/sessions/:id/cancel", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await cancelDigiLockerSession(authUser.id, req.params.id));
  } catch (error) {
    return next(error);
  }
});

router.get("/sessions/:id/documents", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await listDigiLockerDocuments(authUser.id, req.params.id));
  } catch (error) {
    return next(error);
  }
});

router.post("/sessions/:id/import", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const payload = importSchema.parse(req.body ?? {});
    return res.json(await importDigiLockerDocuments({
      userId: authUser.id,
      sessionId: req.params.id,
      documentTypes: payload.documentTypes,
    }));
  } catch (error) {
    return next(error);
  }
});

export default router;
