import { loadEmailConfig } from "../../config/email";
import { prisma } from "../../lib/prisma";
import { GmailEmailProvider } from "./GmailEmailProvider";
import type { EmailProvider } from "./EmailProvider";
import { renderLoginAlertEmail } from "./templates/loginAlertEmail";
import { renderWelcomeEmail } from "./templates/welcomeEmail";

const EMAIL_TIMEOUT_MS = 5000;
const RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginAlertContext = {
  userAgent?: string;
  ip?: string;
  timeZone?: string | null;
};

type SendType = "welcome" | "login_alert";

let providerOverride: EmailProvider | null = null;
let cachedProvider: EmailProvider | null | undefined;

function getEmailProvider(): EmailProvider | null {
  if (providerOverride) return providerOverride;
  if (cachedProvider !== undefined) return cachedProvider;
  const config = loadEmailConfig();
  cachedProvider = config.provider === "disabled" ? null : new GmailEmailProvider(config);
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

function withTimeout(send: Promise<void>) {
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

function logEmailFailure(type: SendType, userId: string, error: unknown) {
  console.error({
    event: "auth_email_failed",
    type,
    userId,
    errorCode: errorCode(error),
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
  const rendered = renderWelcomeEmail({ name: user.name, appUrl: config.provider === "gmail" ? config.appUrl : "http://localhost:5173" });

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
    appUrl: config.provider === "gmail" ? config.appUrl : "http://localhost:5173",
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
