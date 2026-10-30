import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { withPrivateUser } from "../privacy/access";
import { signAccessToken } from "../utils/jwt";
import { loadDigiLockerConfig } from "../config/digilocker";

// Explicit verification-only hosted build. Secrets stay in Vercel memory.
// No HTTP route, real provider authorization, or existing user records are used.
async function main() {
  assert(process.env.VERCEL_ENV === "production" && process.env.DIGILOCKER_MOBILE_VERIFICATION === "1");
  const base = "https://backend-three-sage-78.vercel.app";
  const prefix = "/api/integrations/digilocker";
  const ids = [randomUUID(), randomUUID()];
  const tokens = ids.map(sub => signAccessToken({ sub, authVersion: 0 }));
  const checks: string[] = [];
  const check = (name: string, passed: boolean) => {
    console.log(JSON.stringify({ event: "digilocker_mobile_check", name, passed }));
    assert(passed, name); checks.push(name);
  };
  const config = loadDigiLockerConfig();
  console.log(JSON.stringify({ event: "digilocker_configuration", configured: config.configured,
    environment: config.environment, registeredCallback: config.redirectUri,
    providerHost: new URL(config.baseUrl).host, clientIdPresent: !!config.clientId,
    clientSecretPresent: !!config.clientSecret, schedulerSecretPresent: !!process.env.CRON_SECRET,
    providerRegistrationIndependentlyVerified: false }));
  check("production configuration present without exposing credentials", config.configured);
  async function request(path: string, owner = 0, body?: unknown) {
    return fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30_000),
      method: body === undefined ? "GET" : "POST", headers: {
        Authorization: `Bearer ${tokens[owner]}`, "Content-Type": "application/json",
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function start(body: unknown) {
    const response = await request(prefix + "/sessions", 0, body);
    assert.equal(response.status, 201);
    return response.json() as Promise<{ id: string; status: string; authorizationUrl: string }>;
  }
  try {
    for (const id of ids) await withPrivateUser(id, () => prisma.user.create({ data: {
      id, email: `${id}@example.invalid`, name: "Disposable mobile DigiLocker verification", aiProcessingEnabled: false,
    } }));
    const availability = await request(prefix + "/status");
    check("authenticated production status is configured", availability.status === 200 && (await availability.json()).configured === true);
    for (const redirectUrl of ["https://evil.example", "readiness://documents", "readiness://digilocker/", "readiness://digilocker?next=evil"]) {
      const response = await request(prefix + "/sessions", 0, { redirectUrl });
      check("non-allow-listed return rejected: " + redirectUrl, response.status === 400);
    }
    const mobile = await start({ redirectUrl: "readiness://digilocker" });
    check("mobile session creation succeeds", mobile.status === "PENDING");
    const authorization = new URL(mobile.authorizationUrl);
    check("mobile retains registered backend callback and PKCE", authorization.searchParams.get("redirect_uri") === config.redirectUri && authorization.searchParams.get("code_challenge_method") === "S256");
    for (const suffix of ["status", "documents", "cancel", "import"]) {
      const body = suffix === "cancel" ? {} : suffix === "import" ? { references: ["fixture"], consent: true, consentVersion: "digilocker-copy-v1" } : undefined;
      const response = await request(`${prefix}/sessions/${mobile.id}/${suffix}`, 1, body);
      check("cross-account " + suffix + " denied", response.status === 404);
    }
    const pending = await request(`${prefix}/sessions/${mobile.id}/status`);
    check("owned status is pending and uncached", pending.status === 200 && (pending.headers.get("cache-control") ?? "").includes("no-store") && (await pending.json()).status === "PENDING");
    const pendingImport = await request(`${prefix}/sessions/${mobile.id}/import`, 0, { references: ["fixture"], consent: true, consentVersion: "digilocker-copy-v1" });
    check("pending OAuth cannot copy documents", pendingImport.status === 409);
    const noConsent = await request(`${prefix}/sessions/${mobile.id}/import`, 0, { references: ["fixture"], consent: false, consentVersion: "digilocker-copy-v1" });
    check("explicit consent required", noConsent.status === 400);
    // Exercise the registered root forwarding and a genuine stored one-time state,
    // with synthetic denial. This does not claim to be real provider OAuth.
    const query = new URLSearchParams({ state: authorization.searchParams.get("state")!, error: "access_denied", redirectUrl: "https://evil.example" });
    const entry = await request("/?" + query);
    const entryLocation = entry.headers.get("location") ?? "";
    check("registered root callback forwards to fixed backend handler", entry.status === 303 && entryLocation.startsWith(prefix + "/callback?"));
    const returned = await request(entryLocation);
    check("state-bound denial returns securely to mobile", returned.status === 303 && returned.headers.get("location") === `readiness://digilocker?digilocker=${mobile.id}&result=CONSENT_DENIED`);
    const denied = await request(`${prefix}/sessions/${mobile.id}/status`);
    check("mobile retrieves denied session from production", denied.status === 200 && (await denied.json()).status === "CONSENT_DENIED");
    const replay = await request(entryLocation);
    check("callback replay rejected", replay.status === 303 && (replay.headers.get("location") ?? "").includes("digilocker_error=invalid_state"));
    const web = await start({});
    const webState = new URL(web.authorizationUrl).searchParams.get("state")!;
    const webCallback = await request(`${prefix}/callback?${new URLSearchParams({ state: webState, error: "access_denied" })}`);
    check("existing web return fragment preserved", webCallback.status === 303 && webCallback.headers.get("location") === `${new URL("/documents", process.env.FRONTEND_URL).toString()}#digilocker=${web.id}&result=CONSENT_DENIED`);
    const cancelled = await start({ redirectUrl: "readiness://digilocker" });
    const cancellation = await request(`${prefix}/sessions/${cancelled.id}/cancel`, 0, {});
    check("mobile disconnect succeeds", cancellation.status === 200 && (await cancellation.json()).status === "CANCELLED");
    const raw = await withPrivateUser(ids[0], () => prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id: cancelled.id, userId: ids[0] } }));
    check("disconnect clears pending PKCE credentials", raw.encryptedCredentials === null);
    const expired = await start({ redirectUrl: "readiness://digilocker" });
    await withPrivateUser(ids[0], () => prisma.digiLockerConsentSession.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 60_000) } }));
    const expiry = await request(`${prefix}/sessions/${expired.id}/status`);
    check("expired mobile session becomes EXPIRED", expiry.status === 200 && (await expiry.json()).status === "EXPIRED");
    const expiredRaw = await withPrivateUser(ids[0], () => prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id: expired.id, userId: ids[0] } }));
    check("expiry clears credentials", expiredRaw.encryptedCredentials === null);
    const invalid = await request(`${prefix}/sessions/${randomUUID()}/status`);
    check("invalid session returns 404", invalid.status === 404);
    console.log(JSON.stringify({ event: "digilocker_mobile_hosted_verification", passed: checks.length,
      realOAuth: false, realDocumentListing: false, realDocumentImport: false }));
  } finally {
    for (const id of ids) await withPrivateUser(id, () => prisma.user.deleteMany({ where: { id } }));
    await prisma.$disconnect();
    console.log(JSON.stringify({ event: "digilocker_mobile_fixture_cleanup", completed: true }));
  }
}
void main().catch(() => {
  console.error(JSON.stringify({ event: "digilocker_mobile_hosted_failed", details: "See named assertion; credentials are never logged." }));
  process.exitCode = 1;
});
