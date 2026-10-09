import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const expectedVersion = process.argv[2];
assert(/^\d+\.\d+\.\d+$/.test(expectedVersion), 'freeze the expected package version before installation');
const parent = await realpath(os.tmpdir());
const consumer = await mkdtemp(path.join(parent, 'cg-registry-docs-'));
try {
  execFileSync('npm', ['init', '-y'], { cwd: consumer, stdio: 'pipe' });
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '@devcodex/capability-graph'], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(import.meta.dirname, 'check-installed-tutorial.mjs'), consumer, expectedVersion], { cwd: consumer, stdio: 'inherit' });
} finally {
  assert.equal(path.dirname(consumer), parent);
  assert(path.basename(consumer).startsWith('cg-registry-docs-'));
  await rm(consumer, { recursive: true, force: true });
}
