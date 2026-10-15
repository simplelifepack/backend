import { prisma } from "../lib/prisma";
import { withAudit } from "./adminAudit.service";

export class AdminFeedbackError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminFeedbackError";
    this.statusCode = statusCode;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };
const STATUSES = ["open", "in_progress", "resolved", "dismissed"] as const;
type FeedbackStatus = (typeof STATUSES)[number];

export async function listFeedback(opts: { status?: FeedbackStatus; category?: string; limit?: number } = {}) {
  const where = { ...(opts.status ? { status: opts.status } : {}), ...(opts.category ? { category: opts.category } : {}) };
  const [total, items] = await Promise.all([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
      select: {
        id: true, email: true, platform: true, category: true, message: true, status: true,
        assignedToAdminId: true, assignedToAdmin: { select: { name: true, email: true } },
        resolutionNote: true, resolvedAt: true, createdAt: true,
      },
    }),
  ]);
  return { total, items };
}

export async function getFeedbackDetail(id: string) {
  const item = await prisma.feedback.findUnique({
    where: { id },
    select: {
      id: true, userId: true, email: true, platform: true, category: true, message: true, status: true,
      assignedToAdminId: true, assignedToAdmin: { select: { name: true, email: true } },
      resolutionNote: true, resolvedAt: true, createdAt: true, updatedAt: true,
    },
  });
  if (!item) throw new AdminFeedbackError("Feedback ticket not found.", 404);
  return item;
}

export async function updateFeedbackStatus(ctx: AdminCtx, id: string, status: FeedbackStatus, note?: string) {
  const existing = await prisma.feedback.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new AdminFeedbackError("Feedback ticket not found.", 404);

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "feedback.status.update",
      targetType: "Feedback", targetId: id, diff: { from: existing.status, to: status, note: note ?? null },
    },
    (tx) => tx.feedback.update({
      where: { id },
      data: {
        status,
        resolutionNote: note !== undefined ? note : undefined,
        resolvedAt: status === "resolved" || status === "dismissed" ? new Date() : status === "open" || status === "in_progress" ? null : undefined,
      },
      select: { id: true, status: true, resolutionNote: true, resolvedAt: true },
    }),
  );
}

export async function assignFeedback(ctx: AdminCtx, id: string, assignToAdminId: string | null) {
  const existing = await prisma.feedback.findUnique({ where: { id }, select: { assignedToAdminId: true } });
  if (!existing) throw new AdminFeedbackError("Feedback ticket not found.", 404);
  if (assignToAdminId) {
    const admin = await prisma.adminUser.findUnique({ where: { id: assignToAdminId }, select: { id: true } });
    if (!admin) throw new AdminFeedbackError("Admin not found.", 404);
  }

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "feedback.assign",
      targetType: "Feedback", targetId: id, diff: { from: existing.assignedToAdminId, to: assignToAdminId },
    },
    (tx) => tx.feedback.update({
      where: { id },
      data: { assignedToAdminId: assignToAdminId },
      select: { id: true, assignedToAdminId: true, assignedToAdmin: { select: { name: true, email: true } } },
    }),
  );
}

export { STATUSES as FEEDBACK_STATUSES };
