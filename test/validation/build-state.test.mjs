import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createTemporaryDirectory } from '../../scripts/lib/website-paths.mjs';
import { writeBuildState, assertCurrentBuild } from '../../scripts/lib/build-state.mjs';
test('explicit built consumers reject missing, edited and deleted source/output rather than reuse stale dist', async () => {
  const root = await createTemporaryDirectory('capability-graph-build-proof-');
  try {
    for (const dir of ['src', 'dist', 'scripts/lib']) await mkdir(path.join(root, dir), { recursive: true });
    for (const file of ['src/index.ts', 'dist/index.js', 'tsconfig.json', 'package.json', 'package-lock.json', 'scripts/build.mjs', 'scripts/lib/build-state.mjs']) await writeFile(path.join(root, file), 'original');
    await assert.rejects(assertCurrentBuild(root), /Missing build state/);
    await writeBuildState(root); await assertCurrentBuild(root);
    for (const file of ['src/index.ts', 'dist/index.js']) {
      await writeFile(path.join(root, file), 'changed'); await assert.rejects(assertCurrentBuild(root), /differs/);
      await writeFile(path.join(root, file), 'original'); await assertCurrentBuild(root);
    }
    await writeFile(path.join(root, 'dist/deleted-source.js'), 'old'); await assert.rejects(assertCurrentBuild(root), /differs/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
