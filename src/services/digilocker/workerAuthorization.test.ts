import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { authorizedWorker } from "./workerAuthorization";

test("worker accepts configured cron or Vault bearer but rejects digests and missing configuration", () => {
  const digest = createHash("sha256").update("vault-fixture").digest("hex");
  assert(authorizedWorker("Bearer cron-fixture", "cron-fixture", digest));
  assert(authorizedWorker("Bearer vault-fixture", "cron-fixture", digest));
  for (const value of [undefined, "", "Bearer ", "Basic vault-fixture", "Bearer wrong", `Bearer ${digest}`]) {
    assert.equal(authorizedWorker(value, "cron-fixture", digest), false);
  }
  assert.equal(authorizedWorker("Bearer vault-fixture", "", ""), false);
  assert.equal(authorizedWorker("Bearer vault-fixture", "", "malformed"), false);
});
