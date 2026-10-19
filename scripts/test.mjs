import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.CG_BUILD_DIR ?? path.join(root, '../capability-graph-builds/tests'));
const env = { ...process.env, CG_BUILD_DIR: output, CG_TEST_DIR: process.env.CG_TEST_DIR ?? path.join(output, '../fixtures') };
const compiled = spawnSync(process.execPath, ['scripts/build.mjs', '--tests'], { cwd: root, env, stdio: 'inherit' });
if (compiled.error) throw compiled.error;
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
async function files(dir) {
  const names = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) names.push(...await files(target));
    else if (entry.name.endsWith('.test.js')) names.push(target);
  }
  return names.sort();
}
const selected = await files(path.join(output, 'test'));
if (!selected.length) throw new Error('No actual tests discovered');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...selected], { cwd: root, env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
