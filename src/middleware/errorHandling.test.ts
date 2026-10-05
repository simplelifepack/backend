import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleLoadDiagnostic } from "./errorHandling";

test("module diagnostics expose a missing dependency without its stack or paths", () => {
  const error = Object.assign(new Error("Cannot find module 'openai/helpers/zod'\nRequire stack:\n/var/task/src/app.js"), { code: "MODULE_NOT_FOUND" });
  assert.deepEqual(moduleLoadDiagnostic(error), { code: "MODULE_NOT_FOUND", moduleName: "openai/helpers/zod" });
});

test("module diagnostics omit absolute paths and arbitrary error messages", () => {
  const error = Object.assign(new Error("Cannot find module '/Users/private/token'"), { code: "MODULE_NOT_FOUND" });
  assert.deepEqual(moduleLoadDiagnostic(error), { code: "MODULE_NOT_FOUND" });
  assert.deepEqual(moduleLoadDiagnostic(new Error("postgres://private-password")), {});
});
