import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp, requireWriteGrant, type AdminCapability } from "../../middleware/adminRbac";
import {
  JobError, getRunningRewrapJob, listJobs, pauseRewrapJob, previewRewrap,
  resumeRewrapJob, startRewrapJob, tickRewrapJob,
} from "../../services/jobs/rewrapJob.service";
import {
  getRunningStorageAuditJob, pauseStorageAuditJob, previewStorageAudit,
  resumeStorageAuditJob, startStorageAuditJob, tickStorageAuditJob,
} from "../../services/jobs/storageAuditJob.service";
import {
  getRunningBackfillJob, pauseBackfillJob, previewBackfill,
  resumeBackfillJob, startBackfillJob, tickBackfillJob,
} from "../../services/jobs/backfillJob.service";

const router = Router();
router.use(requireAdminAuth);

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

function handleJobError(error: unknown, next: (e?: unknown) => void, res: Response) {
  if (error instanceof JobError) return res.status(error.statusCode).json({ message: error.message });
  return next(error);
}

// Runs an Express-shaped gate (requireCapability(...), requireStepUp, our own
// requireWriteGrant below) synchronously and reports pass/fail, instead of
// chaining it as route middleware. Needed because which capability applies
// here depends on the *job's type*, which we only know once we've looked the
// job up inside the handler — plain `router.use`/per-route middleware runs
// before that lookup is possible. All three gates we call this with are
// synchronous (no awaits), so checking `res.headersSent` right after is safe.
function passesGate(gate: (req: Request, res: Response, next: NextFunction) => void, req: Request, res: Response): boolean {
  let passed = false;
  gate(req, res, () => { passed = true; });
  return passed && !res.headersSent;
}

// requireWriteGrant (imported above) covers the "view grant bypasses
// step-up" gap for packs.bulk_import — see its doc comment in adminRbac.ts.

const VIEW_CAPABILITY: Record<"key_rewrap" | "storage_audit" | "package_source_backfill" | "audit_chain_verify", AdminCapability> = {
  key_rewrap: "security.rewrap.dry_run",
  storage_audit: "security.rewrap.dry_run",
  package_source_backfill: "packs.bulk_import",
  audit_chain_verify: "audit.read",
};
const WRITE_CAPABILITY: Record<"key_rewrap" | "storage_audit" | "package_source_backfill", AdminCapability> = {
  key_rewrap: "security.rewrap.apply",
  storage_audit: "security.rewrap.apply",
  package_source_backfill: "packs.bulk_import",
};

router.get("/", requireCapability("security.rewrap.dry_run"), async (req, res, next) => {
  // NOTE: typeless listing is only reachable by roles with security.rewrap.dry_run.
  // A catalogue-only admin (packs.bulk_import: "yes", security.rewrap.dry_run: "none")
  // can't use this blanket endpoint to list their own backfill jobs — nothing
  // in the UI calls this without a type filter today, so left as a known gap
  // rather than building general cross-capability filtering for an unused path.
  try {
    const type = z.enum(["key_rewrap", "storage_audit", "package_source_backfill"]).optional().parse(req.query.type);
    return res.json({ items: await listJobs(type) });
  } catch (error) {
    return next(error);
  }
});

router.get("/rewrap/current", requireCapability("security.rewrap.dry_run"), async (_req, res, next) => {
  try {
    return res.json({ job: await getRunningRewrapJob() });
  } catch (error) {
    return next(error);
  }
});

router.post("/rewrap/preview", requireCapability("security.rewrap.dry_run"), async (_req, res, next) => {
  try {
    return res.json(await previewRewrap());
  } catch (error) {
    return next(error);
  }
});

router.post("/rewrap/start", requireCapability("security.rewrap.apply"), requireStepUp, async (req, res, next) => {
  try {
    const job = await startRewrapJob(adminCtx(req as unknown as AdminAuthenticatedRequest));
    return res.json({ job });
  } catch (error) {
    return handleJobError(error, next, res);
  }
});

router.get("/storage-audit/current", requireCapability("security.rewrap.dry_run"), async (_req, res, next) => {
  try {
    return res.json({ job: await getRunningStorageAuditJob() });
  } catch (error) {
    return next(error);
  }
});

router.post("/storage-audit/preview", requireCapability("security.rewrap.dry_run"), async (_req, res, next) => {
  try {
    return res.json(await previewStorageAudit());
  } catch (error) {
    return next(error);
  }
});

router.post("/storage-audit/start", requireCapability("security.rewrap.apply"), requireStepUp, async (req, res, next) => {
  try {
    const job = await startStorageAuditJob(adminCtx(req as unknown as AdminAuthenticatedRequest));
    return res.json({ job });
  } catch (error) {
    return handleJobError(error, next, res);
  }
});

router.get("/backfill/current", requireCapability("packs.bulk_import"), async (_req, res, next) => {
  try {
    return res.json({ job: await getRunningBackfillJob() });
  } catch (error) {
    return next(error);
  }
});

router.post("/backfill/preview", requireCapability("packs.bulk_import"), async (_req, res, next) => {
  try {
    return res.json(await previewBackfill());
  } catch (error) {
    return next(error);
  }
});

router.post("/backfill/start", requireCapability("packs.bulk_import"), requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const job = await startBackfillJob(adminCtx(req as unknown as AdminAuthenticatedRequest));
    return res.json({ job });
  } catch (error) {
    return handleJobError(error, next, res);
  }
});

// Generic by-id actions: look the job up, then gate and dispatch by its own
// type. One route per action regardless of type, rather than duplicating
// `/rewrap/:id/tick`, `/storage-audit/:id/tick`, `/backfill/:id/tick`, etc.
async function loadJob(id: string) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) throw new JobError("Job not found.", 404);
  return job;
}

// `audit_chain_verify` (Phase 4) never ticks/pauses/resumes — it's born
// already completed or failed (see auditChainVerifyJob.service.ts) — so it
// has no entry in VIEW_CAPABILITY/WRITE_CAPABILITY and can't reach this
// generic dispatcher. Its own routes live on /admin/v1/audit/chain-verify/*.
type TickableJob = Awaited<ReturnType<typeof loadJob>> & { type: "key_rewrap" | "storage_audit" | "package_source_backfill" };
function assertTickable(job: Awaited<ReturnType<typeof loadJob>>): TickableJob {
  if (job.type === "audit_chain_verify") {
    throw new JobError("This job type has no running state — see GET /admin/v1/audit/chain-verify/history instead.", 400);
  }
  return job as TickableJob;
}

router.post("/:id/tick", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const job = assertTickable(await loadJob(id));
    if (!passesGate(requireCapability(WRITE_CAPABILITY[job.type]), req, res)) return;
    if (job.type === "package_source_backfill" && !passesGate(requireWriteGrant, req, res)) return;
    const result = job.type === "key_rewrap" ? await tickRewrapJob(id)
      : job.type === "storage_audit" ? await tickStorageAuditJob(id)
      : await tickBackfillJob(id);
    return res.json({ job: result });
  } catch (error) {
    return handleJobError(error, next, res);
  }
});

router.post("/:id/pause", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const job = assertTickable(await loadJob(id));
    if (!passesGate(requireCapability(WRITE_CAPABILITY[job.type]), req, res)) return;
    if (job.type === "package_source_backfill" && !passesGate(requireWriteGrant, req, res)) return;
    const ctx = adminCtx(req as unknown as AdminAuthenticatedRequest);
    const result = job.type === "key_rewrap" ? await pauseRewrapJob(ctx, id)
      : job.type === "storage_audit" ? await pauseStorageAuditJob(ctx, id)
      : await pauseBackfillJob(ctx, id);
    return res.json({ job: result });
  } catch (error) {
    return handleJobError(error, next, res);
  }
});

router.post("/:id/resume", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const job = assertTickable(await loadJob(id));
    if (!passesGate(requireCapability(WRITE_CAPABILITY[job.type]), req, res)) return;
    if (job.type === "package_source_backfill" && !passesGate(requireWriteGrant, req, res)) return;
    const ctx = adminCtx(req as unknown as AdminAuthenticatedRequest);
    const result = job.type === "key_rewrap" ? await resumeRewrapJob(ctx, id)
      : job.type === "storage_audit" ? await resumeStorageAuditJob(ctx, id)
      : await resumeBackfillJob(ctx, id);
    return res.json({ job: result });
  } catch (error) {
    return handleJobError(error, next, res);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const job = await loadJob(id);
    if (!passesGate(requireCapability(VIEW_CAPABILITY[job.type]), req, res)) return;
    return res.json({ job });
  } catch (error) {
    return handleJobError(error, next, res);
  }
});

export default router;
