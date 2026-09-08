import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import packsRouter from './packs.routes';
import { errorHandler } from '../middleware/errorHandling';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../utils/jwt';
import { getAccountUsage } from '../services/accountUsage.service';

async function run() {
  const userId = `package-http-${crypto.randomUUID()}`;
  const names: string[] = [];
  const randomName = () => `Z${crypto.randomBytes(18).toString('hex').replace(/[0-9]/g, value => String.fromCharCode(103 + Number(value)))}`;
  const nativeFetch = global.fetch;
  const apiKey = process.env.OPENAI_API_KEY;
  const override = process.env.READINESS_AI_PROVIDER;
  process.env.OPENAI_API_KEY = 'test-server-only'; process.env.READINESS_AI_PROVIDER = 'openai';
  let calls = 0;
  let aborted = false;
  let stall = false;
  const app = express(); app.use(express.json()); app.use('/api/packages', packsRouter); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = signAccessToken({ sub: userId, email: `${userId}@example.invalid` });
  const request = (body: unknown, stream = false, signal?: AbortSignal) => nativeFetch(`${base}/api/packages/search-or-generate`, { method: 'POST', signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(stream ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify(body) });
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return nativeFetch(url, options);
    calls++;
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-server-only');
    const input = JSON.parse(options?.body as string);
    const { packageType, availableDocumentLabels } = JSON.parse(input.input);
    assert.deepEqual(availableDocumentLabels, ['pan']);
    const generated = { packageName: packageType, category: 'travel', description: 'Public requirements', sourceTitle: 'Passport', sourceUrl: 'https://passportindia.gov.in/', sourceOrganization: 'Government', lastChecked: new Date().toISOString(), verificationSources: [{ title: 'Passport', organization: 'Government', url: 'https://passportindia.gov.in/', type: 'government', retrievedAt: new Date().toISOString() }], requiredDocuments: [{ id: 'photo', category: 'photo', documentType: 'photo', owner: 'self', name: 'Photo', title: 'Photo', required: true, whyNeeded: 'Identity', sourceName: 'Government', sourceUrl: 'https://passportindia.gov.in/', sourceAuthorityTier: 'government', lastVerifiedAt: new Date().toISOString() }] };
    const text = JSON.stringify(generated);
    if (input.stream) {
      return new Response(new ReadableStream({ start(controller) {
        const write = (data: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
        write({ type: 'response.output_text.delta', delta: text });
        if (stall) options?.signal?.addEventListener('abort', () => { aborted = true; controller.error(new DOMException('Disconnected', 'AbortError')); }, { once: true });
        else { write({ type: 'response.completed' }); controller.close(); }
      } }));
    }
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text }] }] }));
  };
  try {
    await prisma.user.create({ data: { id: userId, name: 'Test', email: `${userId}@example.invalid` } });
    assert.equal((await request({ packageType: randomName(), documentLabels: [], documents: [{ rawText: 'private' }] })).status, 400);
    assert.equal(calls, 0); assert.equal((await getAccountUsage(userId)).aiUsage.used, 0);
    for (let i = 0; i < 3; i++) {
      const name = randomName(); names.push(name);
      const response = await request({ packageType: name, documentLabels: ['PAN'] }, i === 0);
      assert.equal(response.status, 200, await response.clone().text());
      const text = await response.text();
      if (i === 0) { assert.ok(text.includes('event: delta')); assert.ok(text.includes('event: result')); }
    }
    assert.equal(calls, 3); assert.equal((await getAccountUsage(userId)).aiUsage.used, 3);
    const cached = await request({ packageType: names[0], documentLabels: ['PAN'] });
    assert.equal(cached.status, 200); assert.equal(calls, 3, 'Existing package never consumes quota');
    const response = await request({ packageType: randomName(), documentLabels: ['PAN'] }, true);
    assert.equal(response.status, 429); assert.equal((await response.json()).code, 'AI_MONTHLY_LIMIT_EXCEEDED');
    assert.equal(calls, 3, 'Quota rejects before contacting upstream');
    await prisma.user.update({ where: { id: userId }, data: { accountTier: 'paid' } });
    const paidName = randomName(); names.push(paidName);
    assert.equal((await request({ packageType: paidName, documentLabels: ['PAN'] })).status, 200);
    assert.equal(calls, 4);
    stall = true;
    const controller = new AbortController();
    const pending = await request({ packageType: randomName(), documentLabels: ['PAN'] }, true, controller.signal);
    const reader = pending.body!.getReader(); await reader.read(); controller.abort();
    for (let i = 0; i < 30 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(aborted, true, 'HTTP disconnect aborts provider stream');
    console.log('PASS: HTTP package streaming, strict privacy rejection, first three/fourth, cache exemption, paid bypass from database only, and upstream disconnect cleanup.');
  } finally {
    global.fetch = nativeFetch;
    if (apiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = apiKey;
    if (override === undefined) delete process.env.READINESS_AI_PROVIDER; else process.env.READINESS_AI_PROVIDER = override;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.readinessPack.deleteMany({ where: { title: { in: names } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
