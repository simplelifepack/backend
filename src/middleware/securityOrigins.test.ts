import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import cors from "cors";
import { corsOptions } from "./security";
import { errorHandler } from "./errorHandling";

test("untrusted origins are forbidden before handlers; allowed origins and originless clients keep working", async () => {
  const app = express(); let handled = 0;
  app.use(cors(corsOptions));
  app.all("/protected", (_req, res) => { handled++; res.status(401).json({ message: "Unauthorized." }); });
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/protected`;
  try {
    for (const origin of ["https://attacker.example", "https://readines.com.attacker.example", "https://readines.com@attacker.example", "null", "http://readines.com"]) {
      for (const method of ["GET", "POST", "OPTIONS"]) {
        const response = await fetch(url, { method, headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
        assert.equal(response.status, 403, `${method} with ${origin}`);
        assert.equal(response.headers.get("access-control-allow-origin"), null);
        const body = await response.text(); assert(!/stack|node_modules|Prisma/i.test(body));
      }
    }
    assert.equal(handled, 0);
    for (const origin of [undefined, "https://readines.com", "https://www.readines.com"]) {
      const response = await fetch(url, { headers: origin ? { Origin: origin } : {} });
      assert.equal(response.status, 401);
      if (origin) assert.equal(response.headers.get("access-control-allow-origin"), origin);
      await response.arrayBuffer();
    }
    assert.equal(handled, 3);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
