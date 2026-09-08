import { loadEmailConfig } from "../../config/email";
import { prisma } from "../../lib/prisma";
import { SmtpEmailProvider } from "./SmtpEmailProvider";
import type { EmailProvider, SendEmailInput } from "./EmailProvider";
import { renderPasswordResetEmail } from "./templates/passwordResetEmail";
import { renderLoginAlertEmail } from "./templates/loginAlertEmail";
import { renderWelcomeEmail } from "./templates/welcomeEmail";
import { renderTrustInvitationEmail } from "./templates/trustInvitationEmail";
import { renderWealthHandoffEmail } from "./templates/wealthHandoffEmail";
import { renderRecoveryKeyEmail } from "./templates/recoveryKeyEmail";

const EMAIL_TIMEOUT_MS = 5000;
const RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginAlertContext = {
  userAgent?: string;
  ip?: string;
  timeZone?: string | null;
};

type SendType = "welcome" | "login_alert" | "password_reset" | "trust_invitation" | "wealth_handoff" | "recovery_key";

let providerOverride: EmailProvider | null = null;
let cachedProvider: EmailProvider | null | undefined;
let startupVerificationStarted = false;

function getEmailProvider(): EmailProvider | null {
  if (providerOverride) return providerOverride;
  if (cachedProvider !== undefined) return cachedProvider;
  const config = loadEmailConfig();
  cachedProvider = config.provider === "disabled" ? null : new SmtpEmailProvider(config);
  return cachedProvider;
}

export function setEmailProviderForTests(provider: EmailProvider | null) {
  providerOverride = provider;
  cachedProvider = undefined;
}

export async function verifyEmailProvider() {
  const provider = getEmailProvider();
  if (!provider?.verify) return;
  await provider.verify();
}

export function verifyEmailProviderOnStartup() {
  if (startupVerificationStarted) return;
  startupVerificationStarted = true;

  const provider = getEmailProvider();
  if (!provider?.verify) {
    console.info({ event: "smtp_verify_skipped", reason: "email_disabled" });
    return;
  }

  provider.verify()
    .then(() => {
      console.info({ event: "smtp_verify_succeeded" });
    })
    .catch((error) => {
      console.error({
        event: "smtp_verify_failed",
        errorCode: errorCode(error),
        ...emailFailureDetails(error),
      });
    });
}

function withTimeout<T>(send: Promise<T>) {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error("Email delivery timed out.");
      error.name = "EmailTimeoutError";
      reject(error);
    }, EMAIL_TIMEOUT_MS);
  });

  return Promise.race([send, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error && error.name) return error.name;
  return "unknown";
}

function emailFailureDetails(error: unknown) {
  if (typeof error !== "object" || !error) return {};
  const detail = error as {
    command?: unknown;
    response?: unknown;
    responseCode?: unknown;
    rejected?: unknown;
  };

  return {
    command: typeof detail.command === "string" ? detail.command : undefined,
    responseCode: typeof detail.responseCode === "number" ? detail.responseCode : undefined,
    response: typeof detail.response === "string" ? detail.response.slice(0, 500) : undefined,
    rejectedCount: Array.isArray(detail.rejected) ? detail.rejected.length : undefined,
  };
}

function logEmailFailure(type: SendType, userId: string, error: unknown) {
  console.error({
    event: "auth_email_failed",
    type,
    userId,
    errorCode: errorCode(error),
    ...emailFailureDetails(error),
  });
}

function isValidRecipient(email: string) {
  return RECIPIENT_PATTERN.test(email.trim());
}

function safeDeviceSummary(userAgent: string | undefined) {
  const value = userAgent?.trim();
  if (!value) return "Unknown browser or device";
  const normalized = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").slice(0, 140);
  const browser = normalized.match(/(Chrome|CriOS|Firefox|FxiOS|Safari|Edg|OPR)\/[\d.]+/i)?.[0];
  const os = normalized.match(/\(([^)]+)\)/)?.[1]?.split(";").slice(0, 2).join("; ");
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? normalized;
}

function safeIpSummary(ip: string | undefined) {
  const value = ip?.trim();
  if (!value) return "Not available";
  if (value.includes(":")) {
    return `${value.split(":").slice(0, 4).join(":")}:...`;
  }
  const parts = value.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  return "Not available";
}

function safeTimeZone(timeZone: string | null | undefined) {
  const candidate = timeZone?.trim() || process.env.TZ || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function formatLoginTime(date: Date, timeZone?: string | null) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: safeTimeZone(timeZone),
  }).format(date);
}

export async function sendWelcomeEmail(user: { id: string; name: string | null; email: string }) {
  const provider = getEmailProvider();
  if (!provider || !isValidRecipient(user.email)) return;

  const claimed = await prisma.user.updateMany({
    where: {
      id: user.id,
      welcomeEmailSentAt: null,
    },
    data: {
      welcomeEmailSentAt: new Date(),
    },
  });
  if (claimed.count !== 1) return;

  const config = loadEmailConfig();
  const rendered = renderWelcomeEmail({ name: user.name, appUrl: config.appUrl });

  try {
    await withTimeout(provider.sendEmail({ to: user.email, ...rendered }));
  } catch (error) {
    logEmailFailure("welcome", user.id, error);
  }
}

export async function sendLoginAlertEmail(user: { id: string; email: string }, context: LoginAlertContext = {}) {
  const provider = getEmailProvider();
  if (!provider || !isValidRecipient(user.email)) return;

  const config = loadEmailConfig();
  const rendered = renderLoginAlertEmail({
    appUrl: config.appUrl,
    loginTime: formatLoginTime(new Date(), context.timeZone),
    deviceSummary: safeDeviceSummary(context.userAgent),
    locationSummary: safeIpSummary(context.ip),
  });

  try {
    await withTimeout(provider.sendEmail({ to: user.email, ...rendered }));
  } catch (error) {
    logEmailFailure("login_alert", user.id, error);
  }
}

export async function sendPasswordResetEmail(user: { id: string; email: string }, resetUrl: string) {
  const provider = getEmailProvider();
  if (!provider || !isValidRecipient(user.email)) return;

  const rendered = renderPasswordResetEmail({ resetUrl });

  try {
    await withTimeout(provider.sendEmail({ to: user.email, ...rendered }));
  } catch (error) {
    logEmailFailure("password_reset", user.id, error);
  }
}

export async function sendRecoveryKeyEmail(user: { id: string; email: string }, recoveryDocument: string) {
  const provider = getEmailProvider();
  if (!provider) {
    return { sent: false, reason: "email_disabled" as const };
  }
  if (!isValidRecipient(user.email)) {
    return { sent: false, reason: "invalid_recipient" as const };
  }

  const rendered = renderRecoveryKeyEmail({ recoveryDocument });

  try {
    const result = await withTimeout(provider.sendEmail({ to: user.email, ...rendered }));
    return { sent: true, messageId: result?.messageId ?? null };
  } catch (error) {
    logEmailFailure("recovery_key", user.id, error);
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
