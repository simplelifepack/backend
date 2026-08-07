export type SmtpEmailConfig = {
  provider: "smtp";
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  mailFrom: string;
  appUrl: string;
};

export type DisabledEmailConfig = {
  provider: "disabled";
  appUrl: string;
};

export type EmailConfig = SmtpEmailConfig | DisabledEmailConfig;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when SMTP email is configured.`);
  return value;
}

function parseBoolean(name: string, value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

function parsePort(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a positive integer.");
  }
  return port;
}

function isProductionEnv(env: NodeJS.ProcessEnv) {
  return env.APP_ENV === "production" || env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const appUrl = env.APP_URL?.trim() || "http://localhost:5173";
  try {
    const parsed = new URL(appUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid APP_URL protocol.");
  } catch {
    throw new Error("APP_URL must be a valid http or https URL.");
  }

  const smtpValues = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_USER, env.SMTP_PASS, env.MAIL_FROM];
  if (smtpValues.every((value) => !value?.trim())) {
    return { provider: "disabled", appUrl };
  }

  if (!isProductionEnv(env) && smtpValues.some((value) => !value?.trim())) {
    return { provider: "disabled", appUrl };
  }

  return {
    provider: "smtp",
    smtpHost: required("SMTP_HOST", env),
    smtpPort: parsePort(required("SMTP_PORT", env)),
    smtpSecure: parseBoolean("SMTP_SECURE", required("SMTP_SECURE", env)),
    smtpUser: required("SMTP_USER", env),
    smtpPass: required("SMTP_PASS", env),
    mailFrom: required("MAIL_FROM", env),
    appUrl,
  };
}
