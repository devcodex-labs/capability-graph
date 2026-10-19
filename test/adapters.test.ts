import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityGraph, GraphError } from '../src/index.js';
import { createOpenAIExecutor } from '../src/adapters/openai.js';
import { createCodexExecutor } from '../src/adapters/codex.js';
import type { ModelExecutor } from '../src/index.js';

const graph = (model: ModelExecutor) => CapabilityGraph.open({ providers: [{ definition: { providerId: 'acme', name: 'Acme', version: '1', capabilities: [{ id: 'route', name: 'Route', description: 'HTTP routes' }] } }], model });
const error = (code: string) => (e: unknown) => e instanceof GraphError && e.code === code;
const wire = { decision: 'selected', ids: ['acme::route'], reason: null, missingInformation: [] };
function output(text: string, refusal = false): Response {
  return Response.json({ id: 'resp_synthetic', object: 'response', created_at: 1, status: 'completed', model: 'controlled-transport', error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', id: 'msg_synthetic', status: 'completed', content: refusal ? [{ type: 'refusal', refusal: text }] : [{ type: 'output_text', text, annotations: [] }] }] });
}
test('OpenAI adapter uses the actual SDK strict Responses protocol with only authorized selection data', async () => {
  let calls = 0;
  const model = createOpenAIExecutor({ apiKey: 'synthetic-test-key', model: 'controlled-transport', fetch: async (url, init) => {
    calls++; assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-test-key');
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, 'controlled-transport'); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema.required, ['decision', 'ids', 'reason', 'missingInformation']);
    const data = JSON.parse(body.input); assert.equal(data.input, 'Create a route'); assert.deepEqual(data.catalog.map((c: { id: string }) => c.id), ['acme::route']);
    assert(!body.input.includes('synthetic-test-key')); assert.deepEqual(Object.keys(data).sort(), ['catalog', 'context', 'input', 'revision']);
    return output(JSON.stringify(wire));
  } });
  const g = await graph(model); const result = await g.match({ input: 'Create a route' }); assert.equal(result.status, 'matched'); assert.equal(calls, 1); await g.close();
});
for (const [label, response, code] of [
  ['refusal', () => output('Synthetic refusal', true), 'CG_MODEL_REFUSED'],
  ['malformed JSON', () => output('{not JSON'), 'CG_MODEL_OUTPUT_INVALID'],
  ['missing wire fields', () => output(JSON.stringify({ decision: 'selected', ids: ['acme::route'] })), 'CG_MODEL_OUTPUT_INVALID'],
  ['unknown selected ID', () => output(JSON.stringify({ ...wire, ids: ['acme::invented'] })), 'CG_MODEL_INVALID_SELECTION'],
  ['authentication', () => Response.json({ error: { message: 'synthetic private server detail', code: 'invalid_api_key', type: 'invalid_request_error' } }, { status: 401 }), 'CG_MODEL_UNAVAILABLE'],
  ['context', () => Response.json({ error: { message: 'synthetic private prompt detail', code: 'context_length_exceeded', type: 'invalid_request_error' } }, { status: 400 }), 'CG_MODEL_CONTEXT_EXCEEDED'],
] as const) test(`OpenAI controlled transport ${label} fails safely without retries`, async () => {
  let calls = 0; const g = await graph(createOpenAIExecutor({ apiKey: 'synthetic', model: 'controlled', fetch: async () => { calls++; return response(); } }));
  await assert.rejects(g.match({ input: 'x' }), e => error(code)(e) && !(e as Error).message.includes('private')); assert.equal(calls, 1); await g.close();
});
test('OpenAI output budget, configuration and pre-cancel fail explicitly', async () => {
  const g = await graph(createOpenAIExecutor({ apiKey: 'synthetic', model: 'controlled', maxOutputBytes: 10, fetch: async () => output(JSON.stringify(wire)) }));
  await assert.rejects(g.match({ input: 'x' }), error('CG_MODEL_OUTPUT_TOO_LARGE')); await g.close();
  assert.throws(() => createOpenAIExecutor({ apiKey: '', model: 'x' }), error('CG_CONFIG_INVALID'));
  assert.throws(() => createOpenAIExecutor({ apiKey: 'x', model: 'x', baseURL: 'http://example.com' }), error('CG_CONFIG_INVALID'));
  let calls = 0; const model = createOpenAIExecutor({ apiKey: 'synthetic', model: 'controlled', fetch: async () => { calls++; return output(JSON.stringify(wire)); } });
  await assert.rejects(model.select({ input: 'x', catalog: [], context: {}, revision: 'x', signal: AbortSignal.abort() }), error('CG_MODEL_CANCELLED')); assert.equal(calls, 0);
});
test('Codex adapter never starts a model without a usable explicitly resolved CLI', async () => {
  const g = await graph(createCodexExecutor({ command: '/definitely-absent-codex-cli', scratchRoot: process.env.CG_TEST_DIR! }));
  await assert.rejects(g.match({ input: 'x' }), error('CG_MODEL_UNAVAILABLE')); await g.close();
  assert.throws(() => createCodexExecutor({ maxOutputBytes: 0 }), error('CG_CONFIG_INVALID'));
});
