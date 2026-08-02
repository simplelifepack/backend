import "dotenv/config";

import { loadEmailConfig } from "../config/email";
import { GmailEmailProvider } from "../services/email/GmailEmailProvider";
import { renderLoginAlertEmail } from "../services/email/templates/loginAlertEmail";

const recipient = process.env.TEST_EMAIL_RECIPIENT?.trim();

function isValidRecipient(value: string | undefined) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

async function run() {
  if (!isValidRecipient(recipient)) {
    throw new Error("TEST_EMAIL_RECIPIENT must be set to the explicit email address that should receive the test.");
  }

  const config = loadEmailConfig();
  if (config.provider !== "gmail") {
    throw new Error("EMAIL_PROVIDER must be gmail to send a test email.");
  }

  const provider = new GmailEmailProvider(config);
  const rendered = renderLoginAlertEmail({
    appUrl: config.appUrl,
    loginTime: new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: process.env.TZ || "UTC",
    }).format(new Date()),
    deviceSummary: "Backend SMTP test script",
    locationSummary: "Not available",
  });

  await provider.sendEmail({
    to: recipient!,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  console.log("Test authentication email sent.");
}

run().catch((error) => {
  console.error("Test authentication email failed.", {
    errorCode: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : "unknown",
  });
  process.exitCode = 1;
});
