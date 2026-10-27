import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthenticatedRequest } from "../middleware/requireAuth";
import {
  decryptDocumentRecord,
  toDocumentResponseDto,
} from "./documents.helpers";
import {
  encryptJson,
  documentMetadataIntegrityHash,
} from "../utils/documentEncryption";

const router = Router();
const detailsSchema = z
  .object({
    notes: z.string().max(4000).optional(),
    expiry: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.notes !== undefined || value.expiry !== undefined,
    "No details supplied.",
  );
const assignmentSchema = z
  .object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate document references.",
      ),
    assigneeId: z.string().min(1),
  })
  .strict();
async function people(userId: string) {
  const [owner, members] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true },
    }),
    prisma.trustMember.findMany({
      where: { ownerUserId: userId, status: { in: ["ACTIVE", "INVITED"] } },
      select: { id: true, name: true },
    }),
  ]);
  return [owner, ...members];
}
async function serializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt >= 2)
        throw error;
    }
  }
}
router.get("/assignment-options", async (req, res, next) => {
  try {
    return res.json(
      await people((req as unknown as AuthenticatedRequest).authUser.id),
    );
  } catch (error) {
    return next(error);
  }
});
router.patch("/:id/details", async (req, res, next) => {
  try {
    const userId = (req as unknown as AuthenticatedRequest).authUser.id;
    const body = detailsSchema.parse(req.body);
    if (
      body.expiry &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(body.expiry) ||
        Number.isNaN(Date.parse(body.expiry)) ||
        new Date(body.expiry).toISOString().slice(0, 10) !== body.expiry)
    )
      return res.status(422).json({ message: "Enter a valid expiry date." });
    const document = await serializable(async (tx) => {
      const current = await tx.document.findFirst({
        where: { id: req.params.id, ownerProfileId: userId, deletedAt: null },
      });
      if (!current)
        throw Object.assign(new Error("Document not found."), {
          statusCode: 404,
        });
      const fields = decryptDocumentRecord(current).fields as Record<
        string,
        unknown
      >;
      const updated = {
        ...fields,
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.expiry !== undefined ? { userExpiry: body.expiry } : {}),
      };
      return tx.document.update({
        where: {
          id_ownerProfileId: { id: current.id, ownerProfileId: userId },
        },
        data: {
          fields: encryptJson(updated),
          metadataIntegrityHash: documentMetadataIntegrityHash(updated),
        },
        include: { files: true },
      });
    });
    return res.json({ document: toDocumentResponseDto(document) });
  } catch (error) {
    return next(error);
  }
});
router.post("/bulk-assign", async (req, res, next) => {
  try {
    const userId = (req as unknown as AuthenticatedRequest).authUser.id;
    const body = assignmentSchema.parse(req.body);
    const person = (await people(userId)).find(
      (item) => item.id === body.assigneeId,
    );
    if (!person) return res.status(404).json({ message: "Person not found." });
    const documents = await serializable(async (tx) => {
      const owned = await tx.document.findMany({
        where: {
          id: { in: body.ids },
          ownerProfileId: userId,
          deletedAt: null,
        },
      });
      if (owned.length !== body.ids.length)
        throw Object.assign(new Error("Document not found."), {
          statusCode: 404,
        });
      return Promise.all(
        owned.map((document) => {
          const fields = {
            ...(decryptDocumentRecord(document).fields as Record<
              string,
              unknown
            >),
            assignedPerson: person,
          };
          return tx.document.update({
            where: {
              id_ownerProfileId: { id: document.id, ownerProfileId: userId },
            },
            data: {
              fields: encryptJson(fields),
              metadataIntegrityHash: documentMetadataIntegrityHash(fields),
            },
            include: { files: true },
          });
        }),
      );
    });
    // Assignment is a label only: document ownership and access remain scoped to its owner.
    return res.json({ documents: documents.map(toDocumentResponseDto) });
  } catch (error) {
    return next(error);
  }
});
export default router;
