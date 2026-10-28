import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { digiLockerCallbackEntry } from "./digilockerCallbackEntry";
function invoke(path: string, query: Record<string, unknown>, method = "GET") {
  const result = { next: false, status: 0, location: "", headers: {} as Record<string, string> };
  const response = { setHeader: (key: string, value: string) => { result.headers[key] = value; }, redirect: (status: number, location: string) => { result.status = status; result.location = location; } };
  digiLockerCallbackEntry({ path, query, method } as Request, response as unknown as Response, () => { result.next = true; });
  return result;
}
test("registered backend root forwards only OAuth fields to the fixed state validator", () => {
  const result = invoke("/", { code: "provider-code", state: "provider-state", redirect: "https://untrusted.example", error_description: "private" });
  assert.equal(result.status, 303);
  assert.equal(result.location, "/api/integrations/digilocker/callback?state=provider-state&code=provider-code");
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.headers["Referrer-Policy"], "no-referrer");
});
test("provider denial and duplicate values still reach existing callback validation", () => {
  assert.match(invoke("/", { error: "access_denied", state: "state" }).location, /error=access_denied/);
  assert.match(invoke("/", { code: "code", state: ["first", "second"] }).location, /state=first&state=second/);
});
test("ordinary root requests, other routes and POST preserve their behavior", () => {
  assert(invoke("/", {}).next);
  assert(invoke("/health", { code: "code", state: "state" }).next);
  assert(invoke("/", { code: "code", state: "state" }, "POST").next);
});
