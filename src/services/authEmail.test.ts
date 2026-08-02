import "dotenv/config";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma";
import type { TokenPayload } from "google-auth-library";

import { googleLogin, login, signup } from "./auth.service";
import type { SendEmailInput } from "./email/EmailProvider";
import { setEmailProviderForTests } from "./email/emailService";
import { renderLoginAlertEmail } from "./email/templates/loginAlertEmail";
import { renderWelcomeEmail } from "./email/templates/welcomeEmail";

process.env.APP_URL ||= "http://localhost:5173";

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
  assert.equal(provider.sent[0].subject, "Welcome to LifePack");
  assert.match(provider.sent[0].html, /Welcome, Deepika/);
  assert.doesNotMatch(provider.sent[0].html, /attacker@example.com/, "request input cannot override sender or template content");

  await expectFailure(
    () => signup({ name: "Deepika Again", email: email("new"), password: "password123" }),
    /already exists/,
  );
  assert.equal(provider.sent.length, 1, "duplicate signup does not send another welcome email");
  assert.equal(
    provider.sent.filter((message) => message.subject === "New login to your LifePack account").length,
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
  assert.equal(provider.sent[1].subject, "New login to your LifePack account");
  assert.match(provider.sent[1].text, /203\.0\.113\.x/);

  const failingWelcomeProvider = new MockEmailProvider();
  failingWelcomeProvider.shouldFail = true;
  setEmailProviderForTests(failingWelcomeProvider);
  await signup({ name: "SMTP Fail", email: email("smtp-signup"), password: "password123" });
  assert.equal(failingWelcomeProvider.sent.length, 0, "SMTP failure does not fail successful signup");

  const failingLoginProvider = new MockEmailProvider();
  failingLoginProvider.shouldFail = true;
  setEmailProviderForTests(failingLoginProvider);
  await login({ email: email("new"), password: "password123" });
  assert.equal(failingLoginProvider.sent.length, 0, "SMTP failure does not fail successful login");

  const googleProvider = new MockEmailProvider();
  setEmailProviderForTests(googleProvider);
  await googleLogin({ credential: "google-new" }, async () => googlePayload("google-new"));
  assert.equal(googleProvider.sent.length, 1, "new Google-created user sends one welcome email");
  assert.equal(googleProvider.sent[0].subject, "Welcome to LifePack");

  await googleLogin(
    { credential: "google-existing" },
    async () => googlePayload("google-new"),
    { userAgent: "Mozilla/5.0 Firefox/126.0", ip: "198.51.100.12" },
  );
  assert.equal(googleProvider.sent.length, 2, "existing Google login sends one alert");
  assert.equal(googleProvider.sent[1].subject, "New login to your LifePack account");

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
