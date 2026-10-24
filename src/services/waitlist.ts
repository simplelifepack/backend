import { encryptPrivateValue, decryptPrivateValue, privateLookup } from "../privacy/fieldEncryption";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { sendWaitlistEmail } from "./email/emailService";
import { unsubscribeToken } from "./waitlistSecurity";

export const registrationMessage = "You’re registered for early access. Thank you!";
export async function deliverWaitlistConfirmation(id: string) {
  const base = new URL(process.env.WAITLIST_PUBLIC_URL ?? "https://readines.com");
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Waitlist URL requires HTTPS.");
  base.pathname = "/"; base.search = ""; base.hash = "";
  // Persist the claim BEFORE contacting SMTP. A crash leaves 'sending', which
  // operators must reconcile with Brevo; it must never be retried blindly.
  const claimed = await prisma.waitlistRegistration.updateMany({
    where: { id, status: "registered", confirmationStatus: { in: ["pending", "failed"] }, confirmationAttempts: { lt: 3 }, nextAttemptAt: { lte: new Date() } },
    data: { confirmationStatus: "sending", confirmationAttempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60 * 60_000) },
  });
  if (claimed.count !== 1) return;
  const row = await prisma.waitlistRegistration.findUniqueOrThrow({ where: { id } });
  // Recheck consent immediately before the send.
  if (row.status !== "registered") return;

  base.searchParams.set("waitlistUnsubscribe", unsubscribeToken(row.id));
  const outcome = await sendWaitlistEmail(decryptPrivateValue<string>(row.private_email, { model: "WaitlistRegistration", recordId: row.id, ownerId: row.id, field: "email" }), base.toString());
  await prisma.waitlistRegistration.update({ where: { id }, data: {
    confirmationStatus: outcome.status,
    confirmationMessageId: outcome.messageId ?? null,
    ...(outcome.status === "sent" ? { confirmationSentAt: new Date() } : {}),
  } });
}

export async function registerWaitlistEmail(email: string) {
  const id = randomUUID();
  // Atomic unique insert: concurrent requests and duplicates never trigger send.
  const inserted = await prisma.waitlistRegistration.createMany({ data: [{ id,
    email: privateLookup(email, { model: "WaitlistRegistration", field: "email", ownerId: "global-unique-index" }),
    private_email: encryptPrivateValue(email, { model: "WaitlistRegistration", recordId: id, ownerId: id, field: "email" }),
  }], skipDuplicates: true });
  if (inserted.count === 1) {
    try { await deliverWaitlistConfirmation(id); }
    catch { console.error({ event: "waitlist_delivery_needs_review", registrationId: id }); }
  }
  return { message: registrationMessage };
}
