export type SmtpEmailConfig = {
  provider: "smtp";
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  mailFrom: string;
  appUrl: string;
  frontendUrl: string;
};

export type DisabledEmailConfig = {
  provider: "disabled";
  appUrl: string;
  frontendUrl: string;
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

function resolveSmtpPass(env: NodeJS.ProcessEnv) {
  return env.SMTP_PASS?.trim() || env.SMTP_APP_PASSWORD?.trim() || "";
}

function resolveMailFrom(env: NodeJS.ProcessEnv) {
  const mailFrom = env.MAIL_FROM?.trim();
  if (mailFrom) return mailFrom;

  const fromAddress = env.EMAIL_FROM_ADDRESS?.trim();
  if (!fromAddress) return "";

  const fromName = env.EMAIL_FROM_NAME?.trim();
  return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
}

function isProductionEnv(env: NodeJS.ProcessEnv) {
  return env.APP_ENV === "production" || env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const appUrl = env.APP_URL?.trim() || "http://localhost:5173";
  const frontendUrl = env.FRONTEND_URL?.trim() || appUrl;
  try {
    const parsed = new URL(appUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid APP_URL protocol.");
    const frontend = new URL(frontendUrl);
    if (!["http:", "https:"].includes(frontend.protocol)) throw new Error("Invalid FRONTEND_URL protocol.");
  } catch {
    throw new Error("APP_URL and FRONTEND_URL must be valid http or https URLs.");
  }

  const smtpPass = resolveSmtpPass(env);
  const mailFrom = resolveMailFrom(env);
  const smtpValues = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_USER, smtpPass, mailFrom];
  if (smtpValues.every((value) => !value?.trim())) {
    return { provider: "disabled", appUrl, frontendUrl };
  }

  if (!isProductionEnv(env) && smtpValues.some((value) => !value?.trim())) {
    return { provider: "disabled", appUrl, frontendUrl };
  }

  if (!smtpPass) {
    throw new Error("SMTP_PASS or SMTP_APP_PASSWORD is required when SMTP email is configured.");
  }
  if (!mailFrom) {
    throw new Error("MAIL_FROM or EMAIL_FROM_ADDRESS is required when SMTP email is configured.");
  }

  return {
    provider: "smtp",
    smtpHost: required("SMTP_HOST", env),
    smtpPort: parsePort(required("SMTP_PORT", env)),
    smtpSecure: parseBoolean("SMTP_SECURE", required("SMTP_SECURE", env)),
    smtpUser: required("SMTP_USER", env),
    smtpPass,
    mailFrom,
    appUrl,
    frontendUrl,
  };
}
