import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth } from "../../middleware/adminAuth";

const router = Router();
router.use(requireAdminAuth);

const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).catch(50) });

function shortId(id: string) {
  return id.length > 8 ? `…${id.slice(-7)}` : id;
}

// DTO note (decision D3): never select title, displayName, originalName,
// rawText, extractedKeyFields or fields here — all on the sealed list (6.2 in
// the design doc). Everything below is operational metadata only.

router.get("/stuck-classification", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const where = { deletedAt: null, classificationStatus: "pending", createdAt: { lt: oneHourAgo } } as const;
    const [total, rows] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        select: { id: true, ownerProfileId: true, documentType: true, mimeType: true, size: true, classificationStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
    ]);
    return res.json({
      total,
      items: rows.map((r) => ({ ...r, id: shortId(r.id), ownerProfileId: r.ownerProfileId ? shortId(r.ownerProfileId) : null })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/failed-health-extractions", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    const where = { processingError: { not: null } } as const;
    const [total, rows] = await Promise.all([
      prisma.healthDocument.count({ where }),
      prisma.healthDocument.findMany({
        where,
        select: { id: true, userId: true, memberId: true, type: true, processingStatus: true, processingError: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
    ]);
    return res.json({
      total,
      items: rows.map((r) => ({ ...r, id: shortId(r.id), userId: shortId(r.userId), memberId: r.memberId ? shortId(r.memberId) : null })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/storage-cleanup", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    const [total, rows] = await Promise.all([
      prisma.storageCleanup.count(),
      prisma.storageCleanup.findMany({
        select: { storageKey: true, ownerUserId: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
    ]);
    return res.json({
      total,
      items: rows.map((r) => ({
        storageKey: shortId(r.storageKey), ownerUserId: shortId(r.ownerUserId),
        sizeBytes: Number(r.sizeBytes), createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/expiring-uploads", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    const where = { status: "active", expiresAt: { gt: new Date() } } as const;
    const [total, rows] = await Promise.all([
      prisma.temporaryUpload.count({ where }),
      prisma.temporaryUpload.findMany({
        where,
        select: { id: true, ownerProfileId: true, detectedMimeType: true, size: true, status: true, expiresAt: true, createdAt: true },
        orderBy: { expiresAt: "asc" },
        take: limit,
      }),
    ]);
    return res.json({
      total,
      items: rows.map((r) => ({ ...r, id: shortId(r.id), ownerProfileId: shortId(r.ownerProfileId) })),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
