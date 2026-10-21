import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityGraph, GraphError } from '../src/index.js';
import { createOpenAIExecutor } from '../src/adapters/openai.js';
import { createCodexExecutor } from '../src/adapters/codex.js';
import type { ModelExecutor } from '../src/index.js';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses';

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
test('Codex adapter rejects unsupported platforms or a missing CLI before starting a model', async () => {
  const g = await graph(createCodexExecutor({ command: '/definitely-absent-codex-cli', scratchRoot: process.env.CG_TEST_DIR! }));
  await assert.rejects(g.match({ input: 'x' }), error(process.platform === 'linux' ? 'CG_MODEL_UNAVAILABLE' : 'CG_MODEL_EXECUTOR_UNSAFE')); await g.close();
  assert.throws(() => createCodexExecutor({ maxOutputBytes: 0 }), error('CG_CONFIG_INVALID'));
});

const completeResponse = {
  // SDK 7 adds metadata absent from SDK 6's type; retain it without widening the response contract.
  id: 'resp_boundary', object: 'response', created_at: 1, ...{ access_programs: null },
  output_text: JSON.stringify(wire), status: 'completed', error: null, incomplete_details: null,
  instructions: null, metadata: {}, model: 'controlled', parallel_tool_calls: false,
  temperature: 1, tool_choice: 'auto', tools: [], top_p: 1,
  output: [{ type: 'message', role: 'assistant', id: 'msg_boundary', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(wire), annotations: [], logprobs: [] }] }],
} satisfies OpenAIResponse;

for (const [label, overrides, code] of [
  ['failed', { status: 'failed', error: { code: 'server_error', message: 'private upstream detail' } }, 'CG_MODEL_UNAVAILABLE'],
  ['cancelled', { status: 'cancelled' }, 'CG_MODEL_CANCELLED'],
  ['queued', { status: 'queued' }, 'CG_MODEL_OUTPUT_INVALID'],
  ['in progress', { status: 'in_progress' }, 'CG_MODEL_OUTPUT_INVALID'],
  ['incomplete', { status: 'incomplete' }, 'CG_MODEL_OUTPUT_INVALID'],
  ['unknown status', { status: 'unknown' }, 'CG_MODEL_OUTPUT_INVALID'],
  ['missing status', { status: undefined }, 'CG_MODEL_OUTPUT_INVALID'],
  ['completed with error', { error: { code: 'server_error', message: 'private upstream detail' } }, 'CG_MODEL_OUTPUT_INVALID'],
  ['missing error field', { error: undefined }, 'CG_MODEL_OUTPUT_INVALID'],
] as const) test(`OpenAI final response rejects ${label} even with valid selection output`, async () => {
  let calls = 0;
  const g = await graph(createOpenAIExecutor({ apiKey: 'synthetic', model: 'controlled', fetch: async () => { calls++; return Response.json({ ...completeResponse, ...overrides }); } }));
  try { await assert.rejects(g.match({ input: 'x' }), e => error(code)(e) && !(e as Error).message.includes('private')); assert.equal(calls, 1); }
  finally { await g.close(); }
});

for (const [label, content] of [
  ['null', [null]], ['primitive', [7]], ['missing type', [{}]],
  ['invalid text', [{ type: 'output_text', text: 7 }]],
  ['invalid refusal', [{ type: 'refusal', refusal: null }]],
  ['unknown type', [{ type: 'unknown', text: JSON.stringify(wire) }]],
] as const) test(`OpenAI malformed content ${label} is output-invalid`, async () => {
  const envelope = { ...completeResponse, output: [{ ...completeResponse.output[0], content }] };
  const g = await graph(createOpenAIExecutor({ apiKey: 'synthetic', model: 'controlled', fetch: async () => Response.json(envelope) }));
  try { await assert.rejects(g.match({ input: 'x' }), error('CG_MODEL_OUTPUT_INVALID')); } finally { await g.close(); }
});

test('OpenAI transport TypeError remains unavailable rather than a decoded-output failure', async () => {
  const g = await graph(createOpenAIExecutor({ apiKey: 'synthetic', model: 'controlled', fetch: async () => { throw new TypeError('private network detail'); } }));
  try { await assert.rejects(g.match({ input: 'x' }), e => error('CG_MODEL_UNAVAILABLE')(e) && !(e as Error).message.includes('private')); } finally { await g.close(); }
});
