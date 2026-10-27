import { loadBackendEnv } from "../config/env";
import { prisma } from "../lib/prisma";
import { deliverWaitlistConfirmation } from "../services/waitlist";
loadBackendEnv();

async function main() {
  const now = new Date();
  const rows = await prisma.waitlistRegistration.findMany({
    where: { status: "registered", confirmationStatus: { in: ["pending", "failed"] }, confirmationAttempts: { lt: 3 }, nextAttemptAt: { lte: now } },
    select: { id: true }, take: 100, orderBy: { registeredAt: "asc" },
  });
  for (const row of rows) await deliverWaitlistConfirmation(row.id);
  await prisma.waitlistProof.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.waitlistRateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  console.info({ event: "waitlist_retry_completed", processed: rows.length });
}
main().catch(() => { console.error("Waitlist retry failed; inspect database/email configuration."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
