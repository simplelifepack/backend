export type GmailEmailConfig = {
  provider: "gmail";
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpAppPassword: string;
  fromName: string;
  fromAddress: string;
  appUrl: string;
};

export type DisabledEmailConfig = {
  provider: "disabled";
};

export type EmailConfig = GmailEmailConfig | DisabledEmailConfig;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when EMAIL_PROVIDER=gmail.`);
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

export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const provider = (env.EMAIL_PROVIDER?.trim() || "disabled").toLowerCase();
  if (provider === "disabled" || provider === "none") return { provider: "disabled" };
  if (provider !== "gmail") {
    throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}. Expected "gmail" or "disabled".`);
  }

  const smtpUser = required("SMTP_USER", env).toLowerCase();
  const fromAddress = required("EMAIL_FROM_ADDRESS", env).toLowerCase();
  if (fromAddress !== smtpUser) {
    throw new Error("EMAIL_FROM_ADDRESS must match SMTP_USER when EMAIL_PROVIDER=gmail.");
  }

  const appUrl = required("APP_URL", env);
  try {
    const parsed = new URL(appUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid APP_URL protocol.");
  } catch {
    throw new Error("APP_URL must be a valid http or https URL.");
  }

  return {
    provider: "gmail",
    smtpHost: required("SMTP_HOST", env),
    smtpPort: parsePort(required("SMTP_PORT", env)),
    smtpSecure: parseBoolean("SMTP_SECURE", required("SMTP_SECURE", env)),
    smtpUser,
    smtpAppPassword: required("SMTP_APP_PASSWORD", env),
    fromName: required("EMAIL_FROM_NAME", env),
    fromAddress,
    appUrl,
  };
}
