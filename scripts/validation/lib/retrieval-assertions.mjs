import assert from 'node:assert/strict';
/** Independent task expectations are gates, not merely reported metrics. */
export function assertTaskRecall(task, coreIds, nativeIds) {
  if (!task.expected.length) {
    assert.equal(coreIds.length, 0, `${task.id}: unsupported request received Core recommendations`);
    assert.equal(nativeIds.length, 0, `${task.id}: unsupported request received native recommendations`);
    return;
  }
  assert(task.expected.every((id) => coreIds.includes(`native.${id.toLowerCase()}`)), `${task.id}: Core omitted an expected capability`);
  const nativeRecall = task.expected.filter((id) => nativeIds.includes(id)).length / task.expected.length;
  assert(nativeRecall >= (task.minimumNativeRecall ?? 1), `${task.id}: native recall regressed below its recorded baseline`);
}
export function assertKnowledgeEvidence(page, label) {
  assert.equal(page.meta.completeness, 'complete', `${label}: incomplete knowledge evidence`);
  assert(page.items.length > 0, `${label}: required source evidence had zero hits`);
}
