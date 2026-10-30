import assert from "node:assert/strict";
import type { Request, Response } from "express";
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

test("DigiLocker session errors expose stable codes without private input", async () => {
  const { buildErrorResponse } = await import("./errorHandling");
  for (const [statusCode, code] of [[404, "DIGILOCKER_SESSION_NOT_FOUND"], [400, "DIGILOCKER_INVALID_REQUEST"], [409, "DIGILOCKER_SESSION_CONFLICT"]] as const) {
    const response = buildErrorResponse({ error: Object.assign(new Error("private-provider-input"), { statusCode, code }), production: true });
    assert.equal(response.status, statusCode);
    assert.equal(response.body.code, code);
    assert(!JSON.stringify(response).includes("private-provider-input"));
  }
});

test("429 and busy errors provide Retry-After without replacing an existing deadline", async () => {
  const { errorHandler } = await import("./errorHandling");
  for (const [statusCode, existing, expected] of [[429, undefined, "2"], [503, undefined, "2"], [429, "60", "60"]] as const) {
    const headers = new Map<string, string>();
    if (existing) headers.set("Retry-After", existing);
    const res = { getHeader: (key: string) => headers.get(key), setHeader: (key: string, value: string) => headers.set(key, value), status: (value: number) => { assert.equal(value, statusCode); return res; }, json: () => res };
    errorHandler({ statusCode }, { method: "GET" } as Request, res as unknown as Response, () => {});
    assert.equal(headers.get("Retry-After"), expected);
  }
});
