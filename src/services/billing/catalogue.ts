export const billingPlans = {
  monthly: { id: "monthly", name: "Full plan · Monthly", amountPaise: 24900, currency: "INR", period: "monthly", interval: 1, totalCount: 120 },
  annual: { id: "annual", name: "Full plan · Annual", amountPaise: 199900, currency: "INR", period: "yearly", interval: 1, totalCount: 10 },
} as const;
export type PlanId = keyof typeof billingPlans;

export class BillingError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) { super(message); }
}
export function billingConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const planIds = { monthly: process.env.RAZORPAY_MONTHLY_PLAN_ID, annual: process.env.RAZORPAY_ANNUAL_PLAN_ID };
  if (!keyId || !keySecret || !webhookSecret || !planIds.monthly || !planIds.annual) {
    throw new BillingError("BILLING_NOT_CONFIGURED", "Payments are not available yet. Please try again later.", 503);
  }
  return { keyId, keySecret, webhookSecret, planIds: planIds as Record<PlanId, string> };
}
export function publicCatalogue() {
  let available = false;
  try { billingConfig(); available = true; } catch { /* Pricing remains public before credentials are provisioned. */ }
  const configuredButton = process.env.RAZORPAY_TEST_PAYMENT_BUTTON_ID;
  const testPaymentButtonId = configuredButton && /^pl_[a-zA-Z0-9]+$/.test(configuredButton) ? configuredButton : undefined;
  return { available: available || Boolean(testPaymentButtonId), ...(testPaymentButtonId ? { testPaymentButtonId } : {}), plans: billingPlans, annualMonthlyEquivalent: Math.round(billingPlans.annual.amountPaise / 1200), annualSavingsPaise: billingPlans.monthly.amountPaise * 12 - billingPlans.annual.amountPaise };
}
