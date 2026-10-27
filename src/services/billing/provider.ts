import { createHmac, timingSafeEqual } from "node:crypto";
import { BillingError } from "./catalogue";

export type ProviderSubscription = {
  id: string; plan_id: string; status: string; quantity: number;
  current_start: number | null; current_end: number | null; charge_at: number | null;
  notes: Record<string, string>; remaining_count?: number;
};
export type ProviderPayment = { id: string; invoice_id: string | null; order_id: string | null; amount: number; currency: string; status: string; amount_refunded: number };
export type ProviderInvoice = { id: string; subscription_id: string; payment_id: string | null; order_id: string; status: string; amount: number; currency: string; billing_start: number | null; billing_end: number | null };
export type ProviderPlan = { id: string; period: string; interval: number; item: { amount: number; currency: string } };
export interface BillingProvider {
  request<T>(path: string, body?: unknown): Promise<T>;
}
export class ProviderRejection extends BillingError {
  constructor() { super("BILLING_PROVIDER_REJECTED", "The payment service rejected this request. Please retry or contact support.", 502); }
}
export class RazorpayProvider implements BillingProvider {
  constructor(private keyId: string, private keySecret: string) {}
  async request<T>(path: string, body?: unknown): Promise<T> {
    try {
      const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
      });
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) throw new ProviderRejection();
      if (!response.ok) throw new BillingError("BILLING_PROVIDER_UNAVAILABLE", "The payment service could not complete this request. Please retry or contact support.", 502);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError("BILLING_PROVIDER_UNAVAILABLE", "The payment service is unavailable. Please retry shortly.", 502);
    }
  }
}
export function verifySignature(payload: string | Buffer, signature: string, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export const providerPath = (id: string) => encodeURIComponent(id);
