import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';
import { normalizeCapacityOptions, parseCapacityOptions, runCapacity } from '../../scripts/validation/capacity.mjs';

test('capacity options reject invalid inputs before creating any sources', () => {
  for (const input of [{ nodes: 0 }, { concurrency: 1.5 }, { nodes: 2, providers: 2 }, { operations: 6 },
    { durationMs: -1 }, { unexpected: 1 }]) assert.throws(() => normalizeCapacityOptions(input));
  for (const args of [['--unknown', '1'], ['--nodes'], ['--nodes', '4', '--nodes', '6'], ['--nodes', '1e5']]) {
    assert.throws(() => parseCapacityOptions(args));
  }
  assert.equal(parseCapacityOptions(['--nodes', '40', '--concurrency', '4']).nodes, 40);
});

test('a failed reload validation drains other workers and removes its own temporary source', async () => {
  const expected = new Error('Intentional validation failure');
  let directory;
  await assert.rejects(runCapacity({ nodes: 40, providers: 2, concurrency: 4, operations: 100, reloadEvery: 14 }, (event) => {
    if (event.phase === 'sources') directory = event.directory;
    if (event.phase === 'reload') throw expected;
  }), (error) => error === expected);
  assert(directory);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
});

test('small real file run exercises mixed queries, changed reload, pins at close and source cleanup', async () => {
  const phases = [];
  const result = await runCapacity({ nodes: 40, providers: 2, concurrency: 4, operations: 100, reloadEvery: 14 },
    (event) => phases.push(event.phase));
  assert.equal(result.operationsCompleted, 100);
  assert.equal(result.peakInFlight, 4);
  assert.equal(result.pinnedReadsCompleted, 4);
  assert(result.reloads.length > 0 && result.reloads.every((reload) => reload.revisionChanged && reload.previousReadable && reload.inFlightAtStart > 0));
  assert(Object.values(result.queries).every((query) => query.count > 0));
  assert(result.closedQueriesRejected && result.temporarySourcesRemoved);
  assert(phases.includes('open') && phases.includes('reload'));
});
