import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { billingConfig, billingPlans, BillingError, type PlanId } from "./catalogue";
import { RazorpayProvider, ProviderRejection, verifySignature, providerPath, type BillingProvider, type ProviderPlan, type ProviderSubscription } from "./provider";
import { reconcileSubscription, terminalStatuses } from "./reconcile";
import { synchronizePaidTier } from "./entitlements";

export class BillingService {
  constructor(private db: PrismaClient, private provider?: BillingProvider) {}
  private gateway() { const config = billingConfig(); return this.provider ?? new RazorpayProvider(config.keyId, config.keySecret); }
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.$queryRaw<Array<{ accountTier: "free" | "paid"; billingManaged: boolean; scheduledDeletionAt: Date | null }>>`SELECT "accountTier", "billingManaged", "scheduledDeletionAt" FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!rows[0]) throw new BillingError("UNAUTHORIZED", "Unauthorized.", 401);
    return rows[0];
  }
  private async tier(tx: Prisma.TransactionClient, userId: string) {
    const user = await this.lock(tx, userId);
    return synchronizePaidTier(tx, userId, user.accountTier, user.billingManaged);
  }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(work, { maxWait: 15000, timeout: 60000 });
  }
  async status(userId: string, reconcile = true) {
    return this.transaction(async tx => {
      const user = await this.lock(tx, userId);
      let subscription = await tx.billingSubscription.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
      if (subscription && reconcile && subscription.status !== "creation_failed") subscription = await reconcileSubscription(tx, this.gateway(), subscription);
      const accountTier = await this.tier(tx, userId);
      return { accountTier, legacyPaid: accountTier === "paid" && !user.billingManaged, subscription };
    });
  }
  async checkout(userId: string, plan: PlanId) {
    const config = billingConfig(), provider = this.gateway(), price = billingPlans[plan];
    // Read-only provider check before reserving: an incorrectly configured Plan
    // must never charge a different amount/interval from the public catalogue.
    const remotePlan = await provider.request<ProviderPlan>(`plans/${providerPath(config.planIds[plan])}`);
    if (remotePlan.item.amount !== price.amountPaise || remotePlan.item.currency !== price.currency || remotePlan.period !== price.period || remotePlan.interval !== price.interval) {
      throw new BillingError("BILLING_PLAN_MISMATCH", "Payments are temporarily unavailable. Please contact support.", 503);
    }
    const reservation = await this.transaction(async tx => {
      const user = await this.lock(tx, userId);
      if (user.scheduledDeletionAt) throw new BillingError("BILLING_ACCOUNT_DELETING", "Cancel account deletion before subscribing.", 409);
      const existing = await tx.billingSubscription.findFirst({ where: { userId, status: { notIn: terminalStatuses } }, orderBy: { createdAt: "desc" } });
      if (existing) return { row: existing, create: false };
      if (await this.tier(tx, userId) === "paid") return { row: null, create: false };
      const row = await tx.billingSubscription.create({ data: { userId, plan, providerPlanId: config.planIds[plan], amountPaise: price.amountPaise, currency: price.currency } });
      return { row, create: true };
    });
    if (!reservation.row) return { alreadyPaid: true as const };
    let row = reservation.row;
    if (reservation.create) {
      // Persisted reservation survives API timeouts and process crashes. Never
      // rollback the attempt then blindly create a second remote subscription.
      try {
        const remote = await provider.request<ProviderSubscription>("subscriptions", { plan_id: row.providerPlanId, total_count: price.totalCount, quantity: 1, customer_notify: true, notes: { readinesAttemptId: row.id }, expire_by: Math.floor(Date.now() / 1000) + 86400 });
        row = await this.db.billingSubscription.update({ where: { id: row.id }, data: { remoteId: remote.id, status: remote.status } });
      } catch (error) {
        if (error instanceof ProviderRejection) await this.db.billingSubscription.updateMany({ where: { id: row.id, remoteId: null }, data: { status: "creation_failed" } });
        throw error;
      }
    }
    return this.transaction(async tx => {
      await this.lock(tx, userId);
      row = await reconcileSubscription(tx, provider, await tx.billingSubscription.findUniqueOrThrow({ where: { id: row.id } }));
      if (await this.tier(tx, userId) === "paid") return { alreadyPaid: true as const };
      if (row.plan !== plan) throw new BillingError("BILLING_PLAN_IN_PROGRESS", "Another billing plan is already in progress. Cancel it in Settings before choosing a different plan.", 409);
      if (!["created", "authenticated"].includes(row.status)) throw new BillingError("BILLING_SUBSCRIPTION_IN_PROGRESS", "Your subscription is already being processed. Check its status in Settings instead of starting another payment.", 409);
      return { alreadyPaid: false as const, keyId: config.keyId, subscriptionId: row.remoteId!, plan: billingPlans[row.plan] };
    });
  }
  async verify(userId: string, input: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) {
    return this.transaction(async tx => {
      await this.lock(tx, userId);
      const row = await tx.billingSubscription.findFirst({ where: { userId, remoteId: input.razorpay_subscription_id } });
      if (!row || !verifySignature(`${input.razorpay_payment_id}|${row.remoteId}`, input.razorpay_signature, billingConfig().keySecret)) throw new BillingError("BILLING_SIGNATURE_INVALID", "The payment could not be verified.");
      const subscription = await reconcileSubscription(tx, this.gateway(), row, input.razorpay_payment_id);
      return { accountTier: await this.tier(tx, userId), subscription };
    });
  }
  async cancel(userId: string) {
    return this.transaction(tx => this.cancelInTransaction(tx, userId));
  }
  // Account deletion uses the same lock/transaction to prevent a new checkout
  // between cancelling a mandate and marking the account for deletion.
  async cancelInTransaction(tx: Prisma.TransactionClient, userId: string) {
      await this.lock(tx, userId);
      let row = await tx.billingSubscription.findFirst({ where: { userId, status: { notIn: terminalStatuses } }, orderBy: { createdAt: "desc" } });
      if (!row) return { cancelled: true };
      const provider = this.gateway();
      row = await reconcileSubscription(tx, provider, row);
      if (!terminalStatuses.includes(row.status) && !row.cancelAtCycleEnd) {
        const atEnd = row.paidThrough && row.paidThrough > new Date() ? 1 : 0;
        await provider.request(`subscriptions/${providerPath(row.remoteId!)}/cancel`, { cancel_at_cycle_end: atEnd });
        await tx.billingSubscription.update({ where: { id: row.id }, data: { cancelAtCycleEnd: Boolean(atEnd) } });
        await reconcileSubscription(tx, provider, row);
      }
      await this.tier(tx, userId);
      return { cancelled: true };
  }
  async webhook(raw: Buffer, signature: string, eventId: string) {
    const config = billingConfig();
    if (!verifySignature(raw, signature, config.webhookSecret)) throw new BillingError("BILLING_SIGNATURE_INVALID", "Invalid webhook signature.");
    const body = JSON.parse(raw.toString("utf8")) as { event?: string; payload?: { subscription?: { entity?: { id?: string; notes?: Record<string, string> } }; payment?: { entity?: { id?: string; invoice_id?: string } }; refund?: { entity?: { payment_id?: string } } } };
    if (!eventId || eventId.length > 200 || !body.event) throw new BillingError("BILLING_WEBHOOK_INVALID", "Invalid webhook event.");
    const eventType = body.event;
    const hash = createHash("sha256").update(raw).digest("hex");
    // Transactional event insertion and entitlement update: failed processing is
    // retried by Razorpay; duplicate delivery cannot grant another paid period.
    return this.transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`;
      const duplicate = await tx.billingWebhookEvent.findUnique({ where: { id: eventId } });
      if (duplicate) {
        if (duplicate.payloadHash !== hash) throw new BillingError("BILLING_EVENT_CONFLICT", "Webhook event conflict.", 409);
        return { duplicate: true };
      }
      const entity = body.payload?.subscription?.entity;
      let payment = body.payload?.payment?.entity;
      const refundPaymentId = body.payload?.refund?.entity?.payment_id;
      if (!payment && refundPaymentId) payment = await this.gateway().request<{ id: string; invoice_id?: string }>(`payments/${providerPath(refundPaymentId)}`);
      let remoteId = entity?.id;
      if (!remoteId && payment?.invoice_id) {
        const invoice = await this.gateway().request<{ subscription_id?: string }>(`invoices/${providerPath(payment.invoice_id)}`);
        remoteId = invoice.subscription_id;
      }
      const local = remoteId ? await tx.billingSubscription.findFirst({ where: { OR: [{ remoteId }, ...(entity?.notes?.readinesAttemptId ? [{ id: entity.notes.readinesAttemptId, remoteId: null }] : [])] } }) : null;
      if (local) {
        await this.lock(tx, local.userId);
        const row = local.remoteId ? await tx.billingSubscription.findUniqueOrThrow({ where: { id: local.id } }) : await tx.billingSubscription.update({ where: { id: local.id }, data: { remoteId } });
        await reconcileSubscription(tx, this.gateway(), row, payment?.id);
        await this.tier(tx, local.userId);
      } else if (entity?.notes?.readinesAttemptId) throw new BillingError("BILLING_WEBHOOK_RETRY", "Subscription is not ready. Retry delivery.", 503);
      await tx.billingWebhookEvent.create({ data: { id: eventId, payloadHash: hash, eventType } });
      return { duplicate: false };
    });
  }
}
