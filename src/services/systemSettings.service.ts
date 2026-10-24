import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./adminAudit.service";

export class SystemSettingsError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SystemSettingsError";
    this.statusCode = statusCode;
  }
}

// The table itself is generic (any key/value), but this pass's admin UI only
// manages these four. Add to this list — and a validator below — before the
// UI can safely expose a new one.
export const KNOWN_KEYS = ["announcement", "feature_flags", "min_supported_version", "maintenance_mode"] as const;
export type KnownKey = (typeof KNOWN_KEYS)[number];

export type AnnouncementValue = { text: string; severity: "info" | "warning" | "critical"; active: boolean };
export type FeatureFlagsValue = Record<string, boolean>;
export type MinSupportedVersionValue = { ios: string | null; android: string | null; web: string | null };
export type MaintenanceModeValue = { active: boolean; message: string };

function validateValue(key: KnownKey, value: unknown): void {
  const err = (msg: string) => { throw new SystemSettingsError(msg, 400); };
  if (typeof value !== "object" || value === null) return err(`${key} must be an object.`);
  const v = value as Record<string, unknown>;
  switch (key) {
    case "announcement":
      if (typeof v.text !== "string") return err("announcement.text must be a string.");
      if (!["info", "warning", "critical"].includes(v.severity as string)) return err("announcement.severity must be info, warning, or critical.");
      if (typeof v.active !== "boolean") return err("announcement.active must be a boolean.");
      return;
    case "feature_flags":
      for (const [flag, val] of Object.entries(v)) {
        if (typeof val !== "boolean") return err(`feature_flags.${flag} must be a boolean.`);
      }
      return;
    case "min_supported_version":
      for (const platform of ["ios", "android", "web"]) {
        if (v[platform] !== null && typeof v[platform] !== "string") return err(`min_supported_version.${platform} must be a string or null.`);
      }
      return;
    case "maintenance_mode":
      if (typeof v.active !== "boolean") return err("maintenance_mode.active must be a boolean.");
      if (typeof v.message !== "string") return err("maintenance_mode.message must be a string.");
      return;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };

export async function listSettings() {
  return prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
}

/** Public/client-facing read — used by the (additive) GET /api/bootstrap
 * block. Returns defaults for any key that's never been set, so clients
 * always get a well-formed shape rather than having to handle "missing". */
export async function getPublicSystemConfig() {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: KNOWN_KEYS as unknown as string[] } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    announcement: (byKey.get("announcement") as AnnouncementValue | undefined) ?? { text: "", severity: "info", active: false },
    featureFlags: (byKey.get("feature_flags") as FeatureFlagsValue | undefined) ?? {},
    minSupportedVersion: (byKey.get("min_supported_version") as MinSupportedVersionValue | undefined) ?? { ios: null, android: null, web: null },
    maintenanceMode: (byKey.get("maintenance_mode") as MaintenanceModeValue | undefined) ?? { active: false, message: "" },
  };
}

export async function setKnownSetting(ctx: AdminCtx, key: KnownKey, value: unknown, reason: string) {
  validateValue(key, value);
  const before = await prisma.systemSetting.findUnique({ where: { key } });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, updatedByAdminId: ctx.adminId },
      update: { value: value as Prisma.InputJsonValue, updatedByAdminId: ctx.adminId },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "system_setting.update",
      targetType: "SystemSetting", targetId: key, reason,
      diff: { from: before?.value ?? null, to: value },
    });
    return updated;
  });
}
