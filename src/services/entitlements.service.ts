import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../lib/prisma";

export type PlanCode = "FREEMIUM" | "FAMILY" | "PLUS";
export type EntitlementModule = "home" | "packages" | "documents" | "health" | "wealth" | "trustCenter";
export type TrustModule = "DOCUMENTS" | "HEALTH" | "WEALTH";

export const PLAN_LIMIT_CODES = {
  feature: "PLAN_FEATURE_NOT_AVAILABLE",
  member: "PLAN_MEMBER_LIMIT_REACHED",
  storage: "PLAN_STORAGE_LIMIT_REACHED",
  aiSearch: "PLAN_AI_SEARCH_LIMIT_REACHED",
  trustDenied: "TRUST_ACCESS_DENIED",
  trustRevoked: "TRUST_MEMBER_REVOKED",
} as const;

type PrismaTx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

type UserPlan = NonNullable<Awaited<ReturnType<typeof getUserPlan>>>;
type TrustAccessType = "VIEW_ONLY" | "FAMILY_MEMBER" | "EMERGENCY_ACCESS";

const TRUST_ACCESS_DEFAULTS: Record<TrustAccessType, {
  canEdit: boolean;
  canManageMembers: boolean;
  emergencyOnly: boolean;
}> = {
  VIEW_ONLY: { canEdit: false, canManageMembers: false, emergencyOnly: false },
  FAMILY_MEMBER: { canEdit: false, canManageMembers: false, emergencyOnly: false },
  EMERGENCY_ACCESS: { canEdit: false, canManageMembers: false, emergencyOnly: true },
};

function currentMonthlyPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextPeriodStart(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1)).toISOString();
}

function entitlementError(code: string, message: string, metadata: Record<string, unknown>, statusCode = 403) {
  return Object.assign(new Error(message), { statusCode, code, metadata });
}

function moduleAccess(userPlan: UserPlan, module: EntitlementModule) {
  const plan = userPlan.plan!;
  if (module === "trustCenter") return true;
  return {
    home: plan.homeAccess,
    packages: plan.packagesAccess,
    documents: plan.documentsAccess,
    health: plan.healthAccess,
    wealth: plan.wealthAccess,
    trustCenter: plan.trustCenterAccess,
  }[module];
}

function requiredPlanFor(module: EntitlementModule): PlanCode {
  if (module === "wealth") return "PLUS";
  if (module === "health") return "FAMILY";
  return "FREEMIUM";
}

export async function getUserPlan(userId: string, client: PrismaTx = prisma) {
  return client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      plan: {
        select: {
          id: true,
          code: true,
          name: true,
          memberLimit: true,
          storageBytes: true,
          unknownPackSearchLimit: true,
          homeAccess: true,
          packagesAccess: true,
          documentsAccess: true,
          healthAccess: true,
          wealthAccess: true,
          trustCenterAccess: true,
          emergencyAccess: true,
        },
      },
    },
  });
}

export async function getUserEntitlements(userId: string, client: PrismaTx = prisma) {
  const userPlan = await getUserPlan(userId, client);
  if (!userPlan?.plan) {
    throw entitlementError(PLAN_LIMIT_CODES.feature, "Plan entitlements are not configured.", {}, 500);
  }
  const plan = userPlan.plan;
  const period = currentMonthlyPeriod();
  const usage = await client.planUsage.upsert({
    where: { userId_period: { userId, period } },
    update: {},
    create: { userId, period },
  });
  const storageBytesUsed = await getAuthoritativeStorageUsage(userId, client);

  return {
    plan: { id: plan.id, code: plan.code as PlanCode, name: plan.name },
    rules: {
      memberLimit: plan.memberLimit,
      storageBytes: Number(plan.storageBytes),
      unknownPackSearchLimit: plan.unknownPackSearchLimit,
      modules: {
        home: plan.homeAccess,
        packages: plan.packagesAccess,
        documents: plan.documentsAccess,
        health: plan.healthAccess,
        wealth: plan.wealthAccess,
        trustCenter: true,
      },
      emergencyAccess: plan.emergencyAccess,
    },
    usage: {
      period,
      unknownPackSearches: usage.unknownPackSearches,
      storageBytesUsed,
      aiSearchesRemaining: Math.max(0, plan.unknownPackSearchLimit - usage.unknownPackSearches),
      resetAt: nextPeriodStart(period),
    },
  };
}

export async function assertModuleEntitlement(userId: string, module: EntitlementModule) {
  const userPlan = await getUserPlan(userId);
  if (!userPlan?.plan || !moduleAccess(userPlan, module)) {
    const currentPlan = userPlan?.plan?.code ?? "FREEMIUM";
    throw entitlementError(PLAN_LIMIT_CODES.feature, "Your current plan does not include this feature.", {
      currentPlan,
      requiredPlan: requiredPlanFor(module),
      module,
      upgradeRequired: true,
    });
  }
}

export async function getAuthoritativeStorageUsage(userId: string, client: PrismaTx = prisma) {
  const aggregate = await client.document.aggregate({
    where: { ownerProfileId: userId, deletedAt: null },
    _sum: { encryptedSize: true, size: true },
  });
  return Number(aggregate._sum.encryptedSize ?? aggregate._sum.size ?? 0);
}

export async function assertStorageAllowance(userId: string, incomingBytes: number) {
  const entitlements = await getUserEntitlements(userId);
  const currentUsage = entitlements.usage.storageBytesUsed;
  const limit = entitlements.rules.storageBytes;
  if (currentUsage + incomingBytes <= limit) return;
  throw entitlementError(PLAN_LIMIT_CODES.storage, "Your storage limit has been reached.", {
    currentPlan: entitlements.plan.code,
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
  throw entitlementError(PLAN_LIMIT_CODES.member, "Your member limit has been reached.", {
    currentPlan: entitlements.plan.code,
    currentUsage: memberCount,
    limit: entitlements.rules.memberLimit,
    requiredPlan: entitlements.plan.code === "FREEMIUM" ? "FAMILY" : "PLUS",
    upgradeRequired: true,
  }, 409);
}

export async function assertAndIncrementUnknownPackSearch(userId: string) {
  const period = currentMonthlyPeriod();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const entitlements = await getUserEntitlements(userId, tx);
        await tx.planUsage.upsert({
          where: { userId_period: { userId, period } },
          update: {},
          create: { userId, period },
        });
        const updated = await tx.planUsage.updateMany({
          where: {
            userId,
            period,
            unknownPackSearches: { lt: entitlements.rules.unknownPackSearchLimit },
          },
          data: { unknownPackSearches: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw entitlementError(PLAN_LIMIT_CODES.aiSearch, "Your monthly AI package search limit has been reached.", {
            currentPlan: entitlements.plan.code,
            currentUsage: entitlements.usage.unknownPackSearches,
            limit: entitlements.rules.unknownPackSearchLimit,
            period,
            resetAt: nextPeriodStart(period),
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
