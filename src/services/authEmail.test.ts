import "dotenv/config";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma";
import type { TokenPayload } from "google-auth-library";

import { forgotPassword, googleLogin, login, resetPassword, signup } from "./auth.service";
import type { SendEmailInput } from "./email/EmailProvider";
import { setEmailProviderForTests } from "./email/emailService";
import { renderLoginAlertEmail } from "./email/templates/loginAlertEmail";
import { renderPasswordResetEmail } from "./email/templates/passwordResetEmail";
import { renderWelcomeEmail } from "./email/templates/welcomeEmail";

process.env.APP_URL = "https://www.readines.com";
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_SECURE;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.MAIL_FROM;

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const email = (label: string) => `auth-email-${label}-${runId}@example.com`;
const googlePayload = (label: string, overrides: Partial<TokenPayload> = {}): TokenPayload => ({
  iss: "accounts.google.com",
  aud: process.env.GOOGLE_CLIENT_ID || "test-google-client-id",
  sub: `auth-email-${label}-${runId}`,
  email: email(label),
  email_verified: true,
  name: "Google Email User",
  iat: Math.floor(Date.now() / 1000) - 5,
  exp: Math.floor(Date.now() / 1000) + 300,
  ...overrides,
});

class MockEmailProvider {
  sent: SendEmailInput[] = [];
  shouldFail = false;

  async sendEmail(input: SendEmailInput) {
    if (this.shouldFail) {
      const error = new Error("SMTP unavailable") as Error & { code?: string };
      error.code = "EAUTH";
      throw error;
    }
    this.sent.push(input);
  }
}

async function expectFailure(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, pattern);
}

async function run() {
  const provider = new MockEmailProvider();
  setEmailProviderForTests(provider);

  const created = await signup({
    name: "Deepika",
    email: email("new"),
    password: "password123",
    from: "attacker@example.com",
  });
  assert.equal(provider.sent.length, 1, "new signup sends one welcome email");
  assert.equal(provider.sent[0].to, created.user.email, "welcome email goes to the registered email");
  assert.equal(provider.sent[0].subject, "Welcome to Readiness");
  assert.match(provider.sent[0].html, /Welcome, Deepika/);
  assert.doesNotMatch(provider.sent[0].html, /attacker@example.com/, "request input cannot override sender or template content");

  await expectFailure(
    () => signup({ name: "Deepika Again", email: email("new"), password: "password123" }),
    /already exists/,
  );
  assert.equal(provider.sent.length, 1, "duplicate signup does not send another welcome email");
  assert.equal(
    provider.sent.filter((message) => message.subject === "New login to your Readiness account").length,
    0,
    "signup automatic login does not send a login alert",
  );

  await expectFailure(
    () => login({ email: email("new"), password: "wrong-password" }),
    /Invalid email or password/,
  );
  assert.equal(provider.sent.length, 1, "failed login sends no email");

  await login(
    { email: email("new"), password: "password123" },
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0.0.0", ip: "203.0.113.42" },
  );
  assert.equal(provider.sent.length, 2, "successful existing-user login sends one alert");
  assert.equal(provider.sent[1].subject, "New login to your Readiness account");
  assert.match(provider.sent[1].text, /203\.0\.113\.x/);

  const missingReset = await forgotPassword({ email: email("missing") });
  assert.match(missingReset.message, /If an account exists/);
  assert.equal(provider.sent.length, 2, "forgot password for unknown account sends no email");

  const resetResponse = await forgotPassword({ email: email("new") });
  assert.match(resetResponse.message, /If an account exists/);
  assert.equal(provider.sent.length, 3, "forgot password sends one reset email for password account");
  assert.equal(provider.sent[2].subject, "Reset your Readiness password");
  assert.equal(provider.sent[2].to, email("new"));
  const resetUrl = provider.sent[2].text.match(/http[^\s]+/)?.[0];
  assert.ok(resetUrl, "reset email includes reset URL");
  const resetToken = new URL(resetUrl).searchParams.get("token");
  assert.ok(resetToken, "reset URL includes token");

  await resetPassword({ token: resetToken, password: "new-password-123" });
  await expectFailure(
    () => login({ email: email("new"), password: "password123" }),
    /Invalid email or password/,
  );
  await login({ email: email("new"), password: "new-password-123" });
  await expectFailure(
    () => resetPassword({ token: resetToken, password: "another-password-123" }),
    /Invalid or expired/,
  );

  const failingWelcomeProvider = new MockEmailProvider();
  failingWelcomeProvider.shouldFail = true;
  setEmailProviderForTests(failingWelcomeProvider);
  await signup({ name: "SMTP Fail", email: email("smtp-signup"), password: "password123" });
  assert.equal(failingWelcomeProvider.sent.length, 0, "SMTP failure does not fail successful signup");

  const failingLoginProvider = new MockEmailProvider();
  failingLoginProvider.shouldFail = true;
  setEmailProviderForTests(failingLoginProvider);
  await login({ email: email("new"), password: "new-password-123" });
  assert.equal(failingLoginProvider.sent.length, 0, "SMTP failure does not fail successful login");

  const googleProvider = new MockEmailProvider();
  setEmailProviderForTests(googleProvider);
  await googleLogin({ credential: "google-new" }, async () => googlePayload("google-new"));
  assert.equal(googleProvider.sent.length, 1, "new Google-created user sends one welcome email");
  assert.equal(googleProvider.sent[0].subject, "Welcome to Readiness");

  await googleLogin(
    { credential: "google-existing" },
    async () => googlePayload("google-new"),
    { userAgent: "Mozilla/5.0 Firefox/126.0", ip: "198.51.100.12" },
  );
  assert.equal(googleProvider.sent.length, 2, "existing Google login sends one alert");
  assert.equal(googleProvider.sent[1].subject, "New login to your Readiness account");

  await forgotPassword({ email: email("google-new") });
  assert.equal(googleProvider.sent.length, 3, "forgot password sends reset email for Google-created account");
  assert.equal(googleProvider.sent[2].subject, "Reset your Readiness password");
  const googleResetUrl = googleProvider.sent[2].text.match(/http[^\s]+/)?.[0];
  assert.ok(googleResetUrl, "Google reset email includes reset URL");
  const googleResetToken = new URL(googleResetUrl).searchParams.get("token");
  assert.ok(googleResetToken, "Google reset URL includes token");
  await resetPassword({ token: googleResetToken, password: "google-password-123" });
  await login({ email: email("google-new"), password: "google-password-123" });

  const welcome = renderWelcomeEmail({ name: `<script>alert("x")</script>`, appUrl: "http://localhost:5173" });
  assert.ok(welcome.html.length > 0 && welcome.text.length > 0);
  assert.match(welcome.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(welcome.html, /<script>/);
  assert.doesNotMatch(welcome.html, /href="http:\/\/localhost:5173"/);
  assert.doesNotMatch(welcome.text, /http:\/\/localhost:5173/);

  const loginAlert = renderLoginAlertEmail({
    appUrl: "http://localhost:5173",
    loginTime: "Jul 31, 2026, 10:00 AM",
    deviceSummary: `<img src=x onerror=alert(1)>`,
    locationSummary: "203.0.113.x",
  });
  assert.ok(loginAlert.html.length > 0 && loginAlert.text.length > 0);
  assert.match(loginAlert.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(loginAlert.html, /<img src=x/);
  assert.doesNotMatch(loginAlert.html, /href="http:\/\/localhost:5173"/);
  assert.doesNotMatch(loginAlert.text, /http:\/\/localhost:5173/);

  const passwordReset = renderPasswordResetEmail({ resetUrl: "https://www.readines.com/reset-password?token=<script>" });
  assert.ok(passwordReset.html.length > 0 && passwordReset.text.length > 0);
  assert.match(passwordReset.html, /token=&lt;script&gt;/);
  assert.doesNotMatch(passwordReset.html, /<script>/);

  const localPasswordReset = renderPasswordResetEmail({ resetUrl: "http://localhost:5173/reset-password?token=test-token" });
  assert.ok(localPasswordReset.html.length > 0 && localPasswordReset.text.length > 0);
  assert.match(localPasswordReset.html, /Copy and paste this reset link/);
  assert.match(localPasswordReset.html, /http:\/\/localhost:5173\/reset-password\?token=test-token/);
  assert.match(localPasswordReset.text, /http:\/\/localhost:5173\/reset-password\?token=test-token/);

  console.log("Authentication email tests passed.");
}

run()
  .finally(async () => {
    setEmailProviderForTests(null);
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${runId}@example.com` } } });
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Authentication email tests failed.");
    process.exitCode = 1;
  });
