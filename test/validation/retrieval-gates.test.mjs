import assert from 'node:assert/strict';
import test from 'node:test';
import { assertKnowledgeEvidence, assertTaskRecall } from '../../scripts/validation/lib/retrieval-assertions.mjs';
test('recall/evidence gates fail on omission, zero hits and unsupported recommendations', () => {
  const task = { id: 'independent', expected: ['C04'] };
  assert.throws(() => assertTaskRecall(task, [], ['C04']), /omitted/);
  assert.throws(() => assertTaskRecall(task, ['native.c04'], []), /regressed/);
  assert.throws(() => assertTaskRecall({ id: 'unknown', expected: [] }, ['native.c04'], []), /unsupported/);
  assert.throws(() => assertKnowledgeEvidence({ items: [], meta: { completeness: 'complete' } }, 'document'), /zero hits/);
  assertTaskRecall(task, ['native.c04'], ['C04']);
  assertKnowledgeEvidence({ items: [{}], meta: { completeness: 'complete' } }, 'document');
});
