import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPackageInput } from './packageInput';
import { OpenAIProvider } from './providers/openai';
import { readProviderStream } from './providerStream';
import { analyzeIntent } from './analyzeIntent';
import { UsageLimitError } from '../services/accountUsage.service';

const valid = {
  packageName: 'Passport', category: 'Travel', description: 'Passport requirements',
  sourceTitle: 'Passport', sourceUrl: 'https://passportindia.gov.in/', sourceOrganization: 'Government', lastChecked: '2026-09-07',
  verificationSources: [{ title: 'Passport', url: 'https://passportindia.gov.in/', organization: 'Government', type: 'government', retrievedAt: '2026-09-07' }],
  requiredDocuments: [{ id: 'photo', category: 'identity', documentType: 'photo', owner: 'self', name: 'Photo', title: 'Photo', required: true, whyNeeded: 'Identification', sourceName: 'Government', sourceUrl: 'https://passportindia.gov.in/', sourceAuthorityTier: 'government', lastVerifiedAt: '2026-09-07' }],
};
const sse = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');

test('strict public payload rejects full documents/config and filters arbitrary labels', () => {
  assert.deepEqual(buildPackageInput({ packageType: 'Home Loan', documentLabels: ['PAN', 'Payslip', 'PAN', 'Salary 50000', 'my address is private'] }), {
    packageType: 'Home Loan', availableDocumentLabels: ['pan', 'salary_slip'],
  });
  for (const field of ['documents', 'rawText', 'fields', 'image', 'apiKey', 'model', 'tools', 'isPaid', 'tier']) {
    assert.throws(() => buildPackageInput({ packageType: 'Passport', documentLabels: [], [field]: 'private' }));
  }
  assert.throws(() => buildPackageInput({ packageType: 'Passport', documentLabels: [{ documentType: 'pan', rawText: 'private' }] }));
  for (const packageType of ['PAN ABCDE1234F', 'Aadhaar 1234 5678 9012', 'Passport A1234567', 'data:base64 private', 'address: private']) {
    assert.throws(() => buildPackageInput({ packageType, documentLabels: [] }));
  }
});

test('backend attaches key, web search and model; streams before completion; one quota action', async () => {
  const fetchBefore = global.fetch;
  let count = 0;
  const chunks: string[] = [];
  try {
    global.fetch = async (_url, options) => {
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer server-test-key');
      const body = JSON.parse(options?.body as string);
      assert.equal(body.model, 'server-model');
      assert.equal(body.stream, true); assert.equal(body.store, false);
      assert.equal(body.tools[0].search_context_size, 'low');
      assert.ok(['web_search', 'web_search_preview'].includes(body.tools[0].type));
      assert.deepEqual(JSON.parse(body.input), { packageType: 'Passport', availableDocumentLabels: ['photo'] });
      const text = JSON.stringify(valid);
      return new Response(sse([{ type: 'response.output_text.delta', delta: text.slice(0, 40) }, { type: 'response.output_text.delta', delta: text.slice(40) }, { type: 'response.completed' }]));
    };
    const result = await new OpenAIProvider('server-test-key', 'server-model').analyzeIntent(JSON.stringify(buildPackageInput({ packageType: 'Passport', documentLabels: ['photo'] })), {
      beforeRequest: async () => { count++; }, onDelta: delta => chunks.push(delta),
    });
    assert.equal(result.packageName, 'Passport'); assert.equal(count, 1); assert.equal(chunks.length, 2);
  } finally { global.fetch = fetchBefore; }
});

test('quota rejection and invalid payload invoke no provider', async () => {
  const before = global.fetch;
  let requests = 0;
  try {
    global.fetch = async () => { requests++; return new Response(); };
    await assert.rejects(new OpenAIProvider('server-test-key').analyzeIntent('{}', { beforeRequest: async () => { throw new UsageLimitError('AI_MONTHLY_LIMIT_EXCEEDED', { used: 3 }); } }), error => (error as UsageLimitError).code === 'AI_MONTHLY_LIMIT_EXCEEDED');
    await assert.rejects(analyzeIntent('unused-user', { packageType: 'Passport', documents: [{ rawText: 'private' }] }));
    assert.equal(requests, 0);
  } finally { global.fetch = before; }
});

test('internal provider retry consumes only one action and does not expose upstream body', async () => {
  const before = global.fetch;
  let requests = 0; let actions = 0;
  try {
    global.fetch = async () => ++requests === 1 ? new Response('private provider diagnostic', { status: 503 }) : new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(valid) }] }] }));
    await new OpenAIProvider('server-test-key').analyzeIntent('{}', { beforeRequest: async () => { actions++; } });
    assert.equal(actions, 1); assert.equal(requests, 2);
    global.fetch = async () => new Response('private provider diagnostic', { status: 401 });
    await assert.rejects(new OpenAIProvider('server-test-key').analyzeIntent('{}'), error => !(error as Error).message.includes('private'));
  } finally { global.fetch = before; }
});

test('provider failures, malformed and truncated streams are rejected', async () => {
  for (const body of [sse([{ type: 'response.failed' }]), sse([{ type: 'response.output_text.delta', delta: '{}' }]), 'data: broken\n\n']) {
    await assert.rejects(readProviderStream(new Response(body), () => undefined));
  }
});

test('client disconnect aborts upstream fetch; cancellation before invocation does not count', async () => {
  const before = global.fetch;
  const controller = new AbortController();
  let actions = 0; let aborted = false;
  try {
    global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled', 'AbortError')); });
      controller.abort();
    });
    await assert.rejects(new OpenAIProvider('server-test-key').analyzeIntent('{}', { signal: controller.signal, beforeRequest: async () => { actions++; } }));
    assert.equal(aborted, true); assert.equal(actions, 1);
    actions = 0;
    await assert.rejects(new OpenAIProvider('server-test-key').analyzeIntent('{}', { signal: controller.signal, beforeRequest: async () => { actions++; } }));
    assert.equal(actions, 0);
  } finally { global.fetch = before; }
});

test('UTF-8 and SSE frames tolerate single byte chunks', async () => {
  const bytes = new TextEncoder().encode(sse([{ type: 'response.output_text.delta', delta: 'café' }, { type: 'response.completed' }]));
  let i = 0;
  const response = new Response(new ReadableStream({ pull(controller) { if (i === bytes.length) controller.close(); else controller.enqueue(bytes.slice(i, ++i)); } }));
  assert.equal(await readProviderStream(response, () => undefined), 'café');
});

test('cancellation while reserving refunds before any provider invocation', async () => {
  const controller = new AbortController();
  let refunded = false;
  await assert.rejects(new OpenAIProvider('server-test-key').analyzeIntent('{}', {
    signal: controller.signal,
    beforeRequest: async () => { controller.abort(); return async () => { refunded = true; }; },
  }));
  assert.equal(refunded, true);
});
