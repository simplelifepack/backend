import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mountedApiOperations } from "./mountedOperations";
import { expectedOperations } from "./openapi";

test("all mounted API routes match Swagger, including aliases and newly added operations", () => {
  const operations = mountedApiOperations();
  assert.deepEqual(operations, expectedOperations);
  assert(operations.includes("GET /api/search"));
  assert(operations.includes("POST /api/health/members/{memberId}/measurements"));
  assert(!operations.some(operation => operation.includes("/api/integrations/gmail")));
});

test("inventory reads active mounts, arrays, factories and named admin routers without executing source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readines-route-docs-"));
  try {
    fs.mkdirSync(path.join(root, "routes"));
    fs.writeFileSync(path.join(root, "app.ts"), `
      import billingRouter from './routes/billing.routes';
      throw new Error('Source must never execute');
      app.get('/health', handler);
      app.get(['/api-docs', '/api-docs/'], handler);
      app.get('/openapi.json', handler);
      app.use('/billing', middleware, billingRouter);
      app.use('/one', lazyRouter(() => import('./routes/shared.routes')));
      app.use('/two', lazyRouter(() => import('./routes/shared.routes')));
      app.use('/admin', lazyRouter(() => import('./routes/shared.routes'), 'adminRouter'));
      // app.use('/disabled', lazyRouter(() => import('./routes/disabled.routes')));
    `);
    fs.writeFileSync(path.join(root, "routes/billing.routes.ts"), `
      function billingRouter() { const router = Router(); router.post('/webhook', handler); return router; }
      export default billingRouter();
    `);
    fs.writeFileSync(path.join(root, "routes/shared.routes.ts"), `
      const router = Router();
      router.get(['/', '/list'], handler);
      router.patch('/:id', handler);
      adminRouter.post('/process', handler);
      // router.delete('/commented', handler);
      export default router;
    `);
    assert.deepEqual(mountedApiOperations(path.join(root, "app.ts")), [
      "GET /health", "POST /billing/webhook", "GET /one", "GET /one/list", "PATCH /one/{id}",
      "GET /two", "GET /two/list", "PATCH /two/{id}", "POST /admin/process",
    ].sort());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
