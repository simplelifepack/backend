import { withPrivateUser } from "../../privacy/access";
import type { BillingSubscription, Prisma } from "@prisma/client";
import { BillingError } from "./catalogue";
import type { BillingProvider, ProviderInvoice, ProviderPayment, ProviderSubscription } from "./provider";
import { providerPath } from "./provider";

const date = (seconds: number | null | undefined) => seconds && Number.isSafeInteger(seconds) ? new Date(seconds * 1000) : null;
export const terminalStatuses = ["cancelled", "completed", "expired", "creation_failed"];

export async function recoverRemote(provider: BillingProvider, row: BillingSubscription) {
  // A timed-out create is ambiguous. Search by our persisted attempt ID, never
  // issue another create until the original result has been recovered.
  for (let skip = 0; skip < 10000; skip += 100) {
    const page = await provider.request<{ items: ProviderSubscription[] }>(`subscriptions?count=100&skip=${skip}`);
    const match = page.items.find(item => item.notes?.readinesAttemptId === row.id);
    if (match) return match;
    if (page.items.length < 100) break;
  }
  throw new BillingError("BILLING_CREATION_PENDING", "Your previous checkout is still being confirmed. Retry shortly; if this continues, contact support. No second subscription will be created.", 409);
}

export function assertRemote(row: BillingSubscription, remote: ProviderSubscription) {
  if (remote.id !== row.remoteId || remote.plan_id !== row.providerPlanId || remote.quantity !== 1) {
    throw new BillingError("BILLING_PROVIDER_MISMATCH", "The subscription could not be verified. Please contact support.", 502);
  }
}

async function saveInvoicePayment(tx: Prisma.TransactionClient, provider: BillingProvider, row: BillingSubscription, invoice: ProviderInvoice, paymentId: string) {
  const payment = await provider.request<ProviderPayment>(`payments/${providerPath(paymentId)}`);
  if (invoice.subscription_id !== row.remoteId || payment.invoice_id !== invoice.id || invoice.order_id !== payment.order_id || payment.id !== paymentId) {
    throw new BillingError("BILLING_PAYMENT_MISMATCH", "The payment does not belong to this subscription.");
  }
  const start = date(invoice.billing_start), end = date(invoice.billing_end);
  const qualifies = invoice.status === "paid" && invoice.payment_id === payment.id && payment.status === "captured" &&
    payment.amount === row.amountPaise && invoice.amount === row.amountPaise && payment.currency === row.currency && invoice.currency === row.currency &&
    payment.amount_refunded === 0 && start && end && end > start;
  await tx.billingPayment.upsert({
    where: { id: payment.id },
    create: { id: payment.id, subscriptionId: row.id, invoiceId: invoice.id, amountPaise: payment.amount, currency: payment.currency, status: payment.status, refundedPaise: payment.amount_refunded, periodStart: qualifies ? start : null, periodEnd: qualifies ? end : null },
    update: { status: payment.status, refundedPaise: payment.amount_refunded, periodStart: qualifies ? start : null, periodEnd: qualifies ? end : null },
  });
}

export async function reconcileSubscription(tx: Prisma.TransactionClient, provider: BillingProvider, original: BillingSubscription, paymentId?: string) {
  let row = original;
  if (!row.remoteId) {
    const recovered = await recoverRemote(provider, row);
    row = await tx.billingSubscription.update({ where: { id: row.id }, data: { remoteId: recovered.id } });
  }
  const remote = await provider.request<ProviderSubscription>(`subscriptions/${providerPath(row.remoteId!)}`);
  assertRemote(row, remote);
  if (paymentId) {
    const payment = await provider.request<ProviderPayment>(`payments/${providerPath(paymentId)}`);
    if (payment.invoice_id) {
      const invoice = await provider.request<ProviderInvoice>(`invoices/${providerPath(payment.invoice_id)}`);
      await saveInvoicePayment(tx, provider, row, invoice, paymentId);
    }
    // Small mandate authorisation payments without a paid billing invoice grant no access.
  }
  // The invoice period, rather than subscription.active or current_end alone,
  // proves which service period has actually been paid for.
  const invoices: ProviderInvoice[] = [];
  for (let skip = 0; ; skip += 100) {
    if (skip >= 1000) throw new BillingError("BILLING_RECONCILIATION_LIMIT", "This subscription needs a support review.", 503);
    const page = await provider.request<{ items: ProviderInvoice[] }>(`invoices?subscription_id=${providerPath(row.remoteId!)}&count=100&skip=${skip}`);
    invoices.push(...page.items);
    if (page.items.length < 100) break;
  }
  const latestPaid = invoices.filter(item => item.status === "paid" && item.payment_id && item.billing_end)
    .sort((a, b) => (b.billing_end ?? 0) - (a.billing_end ?? 0))[0];
  if (latestPaid?.payment_id) await saveInvoicePayment(tx, provider, row, latestPaid, latestPaid.payment_id);
  const paid = await tx.billingPayment.findFirst({ where: { subscriptionId: row.id, status: "captured", refundedPaise: 0, periodStart: { lte: new Date() }, periodEnd: { not: null } }, orderBy: { periodEnd: "desc" } });
  const updated = await tx.billingSubscription.update({ where: { id: row.id }, data: {
    status: remote.status, periodStart: date(remote.current_start), periodEnd: date(remote.current_end),
    nextChargeAt: date(remote.charge_at), paidThrough: paid?.periodEnd ?? null, lastReconciledAt: new Date(),
  } });
  if (paid) await withPrivateUser(row.userId, () => tx.user.update({ where: { id: row.userId }, data: { billingManaged: true }, select: { id: true } }));
  return updated;
}
