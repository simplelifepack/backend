import assert from "node:assert/strict";
import { test } from "node:test";

import { loadDigiLockerConfig } from "../../config/digilocker";
import { createCashfreeDigiLockerClient, DigiLockerDisabledError } from "./cashfreeClient";

test("disabled DigiLocker client does not call Cashfree without backend credentials", async () => {
  let called = false;
  const client = createCashfreeDigiLockerClient(loadDigiLockerConfig({
    CASHFREE_DIGILOCKER_ENVIRONMENT: "sandbox",
  }), (async () => {
    called = true;
    throw new Error("should not call provider");
  }) as typeof fetch);

  await assert.rejects(
    client.createUrl({
      verificationId: "readiness_test",
      documentRequested: ["AADHAAR"],
      redirectUrl: "https://example.com/documents",
    }),
    DigiLockerDisabledError,
  );
  assert.equal(called, false);
});

test("Cashfree DigiLocker client sends create, status, and document requests with backend credentials", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/digilocker") && init?.method === "POST") {
      return Response.json({ reference_id: 123, url: "https://verification-test.cashfree.com/dgl/mock", status: "PENDING" });
    }
    if (String(url).includes("/digilocker/document/PAN")) {
      return Response.json({ pan: "ABCDE1234F", name: "Readiness Test" });
    }
    return Response.json({ reference_id: 123, status: "AUTHENTICATED" });
  }) as typeof fetch;
  const client = createCashfreeDigiLockerClient(loadDigiLockerConfig({
    CASHFREE_DIGILOCKER_CLIENT_ID: "client",
    CASHFREE_DIGILOCKER_CLIENT_SECRET: "secret",
    CASHFREE_DIGILOCKER_ENVIRONMENT: "sandbox",
  }), fetchMock);

  const created = await client.createUrl({
    verificationId: "readiness_test",
    documentRequested: ["AADHAAR", "PAN"],
    redirectUrl: "https://example.com/documents",
  });
  assert.equal(created.url, "https://verification-test.cashfree.com/dgl/mock");

  const status = await client.getStatus({ verificationId: "readiness_test", referenceId: "123" });
  assert.equal(status.status, "AUTHENTICATED");

  const document = await client.getDocument({ verificationId: "readiness_test", referenceId: "123", documentType: "PAN" });
  assert.deepEqual(document, { pan: "ABCDE1234F", name: "Readiness Test" });

  assert.equal(calls.length, 3);
  assert.equal((calls[0]!.init!.headers as Record<string, string>)["x-client-id"], "client");
  assert.match(String(calls[1]!.url), /verification_id=readiness_test/);
  assert.match(String(calls[2]!.url), /\/digilocker\/document\/PAN\?/);
});
