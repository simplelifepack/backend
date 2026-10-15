import type { NextFunction, Request, Response } from "express";
import type { AdminRole } from "@prisma/client";

import type { AdminAuthenticatedRequest } from "./adminAuth";

// Mirrors the access matrix in readiness-admin-console.html (#access) exactly —
// keep the two in sync by hand; there is no generator for this yet.
export type AdminCapability =
  | "users.view"
  | "users.signout" | "users.reset_email"
  | "users.tier.change"
  | "users.suspend"
  | "users.delete"
  | "packs.review" | "packs.publish"
  | "packs.bulk_import"
  | "packs.rollback"
  | "forms.edit"
  | "ai.prompt.publish"
  | "pipelines.retry"
  | "security.rewrap.dry_run"
  | "security.rewrap.apply"
  | "ai.kill_switch"
  | "audit.read" | "audit.read_own"
  | "feedback.resolve"
  | "admins.manage"
  | "alerts.manage"
  | "system.settings.manage"
  | "integrations.view" | "integrations.disconnect"
  | "trust.view" | "trust.revoke"
  | "billing.view";

type Grant = "yes" | "step_up" | "approval" | "view" | "own" | "none";

const MATRIX: Record<AdminCapability, Record<AdminRole, Grant>> = {
  "users.view":            { support: "yes",    catalogue: "view",  ops_security: "yes",    owner: "yes" },
  "users.signout":         { support: "step_up", catalogue: "none", ops_security: "step_up", owner: "step_up" },
  "users.reset_email":     { support: "step_up", catalogue: "none", ops_security: "step_up", owner: "step_up" },
  "users.tier.change":     { support: "approval", catalogue: "none", ops_security: "none",   owner: "step_up" },
  "users.suspend":         { support: "step_up", catalogue: "none", ops_security: "step_up", owner: "step_up" },
  "users.delete":          { support: "none",    catalogue: "none", ops_security: "approval", owner: "approval" },
  "packs.review":          { support: "view",    catalogue: "yes",  ops_security: "view",    owner: "step_up" },
  "packs.publish":         { support: "none",    catalogue: "yes",  ops_security: "view",    owner: "step_up" },
  "packs.bulk_import":     { support: "none",    catalogue: "yes",  ops_security: "view",    owner: "step_up" },
  "packs.rollback":        { support: "none",    catalogue: "step_up", ops_security: "view", owner: "step_up" },
  "forms.edit":            { support: "none",    catalogue: "yes",  ops_security: "view",    owner: "step_up" },
  "ai.prompt.publish":     { support: "none",    catalogue: "none", ops_security: "step_up", owner: "step_up" },
  "pipelines.retry":       { support: "step_up", catalogue: "none", ops_security: "yes",     owner: "yes" },
  "security.rewrap.dry_run": { support: "none",  catalogue: "none", ops_security: "yes",     owner: "yes" },
  "security.rewrap.apply":   { support: "none",  catalogue: "none", ops_security: "approval", owner: "approval" },
  "ai.kill_switch":        { support: "none",    catalogue: "none", ops_security: "step_up", owner: "step_up" },
  "audit.read":            { support: "own",     catalogue: "own",  ops_security: "yes",     owner: "yes" },
  "audit.read_own":        { support: "own",     catalogue: "own",  ops_security: "yes",     owner: "yes" },
  "feedback.resolve":      { support: "yes",     catalogue: "none", ops_security: "none",    owner: "yes" },
  "admins.manage":         { support: "none",    catalogue: "none", ops_security: "none",    owner: "approval" },
  // Not in the original access matrix (#access) — the design doc's mockup
  // logs this action as `alert.channel.edit` but names no capability for it.
  // Added here, shaped like ai.kill_switch: an ops/owner-only platform
  // lever, no "view"-only role to avoid the step-up ambiguity noted
  // elsewhere in this file (requireWriteGrant).
  "alerts.manage":         { support: "none",    catalogue: "none", ops_security: "step_up", owner: "step_up" },
  // The access matrix (#access) groups this with ai.kill_switch under one
  // row — "AI kill switch; maintenance mode" — same grants, same trust
  // level. Kept as its own capability (not a reuse of ai.kill_switch)
  // because the name "AI kill switch" would be a confusing gate for editing
  // an announcement or a feature flag, even though the matrix intends the
  // same access level for both.
  "system.settings.manage": { support: "none",   catalogue: "none", ops_security: "step_up", owner: "step_up" },
  // Not in the original access matrix — "Integrations" (Gmail/Drive
  // connection health, forced disconnect) has no row there at all. Shaped
  // like the users.view / users.signout split: viewing connection health is
  // routine support/ops visibility (catalogue has no reason to see this,
  // same as it has none for pipelines.retry); forcing a disconnect acts on
  // a real customer's integration on their behalf, so it gets the same
  // step-up level as force sign-out, not the heavier "destroy the account"
  // level of users.delete.
  "integrations.view":       { support: "yes",     catalogue: "none", ops_security: "yes",     owner: "yes" },
  "integrations.disconnect": { support: "step_up", catalogue: "none", ops_security: "step_up", owner: "step_up" },
  // Not in the original access matrix — "Trust & sharing" has no row there
  // either. Same view/act shape as Integrations above, for the same reason:
  // trust.view is routine support/ops visibility into aggregate counts (the
  // sealed-data list says Trust-center content shows "only counts and
  // status" — the aggregate page honors that literally); trust.revoke is
  // the "abuse response" the module description names, surfaced per-member
  // on the Users detail page (not a standalone member-browsing list) since
  // acting on one requires knowing which owner you're already looking at.
  "trust.view":              { support: "yes",     catalogue: "none", ops_security: "yes",     owner: "yes" },
  "trust.revoke":            { support: "step_up", catalogue: "none", ops_security: "step_up", owner: "step_up" },
  // Not in the original matrix either. Read-only by construction — there's
  // no mutating capability to pair this with, since this entire slice is
  // tier counts + the existing user.tier.change audit history (tier changes
  // themselves already go through users.tier.change). Same support/ops/owner
  // visibility as the other view-only capabilities above.
  "billing.view":            { support: "yes",     catalogue: "none", ops_security: "yes",     owner: "yes" },
};

export function grantFor(role: AdminRole, capability: AdminCapability): Grant {
  return MATRIX[capability][role];
}

/** Blocks roles with no access at all. Does not enforce step-up or approval —
 * pair with `requireStepUp` / an approval flow for those grants. */
export function requireCapability(capability: AdminCapability) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { adminUser } = req as AdminAuthenticatedRequest;
    const grant = grantFor(adminUser.role, capability);
    if (grant === "none") {
      return res.status(403).json({ message: "Your role does not have this capability." });
    }
    (req as AdminAuthenticatedRequest).grant = grant;
    return next();
  };
}

/** For a "step_up" or "approval" grant, require the session to have completed
 * passkey verification within the last 5 minutes (decision D2 / the mockup's
 * "Change tier" dialog). "approval" additionally needs a second admin — that
 * workflow isn't built yet (Phase 2); for now it is treated the same as step-up
 * and the requirement is logged so it's visible in the audit trail. */
const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

export function requireStepUp(req: Request, res: Response, next: NextFunction) {
  const typed = req as AdminAuthenticatedRequest;
  if (typed.grant === "yes" || typed.grant === "view" || typed.grant === "own" || typed.grant === undefined) {
    return next();
  }
  const stepUpAt = typed.adminSession.stepUpAt;
  if (!stepUpAt || Date.now() - stepUpAt.getTime() > STEP_UP_WINDOW_MS) {
    return res.status(403).json({ message: "Step-up required.", code: "STEP_UP_REQUIRED" });
  }
  return next();
}

/** A handful of capabilities deliberately use "view" to mean strictly
 * read-only while also gating a write action under the same capability name
 * — `packs.publish`, `packs.bulk_import`, `packs.rollback` as of writing
 * (search this file for `"view"` to find the current list). `requireStepUp`
 * treats "view" the same as "yes" — no step-up needed — which is correct
 * for an actual read endpoint, but on a write route it would let a
 * view-only role mutate data without even a step-up prompt, since
 * `requireCapability` alone only blocks "none". Chain this (before
 * `requireStepUp`) on every mutating route whose capability can resolve to
 * "view" for some role. Found and fixed for `packs.bulk_import` on the Job
 * runner's backfill job type (12 Oct) — treat as a checklist item whenever
 * wiring a new write route, not a one-off patch. */
export function requireWriteGrant(req: Request, res: Response, next: NextFunction) {
  const typed = req as AdminAuthenticatedRequest;
  if (typed.grant === "view") {
    return res.status(403).json({ message: "Your role has view-only access to this capability." });
  }
  return next();
}
