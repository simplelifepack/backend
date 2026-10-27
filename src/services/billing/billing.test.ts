import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { billingPlans, publicCatalogue, billingConfig } from "./catalogue";
import { verifySignature } from "./provider";

test("canonical prices and savings are backend-owned paise", () => {
  assert.equal(billingPlans.monthly.amountPaise, 24900);
  assert.equal(billingPlans.annual.amountPaise, 199900);
  assert.equal(publicCatalogue().annualSavingsPaise, 98900);
  assert.equal(publicCatalogue().annualMonthlyEquivalent, 167);
  assert.equal(billingPlans.monthly.period, "monthly");
  assert.equal(billingPlans.annual.period, "yearly");
});
test("checkout and webhook signatures bind exact bytes and fail closed", () => {
  const secret = "test_secret", payload = "pay_test|sub_test";
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  assert(verifySignature(payload, signature, secret));
  assert(!verifySignature("sub_test|pay_test", signature, secret));
  assert(!verifySignature(payload, signature, "other_secret"));
  assert(!verifySignature(payload, "bad", secret));
  assert(!verifySignature(payload, "z".repeat(64), secret));
  const raw = Buffer.from('{ "event": "subscription.charged" }');
  const webhook = createHmac("sha256", secret).update(raw).digest("hex");
  assert(verifySignature(raw, webhook, secret));
  assert(!verifySignature(JSON.stringify(JSON.parse(raw.toString())), webhook, secret));
});
test("missing credentials fail without leaking configuration", () => {
  const key = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_SECRET;
  assert.throws(billingConfig, /Payments are not available yet/);
  assert.equal(publicCatalogue().available, false);
  if (key !== undefined) process.env.RAZORPAY_KEY_SECRET = key;
});
