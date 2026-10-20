import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import assert from 'node:assert/strict';

const a = { providerId: 'a', name: 'Application', version: '1', capabilities: [
  { id: 'route', name: 'Validated route', description: 'Declare an application route.', relations: { parents: ['group'], specializes: ['base'], related: ['peer'], requires: ['shared', 'b::schema'] } },
  { id: 'group', name: 'Group', description: 'Route category.', relations: { requires: ['group-dependency'] } },
  { id: 'base', name: 'Base', description: 'Base behavior.' },
  { id: 'peer', name: 'Peer', description: 'A related capability.', relations: { related: ['route'] } },
  { id: 'shared', name: 'Shared', description: 'Shared dependency.', relations: { requires: ['leaf'] } },
  { id: 'leaf', name: 'Leaf', description: 'A transitive dependency.' },
  { id: 'group-dependency', name: 'Group dependency', description: 'Not expanded by a parents query.' }
] };
const b = { providerId: 'b', name: 'Validation', version: '1', capabilities: [
  { id: 'schema', name: 'Schema', description: 'Declare a schema.', relations: { requires: ['a::shared'] } }
] };
const output = {};
const graph = await CapabilityGraph.open({ providers: [{ definition: a }, { definition: b }], allowedProviders: ['a', 'b'], model: {
  id: 'fixed-candidate-scope-demo', async select(request) {
    assert(request.catalog.every(item => item.providerId === 'a'));
    return { decision: 'selected', ids: ['a::route'] };
  }
} });
try {
  output.closure = await graph.resolve({ ids: ['a::route', 'a::shared', 'a::route'] });
  assert.deepEqual(output.closure.selected, ['a::route', 'a::shared']);
  assert.equal(output.closure.nodes.find(node => node.capability.id === 'a::shared').origin, 'selected');
  assert.equal(output.closure.nodes.filter(node => node.capability.id === 'a::leaf').length, 1);
  output.rootOnly = await graph.resolve({ ids: ['a::route'], relations: [] });assert.equal(output.rootOnly.nodes.length, 1);
  for (const [forward, reverse, target] of [['parents','children','a::group'],['specializes','specializedBy','a::base'],['related','relatedBy','a::peer'],['requires','requiredBy','a::shared']]) {
    output[forward] = await graph.resolve({ ids: ['a::route'], relations: [forward] });
    output[reverse] = await graph.resolve({ ids: [target], relations: [reverse] });
    assert(output[reverse].edges.some(edge => edge.from === 'a::route' && edge.type === forward && edge.to === target));
  }
  assert(!output.parents.nodes.some(node => node.capability.id === 'a::group-dependency'));
  output.candidateScope = await graph.match({ input: 'Scope demonstration only', providers: ['a'] });
  assert(output.candidateScope.graph.nodes.some(node => node.capability.id === 'b::schema'));
} finally { await graph.close(); }
for (const [name, providers] of [['unloaded', [{ definition: a }]], ['unauthorized', [{ definition: a }, { definition: b }]]]) {
  const limited = await CapabilityGraph.open({ providers, allowedProviders: ['a'] });
  try {
    output[name] = await limited.resolve({ ids: ['a::route'] });assert.equal(output[name].meta.completeness, 'partial');
    if(name === 'unauthorized') await assert.rejects(limited.resolve({ ids: ['b::schema'] }), error => error instanceof GraphError && error.code === 'CG_ACCESS_DENIED');
  } finally { await limited.close(); }
}
output.invalidCycles = {};
for (const type of ['parents', 'specializes', 'requires']) {
  const definition = { providerId: 'cycle', name: 'Invalid cycle', version: '1', capabilities: [
    { id: 'x', name: 'X', description: 'X', relations: { [type]: ['y'] } },
    { id: 'y', name: 'Y', description: 'Y', relations: { [type]: ['x'] } }
  ] };
  await assert.rejects(CapabilityGraph.open({ providers: [{ definition }] }), error => {
    assert(error instanceof GraphError);output.invalidCycles[type] = {code:error.code,phase:error.phase};return error.code === 'CG_RELATION_CYCLE';
  });
}
const publicDefinition = { providerId:'public', name:'Public', version:'1', capabilities:[{id:'route',name:'Route',description:'Visible route.'}] };
let publicRevision;
for (const version of ['1','2']) {
  const hidden = {providerId:'hidden',name:'Hidden',version,capabilities:[{id:'secret',name:'Secret',description:'Hidden source.',relations:{requires:['public::route']}}]};
  const view = await CapabilityGraph.open({providers:[{definition:publicDefinition},{definition:hidden}],allowedProviders:['public']});
  try {
    const result = await view.resolve({ids:['public::route'],relations:['requiredBy']});
    assert.equal(result.nodes.length,1);assert.equal(result.meta.completeness,'complete');assert.deepEqual(result.unresolved,[]);
    if(publicRevision) assert.equal(result.meta.revision,publicRevision);publicRevision=result.meta.revision;
    output[`hidden-${version}`]=result;
  } finally {await view.close();}
}
const badTarget = structuredClone(b);badTarget.capabilities[0].id='different';
await assert.rejects(CapabilityGraph.open({providers:[{definition:a},{definition:badTarget}]}),error=>{
  assert(error instanceof GraphError);output.badLoadedTarget={code:error.code,phase:error.phase};return error.code==='CG_RELATION_INVALID';
});
const mixed=await CapabilityGraph.open({providers:[{definition:{providerId:'mixed',name:'Mixed relations',version:'1',capabilities:[
  {id:'x',name:'X',description:'X',relations:{parents:['y']}},
  {id:'y',name:'Y',description:'Y',relations:{requires:['x']}}
]}}]});
try{output.mixedTypes=await mixed.resolve({ids:['mixed::x'],relations:['parents','requires']});}
finally{await mixed.close();}
console.log(JSON.stringify(output, null, 2));
