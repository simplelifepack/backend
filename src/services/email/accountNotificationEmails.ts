import { renderWaitlistConfirmationEmail } from "./templates/waitlistConfirmationEmail";
import { loadEmailConfig } from "../../config/email";
import { prisma } from "../../lib/prisma";
import { SmtpEmailProvider } from "./SmtpEmailProvider";
import type { EmailProvider, SendEmailInput } from "./EmailProvider";
import { renderPasswordResetEmail, renderPasswordResetOtpEmail } from "./templates/passwordResetEmail";
import { renderLoginAlertEmail } from "./templates/loginAlertEmail";
import { renderWelcomeEmail } from "./templates/welcomeEmail";
import { renderTrustInvitationEmail } from "./templates/trustInvitationEmail";
import { renderWealthHandoffEmail } from "./templates/wealthHandoffEmail";
import { renderSignupOtpEmail } from "./templates/signupOtpEmail";
import { renderAccountChangeOtpEmail } from "./templates/accountChangeOtpEmail";
import { getEmailProvider, isValidRecipient, withTimeout, logEmailFailure, errorCode } from "./emailDelivery";


export async function sendSignupOtpEmail(input: { email: string }, otp: string) {
  const provider = getEmailProvider();
  if (!provider) {
    return { sent: false, reason: "email_disabled" as const };
  }
  if (!isValidRecipient(input.email)) {
    return { sent: false, reason: "invalid_recipient" as const };
  }

  const rendered = renderSignupOtpEmail({ otp });

  try {
    const result = await withTimeout(provider.sendEmail({ to: input.email, ...rendered }));
    return { sent: true, messageId: result?.messageId ?? null };
  } catch (error) {
    logEmailFailure("signup_otp", "pending", error);
    return { sent: false, reason: "delivery_failed" as const, errorCode: errorCode(error) };
  }
}


export async function sendAccountChangeOtpEmail(input: {
  userId: string;
  email: string;
  purpose: "email" | "password" | "pin";
}, otp: string) {
  const provider = getEmailProvider();
  if (!provider) {
    return { sent: false, reason: "email_disabled" as const };
  }
  if (!isValidRecipient(input.email)) {
    return { sent: false, reason: "invalid_recipient" as const };
  }

  const rendered = renderAccountChangeOtpEmail({ otp, purpose: input.purpose });

  try {
    const result = await withTimeout(provider.sendEmail({ to: input.email, ...rendered }));
    return { sent: true, messageId: result?.messageId ?? null };
  } catch (error) {
    logEmailFailure("account_change", input.userId, error);
    return { sent: false, reason: "delivery_failed" as const, errorCode: errorCode(error) };
  }
}


export async function sendTrustInvitationEmail(input: {
  membershipId: string;
  to: string;
  ownerName: string | null;
  memberName: string;
  relation: string;
  accessType: string;
  token: string;
}) {
  const provider = getEmailProvider();
  if (!provider) {
    return { sent: false, reason: "email_disabled" as const };
  }
  if (!isValidRecipient(input.to)) {
    return { sent: false, reason: "invalid_recipient" as const };
  }

  const config = loadEmailConfig();
  const invitationUrl = new URL(`/invite/${encodeURIComponent(input.token)}`, config.frontendUrl).toString();
  const rendered = renderTrustInvitationEmail({
    ownerName: input.ownerName,
    memberName: input.memberName,
    relation: input.relation,
    accessType: input.accessType,
    invitationUrl,
  });

  try {
    const result = await withTimeout(provider.sendEmail({ to: input.to, ...rendered }));
    return { sent: true, messageId: result?.messageId ?? null };
  } catch (error) {
    logEmailFailure("trust_invitation", input.membershipId, error);
    return { sent: false, reason: "delivery_failed" as const, errorCode: errorCode(error) };
  }
}


export async function sendWealthHandoffEmail(input: {
  handoffId: string;
  to: string;
  recipientName: string;
  ownerName: string | null;
  handoffLabel: string;
  summary: string;
  attachment: NonNullable<SendEmailInput["attachments"]>[number];
}) {
  const provider = getEmailProvider();
  if (!provider) {
    return { sent: false, reason: "email_disabled" as const };
  }
  if (!isValidRecipient(input.to)) {
    return { sent: false, reason: "invalid_recipient" as const };
  }

  const rendered = renderWealthHandoffEmail(input);

  try {
    const result = await withTimeout(provider.sendEmail({
      to: input.to,
      ...rendered,
      attachments: [input.attachment],
    }));
    return { sent: true, messageId: result?.messageId ?? null };
  } catch (error) {
    logEmailFailure("wealth_handoff", input.handoffId, error);
    return { sent: false, reason: "delivery_failed" as const, errorCode: errorCode(error) };
  }
}


// SMTP timeouts can occur after acceptance. Only explicit rejection or a
// pre-send configuration failure is retryable; ambiguous outcomes stay unknown.
export async function sendWaitlistEmail(email: string, unsubscribeUrl: string): Promise<{
  status: "sent" | "failed" | "unknown";
  messageId?: string;
}> {
  let provider: EmailProvider | null;
  try { provider = getEmailProvider(); } catch { return { status: "failed" }; }
  if (!provider) return { status: "failed" };
  try {
    const result = await withTimeout(provider.sendEmail({
      to: email,
      ...renderWaitlistConfirmationEmail({ unsubscribeUrl }),
    }));
    return { status: "sent", messageId: result?.messageId };
  } catch (error) {
    const responseCode = (error as { responseCode?: number })?.responseCode;
    return { status: responseCode && responseCode >= 400 && responseCode <= 599 ? "failed" : "unknown" };
  }
}
