import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import assert from 'node:assert/strict';

// Fixed selections demonstrate result handling only; this is not an AI matcher.
const definition = {
  providerId: 'a', name: 'State demonstration', version: '1', capabilities: [
    { id: 'route', name: 'Route', description: 'An Acme route.', appliesTo: { all: [{ field: 'framework', op: 'eq', value: 'acme' }] } },
    { id: 'alternative', name: 'Alternative', description: 'A different implementation.' }
  ]
};
const selections = {
  matched: { decision: 'selected', ids: ['a::route'] },
  no_match: { decision: 'none', ids: [], reason: 'No declared capability fits.' },
  ambiguous: { decision: 'ambiguous', ids: ['a::route', 'a::alternative'], reason: 'Choose one implementation.' },
  needs_context: { decision: 'needs_context', ids: ['a::route'], reason: 'Confirm the framework.', missingInformation: ['framework'] }
};
const output = {};
for (const [status, selection] of Object.entries(selections)) {
  const model = { id: 'fixed-state-demo', async select() { return selection; } };
  const graph = await CapabilityGraph.open({ providers: [{ definition }], model });
  try {
    output[status] = await graph.match({ input: 'Demonstrate this state', context: { facts: { framework: 'acme' } } });
    assert.equal(output[status].status, status);
  } finally { await graph.close(); }
}
for (const [name, context] of [['unknown', {}], ['inapplicable', { facts: { framework: 'other' } }]]) {
  const graph = await CapabilityGraph.open({ providers: [{ definition }], model: { id: 'fixed-state-demo', async select() { return selections.matched; } } });
  try {
    const result = await graph.match({ input: 'Demonstrate independent dimensions', context });
    assert.equal(result.status, 'matched');assert.equal(result.graph.nodes[0].applicability.status, name);
    output[`matched-${name}`] = result;
  } finally { await graph.close(); }
}
const partialDefinition = structuredClone(definition);
partialDefinition.capabilities[0].relations = { requires: ['unloaded::schema'] };
const partial = await CapabilityGraph.open({ providers: [{ definition: partialDefinition }], model: { id: 'fixed-state-demo', async select() { return selections.matched; } } });
try {
  output['matched-partial'] = await partial.match({ input: 'Demonstrate an unavailable dependency' });
  assert.equal(output['matched-partial'].status, 'matched');assert.equal(output['matched-partial'].graph.meta.completeness, 'partial');
} finally { await partial.close(); }
let calls = 0;
const empty = await CapabilityGraph.open({ providers: [], model: { id: 'must-not-run', async select() { calls++;throw new Error('Empty catalog must skip selection'); } } });
try { output.empty = await empty.match({ input: 'No candidates' });assert.equal(output.empty.status, 'no_match');assert.equal(calls, 0); }
finally { await empty.close(); }
const unconfigured = await CapabilityGraph.open({ providers: [] });
try {
  await assert.rejects(unconfigured.match({ input: 'No executor configured' }), error => {
    assert(error instanceof GraphError);assert.equal(error.code, 'CG_MODEL_NOT_CONFIGURED');
    output.unconfigured = { code: error.code, phase: error.phase };return true;
  });
} finally { await unconfigured.close(); }
console.log(JSON.stringify(output, null, 2));
