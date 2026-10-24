import "dotenv/config";
import { billingPlans } from "../services/billing/catalogue";
import { RazorpayProvider, type ProviderPlan } from "../services/billing/provider";

async function main() {
  const keyId = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId?.startsWith("rzp_test_") || !secret) throw new Error("Configure Razorpay test credentials. This setup command refuses live keys.");
  const provider = new RazorpayProvider(keyId, secret);
  for (const [id, plan] of Object.entries(billingPlans)) {
    const envName = `RAZORPAY_${id.toUpperCase()}_PLAN_ID`;
    if (process.env[envName]) { console.log(`${envName} is already configured; skipped.`); continue; }
    // Search existing plans first so rerunning setup after a timeout does not
    // blindly duplicate catalogue entries. Never print credentials or API bodies.
    let found: ProviderPlan | undefined;
    for (let skip = 0; skip < 10000; skip += 100) {
      const page = await provider.request<{ items: ProviderPlan[] }>(`plans?count=100&skip=${skip}`);
      found = page.items.find(item => item.item.amount === plan.amountPaise && item.item.currency === plan.currency && item.period === plan.period && item.interval === plan.interval);
      if (found || page.items.length < 100) break;
    }
    found ??= await provider.request<ProviderPlan>("plans", { period: plan.period, interval: plan.interval, item: { name: plan.name, amount: plan.amountPaise, currency: plan.currency } });
    console.log(`${envName}=${found.id}`);
  }
}
main().catch(() => { console.error("Plan setup failed. Check test credentials and Razorpay availability, then retry."); process.exitCode = 1; });
