import { prisma } from "../lib/prisma";

/** There is no payment gateway and no Subscription/Payment/PlanPolicy model
 * in this codebase (design doc: "Billing & revenue... once a payment
 * gateway exists — today there is none"). This is deliberately not an MRR
 * or revenue dashboard — there is no real revenue data to show. What *is*
 * real: the free/paid tier split, and the history of tier changes, which
 * already exists as `user.tier.change` rows in the admin audit log (Phase 2
 * work) — this just surfaces both, honestly labeled. */
export async function getBillingStats() {
  const [free, paid] = await Promise.all([
    prisma.user.count({ where: { accountTier: "free" } }),
    prisma.user.count({ where: { accountTier: "paid" } }),
  ]);
  return { free, paid, total: free + paid };
}

export async function listTierChangeHistory(limit = 50) {
  return prisma.adminAuditLog.findMany({
    where: { action: "user.tier.change" },
    orderBy: { at: "desc" },
    take: limit,
    select: { id: true, at: true, actorEmail: true, targetId: true, reason: true, diff: true },
  });
}
