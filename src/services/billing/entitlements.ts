import { withPrivateUser } from "../../privacy/access";
import type { Prisma } from "@prisma/client";

// Call only while holding the existing User FOR UPDATE lock. Legacy paid users
// remain untouched; only gateway-managed accounts expire with verified invoices.
export async function synchronizePaidTier(tx: Prisma.TransactionClient, userId: string, currentTier: "free" | "paid", managed: boolean, now = new Date()) {
  if (!managed) return currentTier;
  const paid = await tx.billingSubscription.findFirst({ where: { userId, paidThrough: { gt: now } }, select: { id: true } });
  const accountTier = paid ? "paid" : "free";
  if (accountTier !== currentTier) await withPrivateUser(userId, () => tx.user.update({ where: { id: userId }, data: { accountTier }, select: { id: true } }));
  return accountTier;
}
