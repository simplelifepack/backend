import { Prisma, type PrismaClient, type BillingInterval, type SubscriptionTier } from "@prisma/client";

import { prisma } from "../lib/prisma";

export type EntitlementModule = "home" | "packages" | "documents" | "health" | "wealth" | "trustCenter" | "legacy";
export type TrustModule = "DOCUMENTS" | "HEALTH" | "WEALTH";

export const PLAN_LIMIT_CODES = {
  feature: "PLAN_FEATURE_NOT_AVAILABLE",
  member: "PLAN_MEMBER_LIMIT_REACHED",
  storage: "PLAN_STORAGE_LIMIT_REACHED",
  aiSearch: "PLAN_AI_SEARCH_LIMIT_REACHED",
  trustDenied: "TRUST_ACCESS_DENIED",
  trustRevoked: "TRUST_MEMBER_REVOKED",
} as const;

const MB = 1024 * 1024;
const GB = 1024 * MB;

type PrismaTx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
type TrustAccessType = "VIEW_ONLY" | "FAMILY_MEMBER" | "EMERGENCY_ACCESS";

const ENTITLEMENT_CONFIG: Record<SubscriptionTier, {
  name: string;
  memberLimit: number;
  storageLimitBytes: number;
  aiSearchMonthlyLimit: number;
  modules: Record<EntitlementModule, boolean>;
  emergencyAccess: boolean;
}> = {
  FREE: {
    name: "Free",
    memberLimit: Number.MAX_SAFE_INTEGER,
    storageLimitBytes: 50 * MB,
    aiSearchMonthlyLimit: 1,
    modules: {
      home: true,
      packages: true,
      documents: true,
      trustCenter: true,
      legacy: true,
      health: false,
      wealth: false,
    },
    emergencyAccess: true,
  },
  PAID: {
    name: "Paid",
    memberLimit: Number.MAX_SAFE_INTEGER,
    storageLimitBytes: 50 * GB,
    aiSearchMonthlyLimit: 50,
    modules: {
      home: true,
      packages: true,
      documents: true,
      trustCenter: true,
      legacy: true,
      health: true,
      wealth: true,
    },
    emergencyAccess: true,
  },
};

const TRUST_ACCESS_DEFAULTS: Record<TrustAccessType, {
  canEdit: boolean;
  canManageMembers: boolean;
  emergencyOnly: boolean;
}> = {
  VIEW_ONLY: { canEdit: false, canManageMembers: false, emergencyOnly: false },
  FAMILY_MEMBER: { canEdit: false, canManageMembers: false, emergencyOnly: false },
  EMERGENCY_ACCESS: { canEdit: false, canManageMembers: false, emergencyOnly: true },
};

function currentUsagePeriod(date = new Date()) {
  const periodStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

function periodKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function entitlementError(code: string, message: string, metadata: Record<string, unknown>, statusCode = 403) {
  return Object.assign(new Error(message), { statusCode, code, metadata });
}

function isSubscriptionActive(status: string) {
  return ["active", "trialing"].includes(status.toLowerCase());
}

function subscriptionSortStatus(status: string) {
  return isSubscriptionActive(status) ? 0 : 1;
}

function resolveSubscriptionTier(subscriptions: Array<{ tier: SubscriptionTier; status: string }>): SubscriptionTier {
  const activePaid = subscriptions.some((subscription) => subscription.tier === "PAID" && isSubscriptionActive(subscription.status));
  return activePaid ? "PAID" : "FREE";
}

export async function getOrCreateCurrentUsage(userId: string, client: PrismaTx = prisma) {
  const { periodStart, periodEnd } = currentUsagePeriod();
  return client.usage.upsert({
    where: { userId_periodStart: { userId, periodStart } },
    update: { periodEnd },
    create: { userId, periodStart, periodEnd },
  });
}

async function getUserSubscriptions(userId: string, client: PrismaTx = prisma) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      subscriptions: {
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          tier: true,
          billingInterval: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          provider: true,
          providerCustomerId: true,
          providerSubscriptionId: true,
        },
      },
    },
  });
  if (!user) throw entitlementError(PLAN_LIMIT_CODES.feature, "User not found.", {}, 404);
  if (user.subscriptions.length) return user.subscriptions;

  const subscription = await client.subscription.create({
    data: { userId, tier: "FREE", billingInterval: null, status: "active" },
    select: {
      id: true,
      tier: true,
      billingInterval: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      provider: true,
      providerCustomerId: true,
      providerSubscriptionId: true,
    },
  });
  return [subscription];
}

export async function getAuthoritativeStorageUsage(userId: string, client: PrismaTx = prisma) {
  const documents = await client.document.findMany({
    where: { ownerProfileId: userId, deletedAt: null },
    select: { encryptedSize: true, size: true },
  });
  return documents.reduce((total, document) => total + Number(document.encryptedSize ?? document.size), 0);
}

export async function reconcileCurrentStorageUsage(userId: string, client: PrismaTx = prisma) {
  const usage = await getOrCreateCurrentUsage(userId, client);
  const storageBytesUsed = await getAuthoritativeStorageUsage(userId, client);
  if (Number(usage.storageBytesUsed) === storageBytesUsed) return usage;
  return client.usage.update({
    where: { id: usage.id },
    data: { storageBytesUsed },
  });
}

export async function getUserEntitlements(userId: string, client: PrismaTx = prisma) {
  const subscriptions = await getUserSubscriptions(userId, client);
  const usage = await getOrCreateCurrentUsage(userId, client);
  const sortedSubscriptions = [...subscriptions].sort((a, b) => subscriptionSortStatus(a.status) - subscriptionSortStatus(b.status));
  const subscription = sortedSubscriptions[0]!;
  const tier = resolveSubscriptionTier(subscriptions);
  const rules = ENTITLEMENT_CONFIG[tier];
  const storageBytesUsed = await getAuthoritativeStorageUsage(userId, client);
  if (Number(usage.storageBytesUsed) !== storageBytesUsed) {
    await client.usage.update({ where: { id: usage.id }, data: { storageBytesUsed } });
  }

  return {
    subscription: {
      id: subscription.id,
      tier,
      billingInterval: subscription.billingInterval as BillingInterval | null,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      provider: subscription.provider,
      providerCustomerId: subscription.providerCustomerId,
      providerSubscriptionId: subscription.providerSubscriptionId,
    },
    plan: { id: subscription.id, code: tier, name: rules.name },
    tier,
    billingInterval: subscription.billingInterval as BillingInterval | null,
    rules: {
      memberLimit: rules.memberLimit,
      storageBytes: rules.storageLimitBytes,
      storageLimitBytes: rules.storageLimitBytes,
      unknownPackSearchLimit: rules.aiSearchMonthlyLimit,
      aiSearchMonthlyLimit: rules.aiSearchMonthlyLimit,
      modules: rules.modules,
      emergencyAccess: rules.emergencyAccess,
      wealthEnabled: rules.modules.wealth,
      healthEnabled: rules.modules.health,
    },
    usage: {
      period: periodKey(usage.periodStart),
      periodStart: usage.periodStart.toISOString(),
      periodEnd: usage.periodEnd.toISOString(),
      unknownPackSearches: usage.aiPackSearchesUsed,
      aiPackSearchesUsed: usage.aiPackSearchesUsed,
      storageBytesUsed,
      aiSearchesRemaining: Math.max(0, rules.aiSearchMonthlyLimit - usage.aiPackSearchesUsed),
      resetAt: usage.periodEnd.toISOString(),
    },
  };
}

export async function assertModuleEntitlement(userId: string, module: EntitlementModule) {
  const entitlements = await getUserEntitlements(userId);
  if (entitlements.rules.modules[module]) return entitlements;
  throw entitlementError(PLAN_LIMIT_CODES.feature, "Your current subscription does not include this feature.", {
    currentTier: entitlements.tier,
    currentPlan: entitlements.tier,
    requiredTier: "PAID",
    requiredPlan: "PAID",
    module,
    upgradeRequired: true,
  });
}

export async function assertStorageAllowance(userId: string, incomingBytes: number) {
  const entitlements = await getUserEntitlements(userId);
  const currentUsage = entitlements.usage.storageBytesUsed;
  const limit = entitlements.rules.storageLimitBytes;
  if (currentUsage + incomingBytes <= limit) return entitlements;
  throw entitlementError(PLAN_LIMIT_CODES.storage, "Your storage limit has been reached.", {
    currentTier: entitlements.tier,
    currentPlan: entitlements.tier,
    currentUsage,
    incomingBytes,
    limit,
    upgradeRequired: true,
  }, 409);
}

export async function assertMemberAllowance(userId: string, client: PrismaTx = prisma) {
  const entitlements = await getUserEntitlements(userId, client);
  const memberCount = await client.trustMember.count({
    where: { ownerUserId: userId, status: { in: ["INVITED", "ACTIVE"] } },
  });
  if (memberCount < entitlements.rules.memberLimit) return { entitlements, memberCount };
  throw entitlementError(PLAN_LIMIT_CODES.member, "Your trusted member limit has been reached.", {
    currentTier: entitlements.tier,
    currentPlan: entitlements.tier,
    currentUsage: memberCount,
    limit: entitlements.rules.memberLimit,
    requiredTier: "PAID",
    requiredPlan: "PAID",
    upgradeRequired: true,
  }, 409);
}

export async function assertAiPackSearchAllowance(userId: string, client: PrismaTx = prisma) {
  const entitlements = await getUserEntitlements(userId, client);
  if (entitlements.usage.aiPackSearchesUsed < entitlements.rules.aiSearchMonthlyLimit) return entitlements;
  throw entitlementError(PLAN_LIMIT_CODES.aiSearch, "Your monthly AI package search limit has been reached.", {
    currentTier: entitlements.tier,
    currentPlan: entitlements.tier,
    currentUsage: entitlements.usage.aiPackSearchesUsed,
    limit: entitlements.rules.aiSearchMonthlyLimit,
    periodStart: entitlements.usage.periodStart,
    periodEnd: entitlements.usage.periodEnd,
    resetAt: entitlements.usage.resetAt,
    upgradeRequired: true,
  }, 429);
}

export async function incrementAiPackSearchUsage(userId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const entitlements = await assertAiPackSearchAllowance(userId, tx);
        const periodStart = new Date(entitlements.usage.periodStart);
        const updated = await tx.usage.updateMany({
          where: {
            userId,
            periodStart,
            aiPackSearchesUsed: { lt: entitlements.rules.aiSearchMonthlyLimit },
          },
          data: { aiPackSearchesUsed: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw entitlementError(PLAN_LIMIT_CODES.aiSearch, "Your monthly AI package search limit has been reached.", {
            currentTier: entitlements.tier,
            currentPlan: entitlements.tier,
            currentUsage: entitlements.usage.aiPackSearchesUsed,
            limit: entitlements.rules.aiSearchMonthlyLimit,
            periodStart: entitlements.usage.periodStart,
            periodEnd: entitlements.usage.periodEnd,
            resetAt: entitlements.usage.resetAt,
            upgradeRequired: true,
          }, 429);
        }
        return getUserEntitlements(userId, tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Unable to increment package search usage.");
}

export async function resolveEffectiveTrustPermissions(input: {
  ownerUserId: string;
  memberUserId: string;
  module: TrustModule;
}) {
  const membership = await prisma.trustMember.findFirst({
    where: { ownerUserId: input.ownerUserId, memberUserId: input.memberUserId },
    include: { permissions: true },
  });
  if (!membership) throw entitlementError(PLAN_LIMIT_CODES.trustDenied, "Trust access denied.", {}, 403);
  if (membership.status === "REVOKED") {
    throw entitlementError(PLAN_LIMIT_CODES.trustRevoked, "Trust member access has been revoked.", {}, 403);
  }
  if (membership.status !== "ACTIVE") throw entitlementError(PLAN_LIMIT_CODES.trustDenied, "Trust access is not active.", {}, 403);

  const moduleName = input.module === "DOCUMENTS" ? "documents" : input.module === "HEALTH" ? "health" : "wealth";
  await assertModuleEntitlement(input.ownerUserId, moduleName);
  const override = membership.permissions.find((permission) => permission.module === input.module);
  const defaults = TRUST_ACCESS_DEFAULTS[membership.accessType as TrustAccessType];
  return {
    canView: Boolean(override?.canView),
    canDownload: Boolean(override?.canDownload),
    canEdit: defaults.canEdit,
    canManageMembers: false,
    emergencyOnly: defaults.emergencyOnly,
  };
}
