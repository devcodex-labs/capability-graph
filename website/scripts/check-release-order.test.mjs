import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const script = path.join(import.meta.dirname, 'check-release-order.mjs');

function run(target, latest) {
  return spawnSync(process.execPath, [script, target, latest], {
    encoding: 'utf8',
    windowsHide: true
  });
}

for (const [target, latest] of [
  ['1.0.0', ''],
  ['1.0.0', '0.9.0'],
  ['1.0.0', '1.0.0-rc.0'],
  ['1.0.0', '1.0.0-beta.2'],
  ['1.0.0', '0.9.9-rc.9']
]) {
  const result = run(target, latest);
  assert.equal(result.status, 0, `${latest || '<first>'} -> ${target} should pass:\n${result.stderr}`);
}

for (const [target, latest] of [
  ['1.0.0', '1.0.0'],
  ['1.0.0', '1.0.1-rc.0'],
  ['1.0.0', '2.0.0'],
  ['1.0.0-rc.1', '1.0.0-rc.0'],
  ['1.0.0', 'not-semver']
]) {
  const result = run(target, latest);
  assert.notEqual(result.status, 0, `${latest || '<first>'} -> ${target} should fail`);
}

console.log('release order contract passed: 5 positive and 5 negative cases');
