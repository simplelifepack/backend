import "dotenv/config";
import { prisma } from "../lib/prisma";
import { billingService } from "../services/billing/runtime";

async function main() {
  // Safe to run repeatedly from a scheduler. One user at a time; provider errors
  // never create new subscriptions and leave an explicit nonzero exit status.
  const rows = await prisma.billingSubscription.findMany({ where: { OR: [{ status: { notIn: ["expired", "cancelled", "completed", "creation_failed"] } }, { paidThrough: { gt: new Date() } }] }, select: { userId: true }, distinct: ["userId"] });
  let failed = 0;
  for (const { userId } of rows) {
    try { await billingService.status(userId); } catch { failed++; }
  }
  console.log(JSON.stringify({ processed: rows.length, failed }));
  if (failed) process.exitCode = 1;
}
main().catch(() => { console.error("Billing reconciliation failed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
