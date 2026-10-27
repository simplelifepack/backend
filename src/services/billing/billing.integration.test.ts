import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { BillingService } from "./service";
import { TestProvider } from "./testProvider";
import { withPrivateUser } from "../../privacy/access";
import { synchronizePaidTier } from "./entitlements";

const url = process.env.BILLING_TEST_DATABASE_URL;
const isolated = Boolean(url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/readines_billing_test(?:\?|$)/.test(url));
test("billing lifecycle with real PostgreSQL transactions and a synthetic Razorpay boundary", { skip: !isolated }, async t => {
  process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
  process.env.RAZORPAY_KEY_ID = "rzp_test_synthetic";
  process.env.RAZORPAY_KEY_SECRET = "synthetic_checkout_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "synthetic_webhook_secret";
  process.env.RAZORPAY_MONTHLY_PLAN_ID = "plan_monthly"; process.env.RAZORPAY_ANNUAL_PLAN_ID = "plan_annual";
  process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "billing-test";
  process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ "billing-test": `base64:${randomBytes(32).toString("base64")}` });
  process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
  const { prisma } = await import("../../lib/prisma");
  const created: string[] = [];
  const fixture = async (tier: "free" | "paid" = "free") => {
    const id = randomUUID(); created.push(id);
    await withPrivateUser(id, () => prisma.user.create({ data: { id, name: "Billing test", email: `${id}@example.invalid`, accountTier: tier }, select: { id: true } }));
    const provider = new TestProvider(), service = new BillingService(prisma, provider);
    return { id, provider, service };
  };
  const signature = (payment: string, subscription: string) => createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!).update(`${payment}|${subscription}`).digest("hex");
  const verify = (service: BillingService, id: string, sub: string, payment: string) => service.verify(id, { razorpay_subscription_id: sub, razorpay_payment_id: payment, razorpay_signature: signature(payment, sub) });
  try {
    await t.test("monthly and annual checkout bind correct remote Plans; repeat and concurrent clicks reuse one subscription", async () => {
      for (const plan of ["annual", "monthly"] as const) {
        const { id, service, provider } = await fixture();
        const checkout = await service.checkout(id, plan); assert(!checkout.alreadyPaid);
        assert.equal(checkout.plan.amountPaise, plan === "annual" ? 199900 : 24900);
        const again = await Promise.all([service.checkout(id, plan), service.checkout(id, plan)]);
        assert(again.every(value => !value.alreadyPaid && value.subscriptionId === checkout.subscriptionId)); assert.equal(provider.creates, 1);
      }
    });
    await t.test("captured verified invoice activates paid access, duplicate verification is idempotent, forged signatures and ownership fail", async () => {
      const { id, service, provider } = await fixture(); const other = await fixture();
      const checkout = await service.checkout(id, "annual"); assert(!checkout.alreadyPaid);
      provider.charge(checkout.subscriptionId, "pay_success", 199900);
      await assert.rejects(service.verify(id, { razorpay_subscription_id: checkout.subscriptionId, razorpay_payment_id: "pay_success", razorpay_signature: "a".repeat(64) }), /could not be verified/);
      await assert.rejects(verify(service, other.id, checkout.subscriptionId, "pay_success"));
      assert.equal((await verify(service, id, checkout.subscriptionId, "pay_success")).accountTier, "paid");
      await verify(service, id, checkout.subscriptionId, "pay_success");
      assert.equal(await prisma.billingPayment.count({ where: { subscription: { userId: id } } }), 1);
      assert.equal((await service.checkout(id, "annual")).alreadyPaid, true); assert.equal(provider.creates, 1);
    });
    await t.test("authorisation alone, failed payments, incorrect amounts, and refunded invoices grant no paid entitlement", async () => {
      for (const [status, amount] of [["authorized", 24900], ["failed", 24900], ["captured", 100]] as const) {
        const { id, service, provider } = await fixture(); const checkout = await service.checkout(id, "monthly"); assert(!checkout.alreadyPaid);
        provider.charge(checkout.subscriptionId, `pay_nonpaid${status}`, amount, status);
        assert.equal((await verify(service, id, checkout.subscriptionId, `pay_nonpaid${status}`)).accountTier, "free");
      }
    });
    await t.test("duplicate concurrent webhooks do not double-grant; stale events fetch current provider state; refunds revoke access", async () => {
      const { id, service, provider } = await fixture(); const checkout = await service.checkout(id, "monthly"); assert(!checkout.alreadyPaid);
      provider.charge(checkout.subscriptionId, "pay_webhook", 24900);
      const raw = Buffer.from(JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: { id: checkout.subscriptionId } }, payment: { entity: { id: "pay_webhook" } } } }));
      const sign = (body: Buffer) => createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!).update(body).digest("hex");
      await assert.rejects(service.webhook(raw, "a".repeat(64), "evt_bad"));
      const responses = await Promise.all([service.webhook(raw, sign(raw), "evt_duplicate"), service.webhook(raw, sign(raw), "evt_duplicate")]);
      assert.equal(responses.filter(item => item.duplicate).length, 1);
      assert.equal((await service.status(id)).accountTier, "paid");
      provider.subscriptions.get(checkout.subscriptionId)!.status = "cancelled";
      await service.webhook(raw, sign(raw), "evt_old_active");
      assert.equal((await service.status(id)).subscription?.status, "cancelled");
      provider.payments.get("pay_webhook")!.amount_refunded = 24900;
      const refund = Buffer.from(JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { payment_id: "pay_webhook" } } } }));
      await service.webhook(refund, sign(refund), "evt_refund");
      assert.equal((await service.status(id)).accountTier, "free");
    });
    await t.test("renewal extends verified paid period, cancellation preserves paid time, expiry removes quota bypass without a webhook", async () => {
      const { id, service, provider } = await fixture(); const checkout = await service.checkout(id, "monthly"); assert(!checkout.alreadyPaid);
      provider.charge(checkout.subscriptionId, "pay_first", 24900);
      const first = await verify(service, id, checkout.subscriptionId, "pay_first");
      provider.charge(checkout.subscriptionId, "pay_renew", 24900, "captured", Math.floor(Date.now() / 1000) + 86400 * 60);
      const renewed = await verify(service, id, checkout.subscriptionId, "pay_renew");
      assert(renewed.subscription.paidThrough! > first.subscription.paidThrough!);
      await service.cancel(id); assert.equal((await service.status(id)).accountTier, "paid");
      assert.equal((await service.status(id)).subscription?.cancelAtCycleEnd, true);
      await prisma.billingSubscription.updateMany({ where: { userId: id }, data: { paidThrough: new Date(0) } });
      const tier = await prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`; return synchronizePaidTier(tx, id, "paid", true); });
      assert.equal(tier, "free");
    });
    await t.test("legacy paid users are not billed, unavailable config and mismatched remote prices fail closed", async () => {
      const { id, service, provider } = await fixture("paid");
      assert.equal((await service.checkout(id, "annual")).alreadyPaid, true); assert.equal(provider.creates, 0);
      assert.equal((await service.status(id)).legacyPaid, true);
      const free = await fixture(); free.provider.mismatch = true;
      await assert.rejects(free.service.checkout(free.id, "annual"), /temporarily unavailable/);
      const saved = process.env.RAZORPAY_KEY_SECRET; delete process.env.RAZORPAY_KEY_SECRET;
      await assert.rejects(free.service.checkout(free.id, "monthly"), /not available yet/); process.env.RAZORPAY_KEY_SECRET = saved;
    });
    await t.test("ambiguous provider create is recovered, never blindly retried or duplicated", async () => {
      const { id, service, provider } = await fixture(); provider.timeoutAfterCreate = true;
      await assert.rejects(service.checkout(id, "monthly"), /timeout/);
      const recovered = await service.checkout(id, "monthly"); assert(!recovered.alreadyPaid); assert.equal(provider.creates, 1);
      const unknown = await fixture(); unknown.provider.rejectBeforeCreate = true;
      await assert.rejects(unknown.service.checkout(unknown.id, "annual"));
      unknown.provider.rejectBeforeCreate = false;
      await assert.rejects(unknown.service.checkout(unknown.id, "annual"), /previous checkout is still being confirmed/); assert.equal(unknown.provider.creates, 0);
    });
    await t.test("HTTP routes require authentication, reject forged amounts, preserve raw webhook bytes and enforce owner access", async () => {
      const { id, service, provider } = await fixture();
      const { default: express } = await import("express");
      const { billingRouter } = await import("../../routes/billing.routes");
      const { signAccessToken } = await import("../../utils/jwt");
      const app = express(); app.use("/api/billing", billingRouter(service));
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address(); assert(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api/billing`;
      const token = signAccessToken({ sub: id, authVersion: 0 });
      const post = (path: string, data: unknown, auth = true) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
      try {
        assert.equal((await fetch(base + "/plans")).status, 200);
        assert.equal((await post("/checkout", { plan: "annual" }, false)).status, 401);
        assert.equal((await post("/checkout", { plan: "annual", amount: 1 })).status, 400);
        assert.equal((await post("/checkout", { plan: "early" })).status, 400);
        const response = await post("/checkout", { plan: "annual" }); assert.equal(response.status, 200);
        const checkout = await response.json() as { subscriptionId: string };
        provider.charge(checkout.subscriptionId, "pay_http", 199900);
        const raw = '{ "event": "subscription.charged", "payload": { "subscription": { "entity": { "id": "' + checkout.subscriptionId + '" } } } }';
        const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest("hex");
        const webhook = await fetch(base + "/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_http" }, body: raw });
        assert.equal(webhook.status, 200);
        assert.equal((await service.status(id)).accountTier, "paid");
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    });
    await t.test("provider outages leave persisted entitlement and retryable state intact", async () => {
      const { id, service, provider } = await fixture(); await service.checkout(id, "monthly"); provider.unavailable = true;
      await assert.rejects(service.status(id)); provider.unavailable = false;
      assert.equal((await service.status(id)).accountTier, "free");
      assert.equal(provider.creates, 1);
    });
  } finally {
    await prisma.billingWebhookEvent.deleteMany({ where: { id: { startsWith: "evt_" } } });
    for (const id of created) await withPrivateUser(id, () => prisma.user.deleteMany({ where: { id } }));
    await prisma.$disconnect();
  }
});
