import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryGraphStore } from '../src/store/memory-graph-store.js';
import { validateSnapshot } from '../src/validate/index.js';

test('reverse indexes retain every sorted high-fanout edge without mutating source arrays', async () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `c${String(i).padStart(4, '0')}`).reverse();
  const snapshot = await validateSnapshot({ source: { kind: 'file', rootDir: '/unused' },
    provider: { providerId: 'fanout', name: 'Fanout', version: '1' }, capabilities: [
      { capabilityId: 'root', name: 'Root', description: 'Root', whenToUse: 'Root' },
      ...ids.map((capabilityId) => ({ capabilityId, name: capabilityId, description: 'Child', whenToUse: 'Child',
        parents: ['root'], specializes: ['root'], related: ['root'], requires: ['root'] })),
    ] });
  for (const node of snapshot.capabilities.values()) {
    Object.freeze(node.parents); Object.freeze(node.specializes); Object.freeze(node.related); Object.freeze(node.requires);
  }
  const store = memoryGraphStore({ ...snapshot, capabilities: new Map([...snapshot.capabilities].reverse()) });
  try {
    for (const kind of ['children', 'specializedBy', 'relatedBy', 'requiredBy'] as const) {
      const actual: string[] = []; let cursor: string | undefined;
      do {
        const page = await store.neighbors('root', kind, { limit: 100, maxBytes: 16384, ...(cursor ? { cursor } : {}) });
        actual.push(...page.items.map((id) => id.capabilityId)); cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(actual, [...ids].sort());
    }
    assert.equal(snapshot.capabilities.get('c0000')!.parents.length, 1);
  } finally { await store.close(); }
});
