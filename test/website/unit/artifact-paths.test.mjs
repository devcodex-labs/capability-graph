import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { artifactsRoot, createTemporaryDirectory, repositoryRoot } from '../../../scripts/lib/artifact-paths.mjs';

const helper = new URL('../../../scripts/lib/website-paths.mjs', import.meta.url).href;
const artifactHelper = new URL('../../../scripts/lib/artifact-paths.mjs', import.meta.url).href;
const run = (root, code = '') => execFileSync(process.execPath, ['--input-type=module', '--eval',
  `const artifacts = await import(${JSON.stringify(artifactHelper)}); const api = await import(${JSON.stringify(helper)}); ${code}`], {
  env: { ...process.env, CG_ARTIFACTS_DIR: root }, encoding: 'utf8', stdio: 'pipe'
});

test('artifact paths reject repository directories and parents', () => {
  for (const root of [repositoryRoot, path.join(repositoryRoot, '.artifacts'), path.dirname(repositoryRoot)]) {
    assert.throws(() => run(root), /CG_ARTIFACTS_DIR/);
  }
});

test('generated cleanup removes stale files and preserves evidence; links and unowned paths fail', async () => {
  const root = await createTemporaryDirectory('artifact-contract-');
  try {
    await mkdir(path.join(root, 'website/doc_build'), { recursive: true });
    await writeFile(path.join(root, 'website/doc_build/stale.html'), 'old');
    await writeFile(path.join(root, 'evidence.txt'), 'preserve');
    run(root, 'await api.resetGeneratedDirectory(api.siteOutputRoot);');
    await assert.rejects(readFile(path.join(root, 'website/doc_build/stale.html')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(root, 'evidence.txt'), 'utf8'), 'preserve');
    assert.throws(() => run(root, 'await api.resetGeneratedDirectory(artifacts.artifactsRoot);'), /unowned/);
    await rm(path.join(root, 'website/doc_build'), { recursive: true });
    await mkdir(path.join(root, 'target'));
    await writeFile(path.join(root, 'target/preserve.txt'), 'preserve');
    await symlink(path.join(root, 'target'), path.join(root, 'website/doc_build'), 'junction');
    assert.throws(() => run(root, 'await api.resetGeneratedDirectory(api.siteOutputRoot);'), /real directory/);
    assert.equal(await readFile(path.join(root, 'target/preserve.txt'), 'utf8'), 'preserve');
    await symlink(repositoryRoot, path.join(root, 'checkout-link'), 'junction');
    assert.throws(() => run(path.join(root, 'checkout-link/website'),
      'await api.resetGeneratedDirectory(api.siteOutputRoot);'), /resolves inside/);
  } finally {
    assert.equal(path.dirname(root), artifactsRoot);
    await rm(root, { recursive: true, force: true });
  }
});
