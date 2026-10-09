import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { normalizeCapacityOptions, parseCapacityOptions, runCapacity } from '../../scripts/validation/capacity.mjs';

test('capacity options reject invalid inputs before creating any sources', () => {
  for (const input of [{ nodes: 0 }, { concurrency: 1.5 }, { nodes: 2, providers: 2 }, { operations: 6 },
    { durationMs: -1 }, { reloadRounds: 1 }, { providers: 4, operations: 27 }, { unexpected: 1 }]) assert.throws(() => normalizeCapacityOptions(input));
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
    if (event.phase === 'reload' && event.reloadPhase === 'load') throw expected;
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
  assert(result.reloads.every((reload) => reload.revisionChanged && reload.previousReadable));
  assert(result.reloads.some((reload) => reload.phase === 'load' && reload.inFlightAtStart > 0));
  assert(result.retirementChecks.every((check) => check.rounds >= 2 && check.previousRetired && check.pinnedQueryCompleted));
  assert.equal(result.retirementChecks.length, 2);
  assert.equal(result.catalogCoverage.items, 40);
  assert(Object.values(result.queries).every((query) => query.count > 0));
  assert(result.closedQueriesRejected && result.temporarySourcesRemoved);
  assert(phases.includes('open') && phases.includes('reload'));
});

test('short high-concurrency loads still prove the full union and every Provider retirement', async () => {
  for (const providers of [4, 7]) {
    const result = await runCapacity({ nodes: providers * 100, providers, concurrency: 100,
      operations: providers * 7, reloadEvery: 0 });
    assert.equal(result.catalogCoverage.items, providers * 100);
    assert(Object.values(result.catalogCoverage.itemsByProvider).every((count) => count === 100));
    assert.equal(result.retirementChecks.length, providers);
    assert(result.retirementChecks.every((check) => check.rounds === 2 && check.pinnedQueryCompleted && check.previousRetired));
    assert(Object.values(result.providerQueries).every((counts) => Object.entries(counts)
      .filter(([kind]) => kind !== 'catalog').every(([, count]) => count > 0)));
    assert(result.temporarySourcesRemoved);
  }
});

test('Catalog omissions and duplicates cannot pass capacity validation', async () => {
  const original = CapabilityGraph.prototype.listCatalog;
  try {
    for (const corrupt of [(items) => items.slice(1), (items) => [...items.slice(0, -1), items[0]]]) {
      CapabilityGraph.prototype.listCatalog = async function (...args) {
        const page = await original.apply(this, args);
        return { ...page, items: corrupt(page.items) };
      };
      let directory;
      await assert.rejects(runCapacity({ nodes: 40, providers: 2, operations: 14, reloadEvery: 0 }, (event) => {
        if (event.phase === 'sources') directory = event.directory;
      }), { code: 'ERR_ASSERTION' });
      await assert.rejects(stat(directory), { code: 'ENOENT' });
    }
  } finally { CapabilityGraph.prototype.listCatalog = original; }
});

test('a retirement-phase failure releases its blocked public query before removing sources', async () => {
  const expected = new Error('Intentional retirement failure');
  let directory;
  await assert.rejects(runCapacity({ nodes: 40, providers: 2, operations: 14, reloadEvery: 0 }, (event) => {
    if (event.phase === 'sources') directory = event.directory;
    if (event.phase === 'reload' && event.reloadPhase === 'retirement') throw expected;
  }), (error) => error === expected);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
});
