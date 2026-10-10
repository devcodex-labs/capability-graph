import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createTestDirectory, removeTestDirectory } from '../../dist-test/test/contract/temporary-directory.js';
import { artifactsRoot, repositoryRoot } from '../../scripts/lib/artifact-paths.mjs';

test('Core fixtures honor the external artifact root override and clean only their own directory', async () => {
  const parent = await createTestDirectory('fixture-policy-');
  const helper = pathToFileURL(path.join(repositoryRoot, 'dist-test/test/contract/temporary-directory.js')).href;
  const custom = path.join(parent, 'custom');
  const run = (root) => execFileSync(process.execPath, ['--input-type=module', '--eval',
    `const api = await import(${JSON.stringify(helper)}); const directory = await api.createTestDirectory('fixture-child-');
     await api.removeTestDirectory(directory); console.log(JSON.stringify({directory}));`],
    { env: { ...process.env, CG_ARTIFACTS_DIR: root }, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  try {
    assert.equal(path.dirname(parent), await realpath(artifactsRoot));
    const { directory } = JSON.parse(run(custom));
    assert.equal(path.dirname(directory), await realpath(custom));
    await assert.rejects(realpath(directory), { code: 'ENOENT' });
    assert.throws(() => run(path.join(repositoryRoot, 'test')), /outside the repository/);
    const unowned = path.join(parent, 'unowned');
    await mkdir(unowned);
    await assert.rejects(removeTestDirectory(unowned), /unowned test directory/);
    assert.equal(await realpath(unowned), unowned);
  } finally { await removeTestDirectory(parent); }
});

test('Core fixture cleanup refuses a replacement junction and preserves its target', async () => {
  const parent = await createTestDirectory('fixture-link-policy-');
  const directory = await createTestDirectory('fixture-owned-');
  const saved = path.join(parent, 'saved');
  const target = path.join(parent, 'target');
  try {
    await mkdir(target);
    await writeFile(path.join(target, 'preserve.txt'), 'preserve');
    await rename(directory, saved);
    await symlink(target, directory, 'junction');
    await assert.rejects(removeTestDirectory(directory), /real directory/);
    assert.equal(await readFile(path.join(target, 'preserve.txt'), 'utf8'), 'preserve');
    await rm(directory, { recursive: true, force: true });
    await rename(saved, directory);
  } finally {
    await removeTestDirectory(directory);
    await removeTestDirectory(parent);
  }
});
