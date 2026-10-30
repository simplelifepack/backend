// Disposable local target only; no external provider traffic or payment requests.
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import bcrypt from "bcrypt";
const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/readines_audit_test") throw Error("Disposable local audit DB required");
process.env.RATE_LIMIT_MAX = "100000";
const realFetch = global.fetch;
global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  if (new URL(input instanceof Request ? input.url : String(input)).hostname !== "127.0.0.1") throw Error("External requests disabled");
  return realFetch(input, init);
}) as typeof fetch;
async function run() {
  const { app } = await import("../app");
  const { prisma } = await import("../lib/prisma");
  const { withPrivateUser } = await import("../privacy/access");
  const { login } = await import("../services/auth.service");
  const { mountedApiOperations } = await import("../docs/mountedOperations");
  const id = randomUUID(), email = `${id}@example.test`;
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const checks: unknown[] = [], load: unknown[] = [];
  try {
    await withPrivateUser(id, () => prisma.user.create({ data: { id, email, name: "Synthetic audit", passwordHash: bcrypt.hashSync("Audit-password-123!", 4) }, select: { id: true } }));
    const auth = await login({ email, password: "Audit-password-123!" });
    const publicOperation = (op: string) => op === "GET /health" || op.includes("/waitlist") || (/^POST \/auth\//.test(op) && !op.includes("/account/") && !op.endsWith("/logout-all")) || op.includes("/trust/invitations/") || op.includes("/digilocker/callback");
    for (const op of mountedApiOperations().filter(op => !op.includes("billing") && !publicOperation(op))) {
      const [method, route] = op.split(" ");
      const response = await fetch(base + route.replace(/\{[^}]+\}/g, "audit-unowned"), { method });
      await response.arrayBuffer();
      checks.push({ op, status: response.status });
      assert([401, 403].includes(response.status), `${op}: ${response.status}`);
    }
    for (const concurrency of [10, 25, 50]) {
      const paths = ["/documents", "/api/wealth/records", "/api/health/members", "/api/preferences", "/api/notifications/config"];
      const durations: number[] = [], statuses: Record<string, number> = {};
      let peakRSS = process.memoryUsage().rss, peakHeap = process.memoryUsage().heapUsed;
      const sampler = setInterval(() => { const memory = process.memoryUsage(); peakRSS = Math.max(peakRSS, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed); }, 10);
      const cpu = process.cpuUsage(), started = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
        for (let step = 0; step < 10; step++) {
          const start = performance.now();
          const response = await fetch(base + paths[(worker + step) % paths.length], { headers: { Authorization: `Bearer ${auth.accessToken}` } });
          await response.arrayBuffer();
          assert.equal(response.status, 200, paths[(worker + step) % paths.length]);
          durations.push(performance.now() - start); statuses[response.status] = (statuses[response.status] ?? 0) + 1;
        }
      }));
      clearInterval(sampler); durations.sort((a, b) => a - b);
      const elapsedMs = performance.now() - started, used = process.cpuUsage(cpu);
      const quantile = (q: number) => durations[Math.ceil(durations.length * q) - 1];
      load.push({ concurrency, requests: durations.length, elapsedMs, rps: durations.length * 1000 / elapsedMs, p50: quantile(.5), p95: quantile(.95), p99: quantile(.99), statuses, peakRSS, peakHeap, cpuMs: (used.user + used.system) / 1000 });
    }
    const sustained: unknown[] = [];
    const durationMs = Math.min(60_000, Math.max(0, Number(process.env.AUDIT_SUSTAINED_MS) || 0));
    if (durationMs) {
      const started = performance.now(), cpu = process.cpuUsage();
      let requests = 0;
      const sample = setInterval(() => { sustained.push({ elapsedMs: performance.now() - started, requests, ...process.memoryUsage() }); }, 1000);
      try {
        await Promise.all(Array.from({ length: 10 }, async () => {
          while (performance.now() - started < durationMs) {
            const response = await fetch(base + "/api/preferences", { headers: { Authorization: `Bearer ${auth.accessToken}` } });
            await response.arrayBuffer(); assert.equal(response.status, 200); requests++;
          }
        }));
      } finally { clearInterval(sample); }
      sustained.push({ totalRequests: requests, elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), connections: await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()` });
    }
    await fs.writeFile("/private/tmp/readiness-remaining-audit/local-api.json", JSON.stringify({ checks, load, sustained, notes: "Real local HTTP and PostgreSQL, synthetic empty account, no AI/provider calls; burst measurements are not production capacity or soak evidence." }, null, 2));
  } finally {
    await withPrivateUser(id, () => prisma.user.deleteMany({ where: { id } }));
    await prisma.$disconnect(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
