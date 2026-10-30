import assert from "node:assert/strict";
import { test } from "node:test";
import { digiLockerReturnTarget, digiLockerReturnUrl } from "./returnTarget";

test("only exact configured web and fixed native return targets are allowed", () => {
  const web = digiLockerReturnTarget();
  assert.equal(digiLockerReturnTarget(web), web);
  assert.equal(digiLockerReturnTarget("readiness://digilocker"), "readiness://digilocker");
  for (const target of ["https://evil.example", "readiness://documents", "readiness://digilocker/", "readiness://digilocker?next=evil", "readiness://digilocker#x", "READINESS://digilocker", "readiness://user@digilocker", `${web}?next=evil`]) {
    assert.throws(() => digiLockerReturnTarget(target), { statusCode: 400, code: "DIGILOCKER_INVALID_REQUEST" });
  }
  assert.throws(() => digiLockerReturnUrl({ id: "bad", status: "FAILED", redirectUrl: "https://evil.example" }));
});
test("native returns contain only a session on success or an allow-listed error", () => {
  const redirectUrl = "readiness://digilocker";
  assert.equal(digiLockerReturnUrl({ id: "owned", status: "AUTHENTICATED", redirectUrl, returnFormat: "session-v1" }), "readiness://digilocker?session=owned");
  for (const [status, code] of Object.entries({ CONSENT_DENIED: "consent_denied", FAILED: "authorization_failed", EXPIRED: "session_expired", CANCELLED: "cancelled", "private-provider-message": "authorization_failed" })) {
    assert.equal(digiLockerReturnUrl({ id: "owned", status, redirectUrl, returnFormat: "session-v1" }), `readiness://digilocker?error=${code}`);
  }
  assert.equal(digiLockerReturnUrl({ id: "legacy", status: "CONSENT_DENIED", redirectUrl }), "readiness://digilocker?digilocker=legacy&result=CONSENT_DENIED");
  const web = digiLockerReturnTarget();
  assert.equal(digiLockerReturnUrl({ id: "web", status: "AUTHENTICATED", redirectUrl: web }), `${web}#digilocker=web&result=AUTHENTICATED`);
});
