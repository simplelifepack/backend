import "dotenv/config";

import { loadEmailConfig } from "../config/email";
import { SmtpEmailProvider } from "../services/email/SmtpEmailProvider";
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
  if (config.provider !== "smtp") {
    throw new Error("SMTP email must be configured to send a test email.");
  }

  const provider = new SmtpEmailProvider(config);
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

  const result = await provider.sendEmail({
    to: recipient!,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  console.log("Test authentication email accepted.", {
    messageId: result?.messageId,
  });
}

run().catch((error) => {
  console.error("Test authentication email failed.", {
    errorCode: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : "unknown",
  });
  process.exitCode = 1;
});
