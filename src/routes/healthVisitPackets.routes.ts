import { createAdmissionLimit } from "../middleware/resourceLimits";
import { generateVisitPacket } from "../services/healthVisitPacketFile";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { type AuthenticatedRequest } from "../middleware/requireAuth";
import { assertMember } from "../services/healthDtos";
import { healthDateOnly, iso, parseOptionalDate } from "../services/healthSchemas";
import type { HealthVisitPacket } from "@prisma/client";

const router = Router();
const id = z.string().trim().min(1);
const packetSchema = z.object({
  memberId: id,
  recordIds: z.array(id),
  doctor: z.string().trim().optional().nullable(),
  clinic: z.string().trim().optional().nullable(),
  visitDate: healthDateOnly,
  fileDocumentId: id,
}).strict();
const updateSchema = packetSchema.omit({ memberId: true }).partial();

function packetResponse(packet: HealthVisitPacket) {
  return {
    ...packet,
    visitDate: iso(packet.visitDate),
    downloadPath: "/documents/" + encodeURIComponent(packet.fileDocumentId) + "/download",
  };
}

async function assertPacketLinks(userId: string, memberId: string, data: z.infer<typeof updateSchema>) {
  if (data.recordIds) {
    const count = await prisma.healthDocument.count({ where: { userId, memberId, id: { in: data.recordIds } } });
    if (count !== data.recordIds.length) {
      throw Object.assign(new Error("Choose distinct records for this member."), { statusCode: 400 });
    }
  }
  if (data.fileDocumentId && !await prisma.document.findFirst({
    where: { id: data.fileDocumentId, ownerProfileId: userId, deletedAt: null },
    select: { id: true },
  })) {
    throw Object.assign(new Error("Save the generated file in Documents before attaching it."), { statusCode: 400 });
  }
}

router.get("/", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const memberId = id.optional().parse(req.query.memberId);
    const packets = await prisma.healthVisitPacket.findMany({ where: { userId: authUser.id, memberId }, orderBy: { createdAt: "desc" } });
    return res.json(packets.map(packetResponse));
  } catch (error) {
    return next(error);
  }
});

const generateSchema = packetSchema.omit({ fileDocumentId: true }).extend({ recordIds: z.array(id).min(1) });

router.post("/generate", createAdmissionLimit(2), async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { visitDate, ...data } = generateSchema.parse(req.body);
    await assertMember(authUser.id, data.memberId);
    const packet = await generateVisitPacket(authUser.id, { ...data, visitDate: parseOptionalDate(visitDate, "visitDate") });
    return res.status(201).json(packetResponse(packet));
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const data = packetSchema.parse(req.body);
    await assertMember(authUser.id, data.memberId);
    await assertPacketLinks(authUser.id, data.memberId, data);
    const packet = await prisma.healthVisitPacket.create({
      data: { ...data, userId: authUser.id, visitDate: parseOptionalDate(data.visitDate, "visitDate") },
    });
    return res.status(201).json(packetResponse(packet));
  } catch (error) {
    return next(error);
  }
});

router.get("/:packetId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const packet = await prisma.healthVisitPacket.findFirst({ where: { id: req.params.packetId, userId: authUser.id } });
    if (!packet) return res.status(404).json({ message: "Visit packet not found." });
    return res.json(packetResponse(packet));
  } catch (error) {
    return next(error);
  }
});

router.patch("/:packetId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const data = updateSchema.parse(req.body);
    const where = { id: req.params.packetId, userId: authUser.id };
    const existing = await prisma.healthVisitPacket.findFirst({ where });
    if (!existing) return res.status(404).json({ message: "Visit packet not found." });
    await assertPacketLinks(authUser.id, existing.memberId, data);
    const packet = await prisma.healthVisitPacket.update({
      where,
      data: { ...data, visitDate: data.visitDate === undefined ? undefined : parseOptionalDate(data.visitDate, "visitDate") },
    });
    return res.json(packetResponse(packet));
  } catch (error) {
    return next(error);
  }
});

export default router;
