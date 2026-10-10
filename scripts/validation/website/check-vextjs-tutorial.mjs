import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, createTemporaryDirectory } from '../../lib/artifact-paths.mjs';
import { installLocalConsumer } from './lib/consumer.mjs';

const [frameworkRoot] = process.argv.slice(2);
assert(frameworkRoot, 'Usage: npm run test:docs:vextjs -- <built-fixed-vextjs>');
const source = await readFile(path.join(repositoryRoot, 'website/docs/examples/vextjs-integration.mdx'), 'utf8');
const root = await createTemporaryDirectory('vextjs-public-tutorial-');
try {
  for (const name of ['export-vextjs.mjs', 'discover-vextjs.mjs']) {
    const fences = [...source.matchAll(/```js title="([^"]+)"\r?\n([\s\S]*?)\r?\n```/g)].filter((match) => match[1] === name);
    assert.equal(fences.length, 1, `Public page must provide exactly one complete ${name}`);
    await writeFile(path.join(root, name), fences[0][2] + '\n');
  }
  await installLocalConsumer(root);
  const run = (file, args = []) => JSON.parse(execFileSync(process.execPath, [file, ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  }));
  const exported = run('export-vextjs.mjs', [repositoryRoot, path.resolve(frameworkRoot)]);
  assert.equal(exported.capabilities, 46); assert.equal(exported.documents, 91);
  assert.equal(exported.commit, 'ef926649926e17543562b8169982fa1786285ecf');
  const discovered = run('discover-vextjs.mjs');
  const body = await readFile(path.join(frameworkRoot, 'website/docs/zh/guide/routing.md'));
  const hash = createHash('sha256').update(body).digest('hex');
  assert.equal(discovered.capabilityId, 'routing');
  assert.equal(discovered.catalog.hasMore, true);
  assert.equal(discovered.document.source, 'knowledge/guide/routing.md');
  assert.equal(discovered.document.totalBytes, body.length);
  assert.equal(discovered.document.sha256, hash);
  assert.equal(discovered.document.contentId, `k:${hash.slice(0, 16)}`);
  assert.equal(discovered.document.fullyRead, true);
  assert.equal(discovered.document.firstPageHasMore, body.length > 4096);
  console.log(JSON.stringify({ publicPage: 'examples/vextjs-integration', installedCore: true, exported, discovered,
    proof: 'Unmodified public page scripts, actual installed Core tarball and byte-exact fixed upstream routing guide' }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
