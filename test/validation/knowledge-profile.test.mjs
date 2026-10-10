import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryRoot, createTemporaryDirectory } from '../../scripts/lib/artifact-paths.mjs';

test('HTTP knowledge profile distinguishes observed index hits, capacity misses and zero-hit I/O', async () => {
  const root = await createTemporaryDirectory('knowledge-profile-test-');
  try {
    const result = JSON.parse(execFileSync(process.execPath, ['scripts/validation/knowledge-profile.mjs'], {
      cwd: repositoryRoot, env: { ...process.env, CG_ARTIFACTS_DIR: root }, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_097_152,
    }));
    assert.equal(result.modelCalls, 0);
    assert.equal(result.results.length, 12);
    const observed = new Set();
    for (const row of result.results) {
      assert.equal(row.samples.length, 8);
      assert(!('cachedP50Ms' in row) && !('cachedP95Ms' in row));
      let previous = { cachedSelections: 0, cachedEntries: 0, cachedBytes: 0 };
      const shouldRetain = row.workload === 'cacheable' || (row.workload === 'dense-default' && row.documents === 1);
      for (const [iteration, sample] of row.samples.entries()) {
        assert.deepEqual(sample.cacheBefore, previous, 'one unchanged selection in a fresh scenario');
        const access = sample.cacheBefore.cachedSelections ? 'hit' : 'miss';
        assert.equal(sample.indexCache, access);
        assert.equal(sample.phase, iteration === 0 ? 'cold' : iteration === 7 ? 'zero-hit' : `cache-${access}`);
        observed.add(sample.phase);
        assert.equal(sample.cacheAfter.cachedSelections, shouldRetain ? 1 : 0);
        assert(sample.cacheAfter.cachedEntries <= row.cacheBudgets.maxCachedEntries);
        assert(sample.cacheAfter.cachedBytes <= row.cacheBudgets.maxCachedBytes);
        const requests = row.documents + (iteration < 7 && row.documentBytes > 32768 ? 1 : 0);
        assert.equal(sample.httpRequests, requests, 'index reuse still verifies every selected source');
        assert.equal(sample.receivedBytes, requests * row.documentBytes);
        assert.equal(sample.servedBytes, sample.receivedBytes);
        assert.equal(sample.readCalls, row.mode === 'read-only' ? requests : 0);
        assert.equal(sample.streamCalls, row.mode === 'streaming' ? requests : 0);
        previous = sample.cacheAfter;
      }
      for (const [phase, summary] of Object.entries(row.phases)) {
        const values = row.samples.filter((sample) => sample.phase === phase).map((sample) => sample.elapsedMs).sort((a, b) => a - b);
        assert.equal(summary.samples, values.length);
        if (!values.length) assert.deepEqual(summary, { samples: 0, p50Ms: null, p95Ms: null });
        else assert(values[0] <= summary.p50Ms && summary.p50Ms <= summary.p95Ms && summary.p95Ms <= values.at(-1));
      }
    }
    assert.deepEqual([...observed].sort(), ['cache-hit', 'cache-miss', 'cold', 'zero-hit']);
    assert.equal(result.pagination.length, 2);
    for (const row of result.pagination) {
      assert.equal(row.pages, 32);
      assert.equal(row.streamCalls, row.stableProof ? 1 : 32);
      assert.equal(row.streamedBytes, row.sourceBytes * row.streamCalls);
      assert.equal(row.servedBytes, row.sourceBytes);
    }
    assert.deepEqual(await readdir(root), [], 'profile removes its temporary sources and snapshots');
  } finally { await rm(root, { recursive: true, force: true }); }
});
