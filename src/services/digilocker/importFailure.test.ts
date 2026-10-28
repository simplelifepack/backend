import assert from "node:assert/strict";
import { test } from "node:test";
import { importFailure } from "./importFailure";
test("known import diagnostics never echo private provider or Prisma messages", () => {
  const privateValue = "PRIVATE-DOCUMENT-CONTENT-AND-TOKEN";
  for (const error of [
    { code: "DIGILOCKER_ACCESS_DENIED", providerStatus: 403, message: privateValue },
    { code: "DIGILOCKER_INTEGRITY_FAILED", message: privateValue },
    { code: "STORAGE_LIMIT_EXCEEDED", message: privateValue },
    { name: "PrismaClientValidationError", message: privateValue },
    { code: "P2002", message: privateValue },
    { code: privateValue, message: privateValue }, null,
  ]) {
    const result = importFailure(error);
    assert(!JSON.stringify(result).includes(privateValue));
    assert(result.message.length > 0);
  }
  assert.equal(importFailure({ name: "PrismaClientValidationError" }).code, "DOCUMENT_SAVE_FAILED");
  assert.match(importFailure({ code: "DIGILOCKER_ACCESS_DENIED", providerStatus: 403 }).message, /denied access/);
  assert.equal(importFailure({ code: "DIGILOCKER_ACCESS_DENIED", providerStatus: 403 }).providerStatus, 403);
});
