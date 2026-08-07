import assert from "node:assert/strict";

import { loadEmailConfig } from "./email";

function run() {
  const localPartial = loadEmailConfig({
    APP_URL: "http://localhost:5173",
    SMTP_HOST: "smtpout.secureserver.net",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "support@readines.info",
  } as NodeJS.ProcessEnv);
  assert.equal(localPartial.provider, "disabled");

  assert.throws(
    () =>
      loadEmailConfig({
        APP_ENV: "production",
        APP_URL: "https://readines.com",
        SMTP_HOST: "smtpout.secureserver.net",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "support@readines.info",
        MAIL_FROM: "LifePack <support@readines.info>",
      } as NodeJS.ProcessEnv),
    /SMTP_PASS is required/,
  );

  const configured = loadEmailConfig({
    APP_ENV: "production",
    APP_URL: "https://readines.com",
    SMTP_HOST: "smtpout.secureserver.net",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "support@readines.info",
    SMTP_PASS: "secret",
    MAIL_FROM: "LifePack <support@readines.info>",
  } as NodeJS.ProcessEnv);
  assert.equal(configured.provider, "smtp");

  console.log("Email config tests passed.");
}

run();
