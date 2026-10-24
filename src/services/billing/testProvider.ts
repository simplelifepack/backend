import { randomUUID } from "node:crypto";
import type { BillingProvider, ProviderInvoice, ProviderPayment, ProviderPlan, ProviderSubscription } from "./provider";
import { billingPlans } from "./catalogue";

export class TestProvider implements BillingProvider {
  subscriptions = new Map<string, ProviderSubscription>();
  invoices = new Map<string, ProviderInvoice>();
  payments = new Map<string, ProviderPayment>();
  creates = 0;
  timeoutAfterCreate = false;
  rejectBeforeCreate = false;
  mismatch = false;
  unavailable = false;
  async request<T>(path: string, body?: unknown): Promise<T> {
    if (this.unavailable) throw new Error("Synthetic provider outage");
    let result: unknown;
    if (path.startsWith("plans/")) {
      const plan = path.includes("annual") ? billingPlans.annual : billingPlans.monthly;
      result = { id: path.slice(6), period: plan.period, interval: 1, item: { amount: this.mismatch ? 1 : plan.amountPaise, currency: "INR" } } satisfies ProviderPlan;
    } else if (path === "subscriptions") {
      if (this.rejectBeforeCreate) throw new Error("Synthetic timeout before response");
      const input = body as { plan_id: string; notes: Record<string, string> };
      this.creates++;
      const id = `sub_test${randomUUID().replace(/-/g, "")}`;
      result = { id, plan_id: input.plan_id, status: "created", quantity: 1, current_start: null, current_end: null, charge_at: null, notes: input.notes } satisfies ProviderSubscription;
      this.subscriptions.set(id, result as ProviderSubscription);
      if (this.timeoutAfterCreate) { this.timeoutAfterCreate = false; throw new Error("Synthetic timeout after create"); }
    } else if (path.startsWith("subscriptions?")) result = { items: [...this.subscriptions.values()] };
    else if (path.endsWith("/cancel")) {
      const row = this.subscriptions.get(path.split("/")[1])!;
      if (!(body as { cancel_at_cycle_end: number }).cancel_at_cycle_end) row.status = "cancelled";
      result = row;
    } else if (path.startsWith("subscriptions/")) result = this.subscriptions.get(path.split("/")[1]);
    else if (path.startsWith("invoices?")) { const id = new URLSearchParams(path.split("?")[1]).get("subscription_id"); result = { items: [...this.invoices.values()].filter(item => item.subscription_id === id) }; }
    else if (path.startsWith("invoices/")) result = this.invoices.get(path.slice(9));
    else if (path.startsWith("payments/")) result = this.payments.get(path.slice(9));
    else throw new Error(`Unsupported test provider path: ${path}`);
    if (!result) throw new Error("Synthetic missing provider record");
    return structuredClone(result) as T;
  }
  charge(remoteId: string, id: string, amount: number, status = "captured", end = Math.floor(Date.now() / 1000) + 86400 * 30) {
    const start = Math.floor(Date.now() / 1000) - 60;
    const subscription = this.subscriptions.get(remoteId)!;
    Object.assign(subscription, { status: status === "captured" ? "active" : "pending", current_start: start, current_end: end, charge_at: end });
    this.payments.set(id, { id, invoice_id: `inv_${id}`, order_id: `order_${id}`, amount, currency: "INR", status, amount_refunded: 0 });
    this.invoices.set(`inv_${id}`, { id: `inv_${id}`, subscription_id: remoteId, payment_id: id, order_id: `order_${id}`, amount, currency: "INR", status: status === "captured" ? "paid" : "issued", billing_start: start, billing_end: end });
  }
}
