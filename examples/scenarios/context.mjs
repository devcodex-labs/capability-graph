import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import assert from 'node:assert/strict';

const definition = {
  providerId: 'conditions', name: 'Condition examples', version: '1',
  capabilities: [
    { id: 'route', name: 'Route', description: 'An Acme route on Node or Bun, version 2.', appliesTo: { all: [
      { field: 'framework', op: 'eq', value: 'acme' },
      { field: 'framework', op: 'eq', value: 'acme' },
      { field: 'runtime', op: 'in', values: ['node', 'bun'] },
      { field: 'framework.version', op: 'semverRange', range: '>=2.0.0 <3.0.0' }
    ] } },
    { id: 'empty', name: 'Empty set', description: 'No supplied environment belongs to this empty set.', appliesTo: { all: [
      { field: 'environment', op: 'in', values: [] }
    ] } }
  ]
};
const cases = [
  { name: 'applicable', facts: { framework: 'acme', runtime: 'node', 'framework.version': '2.1.0' }, status: 'applicable' },
  { name: 'missing', facts: { framework: 'acme' }, status: 'unknown' },
  { name: 'invalid-version', facts: { framework: 'acme', runtime: 'node', 'framework.version': 2 }, status: 'unknown' },
  { name: 'wrong-type-and-missing', facts: { framework: 1 }, status: 'inapplicable' },
  { name: 'known-failure-first', facts: { framework: 'other' }, status: 'inapplicable' }
];
let graph;
try {
  graph = await CapabilityGraph.open({ providers: [{ definition }] });
  const results = {};
  for (const item of cases) {
    const result = await graph.getCapabilities({ ids: ['conditions::route'], context: { facts: item.facts } });
    assert.equal(result.items[0].applicability.status, item.status);
    results[item.name] = { input: { facts: item.facts }, result };
  }
  assert.deepEqual(results.missing.result.items[0].applicability.missingFacts, ['framework.version', 'runtime']);
  assert.deepEqual(results['invalid-version'].result.items[0].applicability.invalidFacts, ['framework.version']);
  assert.deepEqual(results['known-failure-first'].result.items[0].applicability.failedConditions, ['framework']);
  results['empty-in'] = await graph.getCapabilities({ ids: ['conditions::empty'], context: { facts: { environment: 'production' } } });
  assert.equal(results['empty-in'].items[0].applicability.status, 'inapplicable');
  try {
    await graph.resolve({ ids: ['conditions::route'], context: { facts: { framework: { name: 'acme' } } } });
    assert.fail('Nested facts must reject');
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    assert.equal(error.code, 'CG_CONTEXT_INVALID');
    results['illegal-structure'] = { code: error.code, phase: error.phase };
  }
  const invalidDefinition=structuredClone(definition);
  invalidDefinition.capabilities[0].appliesTo.all=[{field:'framework.version',op:'semverRange',range:'^2.0.0'}];
  await assert.rejects(CapabilityGraph.open({providers:[{definition:invalidDefinition}]}),error=>{
    assert(error instanceof GraphError);results['illegal-range']={code:error.code,phase:error.phase};return error.code==='CG_DEFINITION_INVALID';
  });
  console.log(JSON.stringify(results, null, 2));
} finally {
  await graph?.close();
}
