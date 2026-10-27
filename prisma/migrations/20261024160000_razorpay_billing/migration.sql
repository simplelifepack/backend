-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('monthly', 'annual');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingManaged" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL,
    "providerPlanId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "remoteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidThrough" TIMESTAMP(3),
    "nextChargeAt" TIMESTAMP(3),
    "cancelAtCycleEnd" BOOLEAN NOT NULL DEFAULT false,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_remoteId_key" ON "BillingSubscription"("remoteId");

-- CreateIndex
CREATE INDEX "BillingSubscription_userId_createdAt_idx" ON "BillingSubscription"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingPayment_subscriptionId_periodEnd_idx" ON "BillingPayment"("subscriptionId", "periodEnd");

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BillingSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One unresolved/renewing mandate per user. Confirm terminal state before replacement.
CREATE UNIQUE INDEX "BillingSubscription_one_open_per_user" ON "BillingSubscription" ("userId") WHERE status NOT IN ('cancelled', 'completed', 'expired', 'creation_failed');
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_amount_positive" CHECK ("amountPaise" > 0);
