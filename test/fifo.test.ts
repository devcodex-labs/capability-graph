import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityGraph, GraphError } from '../src/index.js';
import { readBounded } from '../src/loader.js';

// Named pipes in a trusted root must be rejected without blocking a libuv worker forever.
const skip = process.platform === 'win32' ? 'POSIX named pipes only' : false;
const within = <T>(work: Promise<T>, ms = 3000) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms).unref())]);
async function directory(): Promise<string> {
  const base = process.env.CG_TEST_DIR!; await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, 'fifo-'));
}

test('read_document rejects a named pipe instead of hanging', { skip }, async () => {
  const root = await directory(); execFileSync('mkfifo', [path.join(root, 'doc.md')]);
  const graph = await CapabilityGraph.open({ providers: [{ definition: { providerId: 'p', name: 'P', version: '1', capabilities: [{ id: 'a', name: 'A', description: 'A', documents: [{ id: 'd', source: { type: 'file', path: 'doc.md' } }] }] }, documentRoot: root }] });
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(within(graph.readDocument({ capabilityId: 'p::a', documentId: 'd' })), (e: unknown) => e instanceof GraphError && e.code === 'CG_DOCUMENT_UNREADABLE');
  } finally { await graph.close(); await rm(root, { recursive: true, force: true }); }
});

test('bounded provider reads reject a named pipe instead of hanging', { skip }, async () => {
  const root = await directory(); const file = path.join(root, 'provider.json'); execFileSync('mkfifo', [file]);
  try { await assert.rejects(within(readBounded(file, 1024)), /Not a regular file/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('maintenance refuses a named pipe in a managed host file instead of hanging', { skip }, async () => {
  const root = await directory(); const config = path.join(root, 'graph.json');
  await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'demo', name: 'Demo', version: '1', capabilities: [{ id: 'one', name: 'One', description: 'One capability' }] }));
  await writeFile(config, JSON.stringify({ providers: [{ file: './provider.json' }], allowedProviders: ['demo'] }));
  await mkdir(path.join(root, '.codex')); execFileSync('mkfifo', [path.join(root, '.codex/config.toml')]);
  try {
    const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'setup', '--host', 'codex', '--config', config, '--dry-run', '--json'], { cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, '.codex') }, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.signal, null, `CLI did not finish: ${result.stderr}`);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stdout, /not a bounded regular file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
