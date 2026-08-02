import "dotenv/config";

import { verifyEmailProvider } from "../services/email/emailService";

verifyEmailProvider()
  .then(() => {
    console.log("Gmail SMTP authentication verified.");
  })
  .catch((error) => {
    console.error("Gmail SMTP authentication failed.", {
      errorCode: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : "unknown",
    });
    process.exitCode = 1;
  });
