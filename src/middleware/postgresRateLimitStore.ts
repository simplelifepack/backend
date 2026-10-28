import type { ClientRateLimitInfo, Store } from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { privateLookup } from "../privacy/fieldEncryption";

// Existing opaque-key TTL counter table; independent namespaces keep API
// limiters separate from waitlist limits. No new schema or plaintext identifiers.
export class PostgresRateLimitStore implements Store {
  readonly localKeys = false;
  private nextPruneAt = 0;
  constructor(private readonly scope: string, private readonly windowMs: number, private readonly database = prisma) {}
  private key(value: string) { return `api:${privateLookup(value, { model: "RateLimit", field: this.scope, ownerId: "server" })}`; }
  async increment(value: string): Promise<ClientRateLimitInfo> {
    try {
      const rows = await this.database.$queryRaw<Array<{count:number; expiresAt:Date}>>`
        INSERT INTO "WaitlistRateLimit" ("key", "count", "expiresAt")
        VALUES (${this.key(value)}, 1, timezone('UTC', CURRENT_TIMESTAMP) + (${this.windowMs} * INTERVAL '1 millisecond'))
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "WaitlistRateLimit"."expiresAt" <= timezone('UTC', CURRENT_TIMESTAMP) THEN 1 ELSE LEAST("WaitlistRateLimit"."count" + 1, 2147483646) END,
          "expiresAt" = CASE WHEN "WaitlistRateLimit"."expiresAt" <= timezone('UTC', CURRENT_TIMESTAMP) THEN timezone('UTC', CURRENT_TIMESTAMP) + (${this.windowMs} * INTERVAL '1 millisecond') ELSE "WaitlistRateLimit"."expiresAt" END
        RETURNING "count", "expiresAt"`;
      // Opportunistic bounded cleanup needs no per-instance timer or queue.
      if (Date.now() >= this.nextPruneAt) {
        this.nextPruneAt = Date.now() + 60_000;
        await this.database.$executeRaw`DELETE FROM "WaitlistRateLimit" WHERE "key" IN (SELECT "key" FROM "WaitlistRateLimit" WHERE "expiresAt" < timezone('UTC', CURRENT_TIMESTAMP) ORDER BY "expiresAt" LIMIT 1000)`;
      }
      return { totalHits: rows[0].count, resetTime: rows[0].expiresAt };
    } catch { throw Object.assign(new Error("Rate-limit service temporarily unavailable."), { statusCode: 503 }); }
  }
  async decrement(value: string) {
    await this.database.$executeRaw`UPDATE "WaitlistRateLimit" SET "count" = GREATEST(0, "count" - 1) WHERE "key" = ${this.key(value)} AND "expiresAt" > timezone('UTC', CURRENT_TIMESTAMP)`;
  }
  async resetKey(value: string) {
    await this.database.$executeRaw`DELETE FROM "WaitlistRateLimit" WHERE "key" = ${this.key(value)}`;
  }
}
