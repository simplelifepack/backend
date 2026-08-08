import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { assertMemberAllowance, assertModuleEntitlement, getUserEntitlements } from "./entitlements.service";
import * as emailService from "./email/emailService";

const relations = ["SPOUSE", "PARENT", "CHILD", "SIBLING", "GUARDIAN", "RELATIVE", "FRIEND", "OTHER"] as const;
const bloodGroups = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] as const;
const trustModules = ["DOCUMENTS", "HEALTH", "WEALTH"] as const;
const INVITE_TTL_HOURS = 24;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

const accessTypes = [
  {
    id: "VIEW_ONLY",
    code: "VIEW_ONLY",
    name: "View only",
    description: "Can only view explicitly permitted modules. No editing or member management.",
  },
  {
    id: "FAMILY_MEMBER",
    code: "FAMILY_MEMBER",
    name: "Family member",
    description: "Ongoing access to explicitly permitted modules. No editing owner data or member management.",
  },
  {
    id: "EMERGENCY_ACCESS",
    code: "EMERGENCY_ACCESS",
    name: "Emergency access",
    description: "Emergency-focused restricted access to explicitly permitted modules.",
  },
] as const;

type InvitationDelivery = Awaited<ReturnType<typeof emailService.sendTrustInvitationEmail>>;

const permissionSchema = z.object({
  module: z.enum(trustModules),
  canView: z.boolean(),
  canDownload: z.boolean(),
});

const pinSchema = z.object({
  pin: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN."),
});

const trustMemberBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  relation: z.enum(relations),
  customRelation: z.string().trim().min(1).max(80).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bloodGroup: z.enum(bloodGroups),
  accessTypeCode: z.enum(["VIEW_ONLY", "FAMILY_MEMBER", "EMERGENCY_ACCESS"]),
  permissions: z.array(permissionSchema).default([]),
}).strict();

export const trustMemberInputSchema = trustMemberBaseSchema.extend({
  pin: pinSchema.shape.pin,
}).refine((value) => value.relation !== "OTHER" || Boolean(value.customRelation), {
  message: "Custom relation is required when relation is OTHER.",
  path: ["customRelation"],
});

export const trustMemberUpdateSchema = trustMemberBaseSchema.partial().extend({
  permissions: z.array(permissionSchema).optional(),
}).strict();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function pinHash(pin: string) {
  return bcrypt.hash(pin, 10);
}

function newInvitationToken() {
  return randomBytes(48).toString("base64url");
}

function inviteExpiry() {
  return new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}

function relationLabel(relation: string, customRelation: string | null | undefined) {
  if (relation === "OTHER") return customRelation ?? "Other";
  return relation.toLowerCase().replace(/(^|_)([a-z])/g, (_match, prefix: string, letter: string) =>
    `${prefix ? " " : ""}${letter.toUpperCase()}`,
  );
}

function accessTypeDto(code: string) {
  return accessTypes.find((accessType) => accessType.code === code) ?? accessTypes[0];
}

function invitationState(member: { status: string; inviteExpiresAt: Date | null; rejectedAt?: Date | null }) {
  if (member.status === "REJECTED") return "REJECTED";
  if (member.status === "ACTIVE") return "ACCEPTED";
  if (member.status === "INVITED" && member.inviteExpiresAt && member.inviteExpiresAt <= new Date()) return "EXPIRED";
  if (member.status === "INVITED") return "PENDING";
  return "NONE";
}

function memberDto(member: Prisma.TrustMemberGetPayload<{
  include: { permissions: true };
}>, invitationDelivery?: InvitationDelivery) {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    relation: member.relation,
    customRelation: member.customRelation,
    relationLabel: relationLabel(member.relation, member.customRelation),
    dateOfBirth: member.dateOfBirth,
    bloodGroup: member.bloodGroup,
    accessType: accessTypeDto(member.accessType),
    status: member.status,
    invitationStatus: invitationState(member),
    invitedAt: member.invitedAt,
    inviteExpiresAt: member.inviteExpiresAt,
    acceptedAt: member.acceptedAt,
    rejectedAt: member.rejectedAt,
    revokedAt: member.revokedAt,
    permissions: member.permissions.map((permission) => ({
      module: permission.module,
      canView: permission.canView,
      canDownload: permission.canDownload,
    })),
    ...(invitationDelivery ? { invitationDelivery } : {}),
  };
}

function connectionDto(member: Prisma.TrustMemberGetPayload<{ include: { owner: true; permissions: true } }>) {
  return {
    id: member.id,
    owner: { id: member.owner.id, name: member.owner.name, email: member.owner.email },
    relation: member.relation,
    relationLabel: relationLabel(member.relation, member.customRelation),
    accessType: accessTypeDto(member.accessType),
    status: member.status,
    acceptedAt: member.acceptedAt,
  };
}

async function writeMemberPermissions(memberId: string, permissions: z.infer<typeof permissionSchema>[]) {
  for (const permission of permissions) {
    await prisma.trustMemberPermission.upsert({
      where: { trustMemberId_module: { trustMemberId: memberId, module: permission.module } },
      update: { canView: permission.canView, canDownload: permission.canDownload },
      create: { trustMemberId: memberId, ...permission },
    });
  }
}

async function deliverInvitation(member: Prisma.TrustMemberGetPayload<{ include: { owner: true } }>, token: string) {
  return emailService.sendTrustInvitationEmail({
    membershipId: member.id,
    to: member.email,
    ownerName: member.owner.name,
    memberName: member.name,
    relation: relationLabel(member.relation, member.customRelation),
    accessType: accessTypeDto(member.accessType).name,
    token,
  });
}

export async function getTrustCenter(userId: string) {
  await assertModuleEntitlement(userId, "trustCenter");
  const [owner, entitlements, members, connections] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
    getUserEntitlements(userId),
    prisma.trustMember.findMany({
      where: { ownerUserId: userId, status: { not: "REVOKED" } },
      include: { permissions: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.trustMember.findMany({
      where: { memberUserId: userId, status: "ACTIVE" },
      include: { owner: true, permissions: true },
      orderBy: { acceptedAt: "desc" },
    }),
  ]);
  const memberLimit = entitlements.rules.memberLimit;
  const manageableCount = members.filter((member) => member.status === "INVITED" || member.status === "ACTIVE").length;
  return {
    role: connections.length ? "BOTH" : "OWNER",
    owner: owner ? { ...owner, accessType: "OWNER", note: "Owner access cannot be changed" } : null,
    plan: entitlements.plan,
    entitlements,
    memberLimit,
    memberCount: manageableCount,
    remainingSlots: Math.max(0, memberLimit - manageableCount),
    members: members.map((member) => memberDto(member)),
    connections: connections.map((member) => connectionDto(member)),
    accessTypes,
    modules: entitlements.rules.modules,
  };
}

export async function addTrustMember(ownerUserId: string, input: unknown) {
  await assertModuleEntitlement(ownerUserId, "trustCenter");
  const data = trustMemberInputSchema.parse(input);
  const email = normalizeEmail(data.email);
  const accessType = accessTypeDto(data.accessTypeCode);
  const token = newInvitationToken();
  const hashedPin = await pinHash(data.pin);

  const member = await prisma.$transaction(async (tx) => {
    await assertMemberAllowance(ownerUserId, tx);
    const duplicate = await tx.trustMember.findFirst({
      where: { ownerUserId, email, status: { in: ["INVITED", "ACTIVE"] } },
    });
    if (duplicate) throw Object.assign(new Error("This member is already invited or active."), { statusCode: 409 });
    return tx.trustMember.create({
      data: {
        ownerUserId,
        email,
        name: data.name,
        relation: data.relation,
        customRelation: data.customRelation,
        dateOfBirth: data.dateOfBirth,
        bloodGroup: data.bloodGroup,
        accessType: data.accessTypeCode,
        status: "INVITED",
        inviteTokenHash: tokenHash(token),
        inviteExpiresAt: inviteExpiry(),
        invitePinHash: hashedPin,
        pinAttemptCount: 0,
        pinLockedUntil: null,
      },
      include: { owner: true, permissions: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await writeMemberPermissions(member.id, data.permissions);
  const invitationDelivery = await deliverInvitation(member, token);
  const saved = await getMemberRecord(ownerUserId, member.id);
  return memberDto(saved, invitationDelivery);
}

async function getMemberRecord(ownerUserId: string, memberId: string) {
  const member = await prisma.trustMember.findFirst({
    where: { id: memberId, ownerUserId },
    include: { permissions: true },
  });
  if (!member) throw Object.assign(new Error("Trust member not found."), { statusCode: 404 });
  return member;
}

export async function getMember(ownerUserId: string, memberId: string) {
  return memberDto(await getMemberRecord(ownerUserId, memberId));
}

export async function updateTrustMember(ownerUserId: string, memberId: string, input: unknown) {
  await assertModuleEntitlement(ownerUserId, "trustCenter");
  const data = trustMemberUpdateSchema.parse(input);
  if (data.accessTypeCode && !accessTypeDto(data.accessTypeCode)) {
    throw Object.assign(new Error("Invalid access type."), { statusCode: 400 });
  }

  await prisma.trustMember.updateMany({
    where: { id: memberId, ownerUserId, status: { notIn: ["REVOKED", "REJECTED"] } },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.email ? { email: normalizeEmail(data.email) } : {}),
      ...(data.relation ? { relation: data.relation } : {}),
      ...(data.customRelation !== undefined ? { customRelation: data.customRelation } : {}),
      ...(data.dateOfBirth ? { dateOfBirth: data.dateOfBirth } : {}),
      ...(data.bloodGroup ? { bloodGroup: data.bloodGroup } : {}),
      ...(data.accessTypeCode ? { accessType: data.accessTypeCode } : {}),
    },
  });
  if (data.permissions) await writeMemberPermissions(memberId, data.permissions);
  return getMember(ownerUserId, memberId);
}

export async function revokeTrustMember(ownerUserId: string, memberId: string) {
  await assertModuleEntitlement(ownerUserId, "trustCenter");
  const revoked = await prisma.trustMember.updateMany({
    where: { id: memberId, ownerUserId, status: { not: "REVOKED" } },
    data: { status: "REVOKED", revokedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
  });
  if (revoked.count !== 1) throw Object.assign(new Error("Trust member not found."), { statusCode: 404 });
}

export async function leaveTrustCenter(memberUserId: string, memberId: string) {
  const revoked = await prisma.trustMember.updateMany({
    where: { id: memberId, memberUserId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
  });
  if (revoked.count !== 1) throw Object.assign(new Error("Trust connection not found."), { statusCode: 404 });
}

export async function acceptTrustInvitationsForUser(userId: string, email: string) {
  await prisma.trustMember.updateMany({
    where: { email: normalizeEmail(email), status: "ACTIVE", memberUserId: null },
    data: { memberUserId: userId },
  });
}

export async function resendTrustInvitation(ownerUserId: string, memberId: string) {
  const token = newInvitationToken();
  const existing = await prisma.trustMember.findFirst({
    where: { id: memberId, ownerUserId, status: { in: ["INVITED", "REJECTED"] } },
    select: { id: true },
  });
  if (!existing) throw Object.assign(new Error("Invitation not found."), { statusCode: 404 });
  const member = await prisma.trustMember.update({
    where: { id: existing.id },
    data: {
      status: "INVITED",
      rejectedAt: null,
      acceptedAt: null,
      memberUserId: null,
      inviteTokenHash: tokenHash(token),
      inviteExpiresAt: inviteExpiry(),
      pinAttemptCount: 0,
      pinLockedUntil: null,
    },
    include: { owner: true },
  });
  const invitationDelivery = await deliverInvitation(member, token);
  const saved = await getMemberRecord(ownerUserId, member.id);
  return memberDto(saved, invitationDelivery);
}

export async function resetTrustInvitationPin(ownerUserId: string, memberId: string, input: unknown) {
  const { pin } = pinSchema.parse(input);
  const updated = await prisma.trustMember.updateMany({
    where: { id: memberId, ownerUserId, status: "INVITED" },
    data: {
      invitePinHash: await pinHash(pin),
      pinAttemptCount: 0,
      pinLockedUntil: null,
    },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Invitation not found."), { statusCode: 404 });
  return getMember(ownerUserId, memberId);
}

export async function getInvitation(token: string) {
  const member = await prisma.trustMember.findUnique({
    where: { inviteTokenHash: tokenHash(token) },
    include: { owner: true },
  });
  if (!member || member.status !== "INVITED" || !member.inviteExpiresAt || member.inviteExpiresAt <= new Date()) {
    throw Object.assign(new Error("Invitation expired or invalid."), { statusCode: 404 });
  }
  return {
    id: member.id,
    ownerName: member.owner.name,
    memberName: member.name,
    relationLabel: relationLabel(member.relation, member.customRelation),
    accessType: accessTypeDto(member.accessType),
    expiresAt: member.inviteExpiresAt,
  };
}

export async function rejectInvitation(token: string) {
  const updated = await prisma.trustMember.updateMany({
    where: { inviteTokenHash: tokenHash(token), status: "INVITED", inviteExpiresAt: { gt: new Date() } },
    data: { status: "REJECTED", rejectedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Invitation expired or invalid."), { statusCode: 404 });
  return { message: "Invitation rejected." };
}

export async function acceptInvitation(token: string, input: unknown) {
  const { pin } = pinSchema.parse(input);
  const member = await prisma.trustMember.findUnique({
    where: { inviteTokenHash: tokenHash(token) },
    select: {
      id: true,
      status: true,
      inviteExpiresAt: true,
      invitePinHash: true,
      pinAttemptCount: true,
      pinLockedUntil: true,
      email: true,
    },
  });
  const now = new Date();
  if (!member || member.status !== "INVITED" || !member.inviteExpiresAt || member.inviteExpiresAt <= now || !member.invitePinHash) {
    throw Object.assign(new Error("Invitation expired or invalid."), { statusCode: 400 });
  }
  if (member.pinLockedUntil && member.pinLockedUntil > now) {
    throw Object.assign(new Error("Invitation could not be verified. Try again later."), { statusCode: 429 });
  }
  const validPin = await bcrypt.compare(pin, member.invitePinHash);
  if (!validPin) {
    const nextCount = member.pinAttemptCount + 1;
    await prisma.trustMember.update({
      where: { id: member.id },
      data: {
        pinAttemptCount: nextCount,
        pinLockedUntil: nextCount >= MAX_PIN_ATTEMPTS ? new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    throw Object.assign(new Error("Invitation could not be verified."), { statusCode: 400 });
  }
  await prisma.trustMember.update({
    where: { id: member.id },
    data: {
      status: "ACTIVE",
      acceptedAt: now,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      pinAttemptCount: 0,
      pinLockedUntil: null,
      memberUserId: (await prisma.user.findUnique({ where: { email: member.email }, select: { id: true } }))?.id,
    },
  });
  return { message: "Invitation accepted." };
}
