import type { Store } from "express-rate-limit";

import { prisma } from "../lib/prisma";

// A Store implementation backed by the RateLimitHit table instead of
// express-rate-limit's default in-process MemoryStore. Needed anywhere the
// limit must hold once there's more than one backend instance behind a
// load balancer — a MemoryStore gives every instance its own independent
// counter, so a client could get `max` requests per instance instead of
// `max` total. Currently wired into `adminLimiter` only (the admin
// login/step-up routes), per the tracked Phase 0 gap; reusable for any other
// limiter in security.ts if that need comes up later.
//
// `increment` is one atomic upsert (ON CONFLICT ... DO UPDATE), so two
// instances racing on the same key still land on a single, correct row —
// there's no read-then-write window for a concurrent request to land in.
export function createPostgresRateLimitStore(): Store {
  let windowMs = 15 * 60 * 1000;

  return {
    init(options) {
      windowMs = options.windowMs;
    },

    async increment(key) {
      const rows = await prisma.$queryRaw<Array<{ points: number; resetAt: Date }>>`
        INSERT INTO "rate_limit_hits" AS r ("key", "points", "resetAt")
        VALUES (${key}, 1, now() + (${windowMs}::text || ' milliseconds')::interval)
        ON CONFLICT ("key") DO UPDATE SET
          "points" = CASE WHEN r."resetAt" <= now() THEN 1 ELSE r."points" + 1 END,
          "resetAt" = CASE WHEN r."resetAt" <= now() THEN now() + (${windowMs}::text || ' milliseconds')::interval ELSE r."resetAt" END
        RETURNING "points", "resetAt"
      `;
      const row = rows[0];

      // Self-cleaning: no setInterval/cron here (nothing else in this
      // serverless-shaped backend runs a standing in-process timer — see
      // the Job model's comments in schema.prisma). A row past its own
      // resetAt is already handled correctly by the ON CONFLICT branch
      // above, so this is purely about not letting old keys (stale IPs,
      // one-off emails) pile up forever. Low odds, cheap query, best-effort.
      if (Math.random() < 0.01) void sweepExpiredRateLimitHits().catch(() => {});

      return { totalHits: row.points, resetTime: row.resetAt };
    },

    async decrement(key) {
      await prisma.rateLimitHit.updateMany({
        where: { key, points: { gt: 0 } },
        data: { points: { decrement: 1 } },
      });
    },

    async resetKey(key) {
      await prisma.rateLimitHit.deleteMany({ where: { key } });
    },

    async resetAll() {
      await prisma.rateLimitHit.deleteMany({});
    },

    localKeys: false,
  };
}

export async function sweepExpiredRateLimitHits() {
  await prisma.rateLimitHit.deleteMany({ where: { resetAt: { lte: new Date() } } });
}
