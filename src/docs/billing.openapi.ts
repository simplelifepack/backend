import type { Operation } from "./openapi";
import { billingPlans } from "../services/billing/catalogue";

type Schema = Record<string, unknown>;
const string = { type: "string" };
const dateTime = { ...string, format: "date-time" };
const nullable = (schema: Schema) => ({ ...schema, nullable: true });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", properties, required });
const secured = [{ bearerAuth: [] as string[] }];
const response = (description: string, schema: Schema, example?: unknown) => ({ description, content: { "application/json": { schema, ...(example ? { example } : {}) } } });
const error = (description: string) => response(description, { $ref: "#/components/schemas/ErrorResponse" });
const errors = { 400: error("Invalid plan, signature or payment"), 401: error("Authentication required"), 403: error("Origin policy or account access denied"), 409: error("Existing/uncertain subscription; do not create another mandate"), 429: error("Request rate limit exceeded"), 502: error("Provider temporarily unavailable; retry safely"), 503: error("Recurring billing is not configured or requires support review") };
const body = (properties: Record<string, Schema>, required: string[], example?: unknown) => ({ required: true, content: { "application/json": { schema: { ...object(properties, required), additionalProperties: false }, ...(example ? { example } : {}) } } });
const plan = object({ id: { ...string, enum: ["monthly", "annual"] }, name: string, amountPaise: { type: "integer", minimum: 1 }, currency: { ...string, enum: ["INR"] }, period: { ...string, enum: ["monthly", "yearly"] }, interval: { type: "integer", minimum: 1 }, totalCount: { type: "integer", minimum: 1 } }, ["id", "name", "amountPaise", "currency", "period", "interval", "totalCount"]);
const subscription = object({
  id: string, userId: string, plan: { ...string, enum: ["monthly", "annual"] }, providerPlanId: string, amountPaise: { type: "integer" }, currency: string,
  remoteId: nullable(string), status: string, periodStart: nullable(dateTime), periodEnd: nullable(dateTime), paidThrough: nullable(dateTime), nextChargeAt: nullable(dateTime), cancelAtCycleEnd: { type: "boolean" }, lastReconciledAt: nullable(dateTime), createdAt: dateTime, updatedAt: dateTime,
}, ["id", "userId", "plan", "providerPlanId", "amountPaise", "currency", "remoteId", "status", "periodStart", "periodEnd", "paidThrough", "nextChargeAt", "cancelAtCycleEnd", "lastReconciledAt", "createdAt", "updatedAt"]);
const status = object({ accountTier: { ...string, enum: ["free", "paid"] }, legacyPaid: { type: "boolean", description: "Present on GET /subscription; existing manually provisioned paid account." }, subscription: nullable(subscription) }, ["accountTier", "subscription"]);

export const billingOperations: Operation[] = [
  {
    method: "get", path: "/api/billing/plans", tags: ["Billing"], summary: "Public server-owned Full plan prices", operationId: "billingPlans", security: [],
    description: "Amounts are in paise: ₹249 monthly / ₹1,999 annually. available=true means recurring configuration is present OR a hosted test button is configured; it does not prove recurring credentials are valid. Optional testPaymentButtonId identifies the hosted test button, which does not activate subscriptions or paid entitlements. No API secret or provider Plan ID is exposed.",
    responses: { 200: response("Current pricing and checkout availability", object({ available: { type: "boolean" }, testPaymentButtonId: { ...string, pattern: "^pl_[a-zA-Z0-9]+$" }, plans: object({ monthly: plan, annual: plan }, ["monthly", "annual"]), annualMonthlyEquivalent: { type: "integer" }, annualSavingsPaise: { type: "integer" } }, ["available", "plans", "annualMonthlyEquivalent", "annualSavingsPaise"]), { available: false, plans: billingPlans, annualMonthlyEquivalent: 167, annualSavingsPaise: 98900 }), 403: errors[403], 429: errors[429] },
  },
  {
    method: "post", path: "/api/billing/checkout", tags: ["Billing"], summary: "Create or reuse an authenticated recurring subscription", operationId: "billingCheckout", security: secured,
    description: "Accepts only plan. Validates provider amount/currency/interval against the backend catalogue. Reuses unresolved checkout and blocks duplicate mandates for paid users. Hosted test-button availability does not enable this endpoint; recurring credentials, Plan IDs and webhook secret must be configured.",
    requestBody: body({ plan: { ...string, enum: ["monthly", "annual"] } }, ["plan"], { plan: "annual" }),
    responses: { 200: response("Already paid, or authoritative Checkout configuration", { oneOf: [object({ alreadyPaid: { type: "boolean", const: true } }, ["alreadyPaid"]), object({ alreadyPaid: { type: "boolean", const: false }, keyId: string, subscriptionId: { ...string, pattern: "^sub_[a-zA-Z0-9]+$" }, plan }, ["alreadyPaid", "keyId", "subscriptionId", "plan"])] }), ...errors },
  },
  {
    method: "post", path: "/api/billing/verify", tags: ["Billing"], summary: "Verify checkout signature and captured invoice payment", operationId: "billingVerify", security: secured,
    description: "Validates payment_id|stored_subscription_id using the server secret, then fetches authoritative payment, invoice and subscription. Mandate authorization or a successful browser callback alone grants no paid access.",
    requestBody: body({ razorpay_payment_id: { ...string, pattern: "^pay_[a-zA-Z0-9]+$" }, razorpay_subscription_id: { ...string, pattern: "^sub_[a-zA-Z0-9]+$" }, razorpay_signature: { ...string, pattern: "^[a-fA-F0-9]{64}$" } }, ["razorpay_payment_id", "razorpay_subscription_id", "razorpay_signature"]),
    responses: { 200: response("Verified account tier and subscription", status), ...errors },
  },
  {
    method: "get", path: "/api/billing/subscription", tags: ["Billing"], summary: "Reconcile and return own subscription", operationId: "billingSubscription", security: secured,
    description: "Fetches current provider state rather than trusting webhook ordering. Preserves legacy paid accounts and computes access from verified paid periods.",
    responses: { 200: response("Account tier, legacyPaid and nullable subscription", { ...status, required: ["accountTier", "legacyPaid", "subscription"] }, { accountTier: "free", legacyPaid: false, subscription: null }), ...errors },
  },
  {
    method: "post", path: "/api/billing/cancel", tags: ["Billing"], summary: "Cancel own automatic renewal", operationId: "billingCancel", security: secured,
    description: "Cancels at cycle end when paid time remains, otherwise immediately. Idempotent; existing verified paid time is retained.", responses: { 200: response("Cancellation confirmed", object({ cancelled: { type: "boolean", const: true } }, ["cancelled"]), { cancelled: true }), ...errors },
  },
  {
    method: "post", path: "/api/billing/webhook", tags: ["Billing"], summary: "Receive signed Razorpay subscription/payment/refund events", operationId: "billingWebhook", security: [],
    description: "Requires the original raw JSON body (maximum 256 KB), HMAC-SHA256 X-Razorpay-Signature and unique X-Razorpay-Event-Id. Sign the exact bytes sent; editing Swagger's sample body invalidates an existing signature. No bearer token is required, but signature validation is mandatory. Event insertion and entitlement changes share one transaction. A repeated event ID with different content returns 409.",
    parameters: [{ name: "X-Razorpay-Signature", in: "header", required: true, schema: { ...string, pattern: "^[a-fA-F0-9]{64}$" } }, { name: "X-Razorpay-Event-Id", in: "header", required: true, schema: { ...string, minLength: 1, maxLength: 200 } }],
    requestBody: { required: true, content: { "application/json": { schema: object({ event: { ...string, minLength: 1 }, payload: { type: "object", additionalProperties: true } }, ["event"]), example: { event: "subscription.charged", payload: { subscription: { entity: { id: "sub_example" } }, payment: { entity: { id: "pay_example" } } } } } } },
    responses: { 200: response("Processed or duplicate event acknowledged", object({ duplicate: { type: "boolean" } }, ["duplicate"]), { duplicate: false }), ...errors },
  },
];
