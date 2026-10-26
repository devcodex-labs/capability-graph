import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { GraphError } from '../src/index.js';
import { createOpenAIExecutor } from '../src/adapters/openai.js';

type SelectRequest = Parameters<ReturnType<typeof createOpenAIExecutor>['select']>[0];
const keys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;

/** Runs one select call against local TCP endpoints with an isolated proxy environment. */
async function attempt(env: Partial<Record<typeof keys[number], string>>, proxyReply: 'close' | '502', baseHost = 'api.example.test') {
  const saved = keys.map(key => [key, process.env[key]] as const);
  const counts = { proxy: 0, direct: 0 };
  const proxy = net.createServer(socket => socket.once('data', () => { counts.proxy++; if (proxyReply === '502') socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); else socket.destroy(); }));
  const direct = net.createServer(socket => { counts.direct++; socket.destroy(); });
  await Promise.all([new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve)), new Promise<void>(resolve => direct.listen(0, '127.0.0.1', resolve))]);
  const proxyURL = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
  const directPort = (direct.address() as net.AddressInfo).port;
  try {
    for (const key of keys) delete process.env[key];
    for (const [key, value] of Object.entries(env)) process.env[key] = value === 'PROXY' ? proxyURL : value;
    const executor = createOpenAIExecutor({ apiKey: 'synthetic', model: 'controlled', baseURL: `https://${baseHost}:${directPort}/v1` });
    const started = Date.now();
    let failure: unknown;
    try { await executor.select({ input: 'x', context: {}, catalog: [{ id: 'acme::route', providerId: 'acme', name: 'Route', description: 'HTTP routes' }], revision: 'r', signal: AbortSignal.timeout(3000) } as unknown as SelectRequest); }
    catch (error) { failure = error; }
    return { ...counts, failure, elapsed: Date.now() - started };
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    proxy.close(); direct.close();
  }
}

test('OpenAI adapter bypasses the proxy for NO_PROXY hosts as documented', async () => {
  // Use the IPv4 literal the local server listens on: `localhost` may resolve to ::1 first (seen on Windows with Node 22.12).
  const result = await attempt({ HTTPS_PROXY: 'PROXY', NO_PROXY: '127.0.0.1' }, '502', '127.0.0.1');
  assert.equal(result.proxy, 0);
  assert.ok(result.direct >= 1);
  assert.ok(result.failure instanceof GraphError);
});

test('OpenAI adapter still tunnels hosts that NO_PROXY does not list', async () => {
  const result = await attempt({ HTTPS_PROXY: 'PROXY', NO_PROXY: 'internal.example' }, '502');
  assert.equal(result.proxy, 1);
  assert.ok(result.failure instanceof GraphError && result.failure.code === 'CG_MODEL_UNAVAILABLE');
});

test('an empty proxy variable is treated as unset instead of hiding the next one', async () => {
  const result = await attempt({ HTTPS_PROXY: '', https_proxy: 'PROXY' }, '502');
  assert.equal(result.proxy, 1);
  assert.ok(result.failure instanceof GraphError && result.failure.code === 'CG_MODEL_UNAVAILABLE');
});

test('a proxy that closes the CONNECT tunnel fails fast without hidden reconnects', async () => {
  const result = await attempt({ HTTPS_PROXY: 'PROXY' }, 'close');
  assert.ok(result.failure instanceof GraphError && result.failure.code === 'CG_MODEL_UNAVAILABLE', String(result.failure));
  assert.ok(result.proxy <= 2, `proxy saw ${result.proxy} CONNECT attempts`);
  assert.ok(result.elapsed < 2000, `took ${result.elapsed}ms`);
});
