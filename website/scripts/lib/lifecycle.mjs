import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { websiteRoot } from './paths.mjs';

/** The same complete page program runs against repository and registry installations. */
export async function verifyLifecycleExample(consumer) {
  const source = await readFile(path.join(websiteRoot, 'docs/guides/lifecycle-and-reload.mdx'), 'utf8');
  const code = source.match(/```js title="lifecycle-demo\.mjs"\r?\n([\s\S]*?)\r?\n```/)?.[1];
  assert(code, 'lifecycle must have a complete executable page example');
  const scratch = await mkdtemp(path.join(consumer, 'lifecycle-check-'));
  try {
    const file = path.join(scratch, 'lifecycle-demo.mjs');
    await writeFile(file, code, 'utf8');
    const outcome = JSON.parse(execFileSync(process.execPath, [file], { cwd: scratch, encoding: 'utf8', timeout: 30_000 }));
    assert.deepEqual(outcome, { changed: true, current: 'Routing v2', previous: 'Routing v1',
      previousSource: 'previous', failedCode: 'CG_VALIDATION_FAILED', retained: 'Routing v2', refreshFailed: true });
  } finally {
    assert.equal(path.dirname(scratch), consumer);
    assert(path.basename(scratch).startsWith('lifecycle-check-'));
    await rm(scratch, { recursive: true, force: true });
  }
}
