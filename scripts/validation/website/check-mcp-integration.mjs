import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createTemporaryDirectory, artifactsRoot } from '../../lib/artifact-paths.mjs';
import { websiteRoot } from '../../lib/website-paths.mjs';
import { loadTutorial } from './lib/tutorial.mjs';
import { installLocalConsumer } from './lib/consumer.mjs';

// Page code is authoritative. Fixtures and rewritten imports cannot fill gaps.
const page = await readFile(path.join(websiteRoot, 'docs/integrations/mcp-and-cli.mdx'), 'utf8');
const required = ['setup.mjs', 'toolkit.mjs', 'server-v1.mjs', 'server-v2.mjs', 'client.mjs',
  'http-server.mjs', 'http-client.mjs', 'cg.config.json', 'reader.mjs'];
const blocks = [...page.matchAll(/```(js|json) title="([^"]+)"\r?\n([\s\S]*?)\r?\n```/g)];
assert.deepEqual(blocks.map(([, , title]) => title).sort(), [...required].sort());
const root = await createTemporaryDirectory('mcp-docs-');
let httpServer, stopped;
const run = (file, args = []) => execFileSync(process.execPath, [path.join(root, file), ...args], {
  cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  env: { ...process.env, TMP: root, TEMP: root, TMPDIR: root }, windowsHide: true
});
try {
  await installLocalConsumer(root, { dependencies: ['@modelcontextprotocol/sdk@1.30.0',
    '@modelcontextprotocol/server@2.0.0', '@modelcontextprotocol/client@2.0.0'] });
  const first = await loadTutorial('G0');
  for (const [name, body] of first.files) if (name.startsWith('providers/')) {
    const target = path.join(root, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, body);
  }
  for (const [, language, name, body] of blocks) {
    assert(required.includes(name) && path.basename(name) === name);
    if (language === 'json') JSON.parse(body);
    await writeFile(path.join(root, name), body + '\n');
  }
  assert.deepEqual(JSON.parse(run('toolkit.mjs')), { toolCount: 12, catalog: ['route'], scope: ['acme.http'] });
  for (const server of ['server-v1.mjs', 'server-v2.mjs']) {
    assert.deepEqual(JSON.parse(run('client.mjs', [server])), { catalog: ['route'] });
  }
  const reader = JSON.parse(run('reader.mjs'));
  assert.equal(reader.sameBytes, true); assert(reader.pages > 1); assert.equal(reader.activeRequests, 0);
  const cli = path.join(root, 'node_modules/@devcodex/capability-graph/dist/cli/main.js');
  const providers = JSON.parse(execFileSync(process.execPath, [cli, 'provider', 'list', '--config', path.join(root, 'cg.config.json')], {
    cwd: root, encoding: 'utf8', timeout: 10_000
  }));
  assert(JSON.stringify(providers).includes('acme.http'), 'page configuration must load through the real CLI');
  httpServer = spawn(process.execPath, [path.join(root, 'http-server.mjs')], { cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  stopped = once(httpServer, 'exit');
  let logs = '';
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP guide startup deadline: ${logs}`)), 10_000);
    httpServer.once('error', error => { clearTimeout(timer); reject(error); });
    httpServer.once('exit', code => { clearTimeout(timer); reject(new Error(`HTTP guide exited ${code}: ${logs}`)); });
    httpServer.stderr.on('data', chunk => {
      logs += chunk.toString();
      for (const line of logs.split(/\r?\n/)) {
        try { const value = JSON.parse(line); if (value.url) { clearTimeout(timer); resolve(value); } } catch { /* incomplete line */ }
      }
    });
  });
  const text = run('http-client.mjs', [address.url]);
  const events = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()));
  assert(events.some(event => event.result?.structuredContent?.items?.[0]?.id?.capabilityId === 'route'), text);
  httpServer.stdin.end();
  const [code] = await Promise.race([stopped, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTP guide did not close')), 10_000); timer.unref();
  })]);
  assert.equal(code, 0);
  await new Promise((resolve, reject) => {
    const socket = net.connect(Number(new URL(address.url).port), '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); reject(new Error('guide left its port open')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
  console.log('MCP integration page passed: installed tarball, JSON/SDKv1/SDKv2, CLI config, HTTP SSE/port release, original-byte Reader pagination');
} finally {
  if (httpServer && httpServer.exitCode === null) { httpServer.kill(); await stopped; }
  assert.equal(path.dirname(root), artifactsRoot); assert(path.basename(root).startsWith('mcp-docs-'));
  await rm(root, { recursive: true, force: true });
}
