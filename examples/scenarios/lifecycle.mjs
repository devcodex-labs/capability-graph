import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

// This example creates only its own temporary directory and removes it in finally.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capability-graph-lifecycle-'));
const a = {providerId:'a',name:'Application',version:'1',capabilities:[{id:'route',name:'Route',description:'Original route.',relations:{requires:['b::schema']}}]};
const b = {providerId:'b',name:'Validation',version:'1',capabilities:[{id:'schema',name:'Schema',description:'Request schema.'}]};
let graph, releaseSelection, markStarted;
const started = new Promise(resolve => { markStarted = resolve; });
const output = {};
try {
  await fs.writeFile(path.join(root,'a.json'),JSON.stringify(a));
  await fs.writeFile(path.join(root,'b.json'),JSON.stringify(b));
  graph = await CapabilityGraph.open({providers:[{file:path.join(root,'a.json')},{file:path.join(root,'b.json')}],model:{
    id:'controlled-snapshot-demo',async select(request) {
      markStarted(request.revision);
      return new Promise(resolve => { releaseSelection = () => resolve({decision:'selected',ids:['a::route']}); });
    }
  }});
  const before = await graph.listCatalog();
  const matching = graph.match({input:'Demonstrate a fixed snapshot'});
  assert.equal(await started,before.meta.revision);
  a.version='2';a.capabilities[0].description='Updated route.';
  await fs.writeFile(path.join(root,'a.json'),JSON.stringify(a));
  output.updated = await graph.reload();
  assert.deepEqual(output.updated.providers.map(item=>item.status),['updated','unchanged']);
  releaseSelection();output.match = await matching;
  assert.equal(output.match.graph.meta.revision,before.meta.revision);
  assert.equal(output.match.graph.nodes.find(node=>node.capability.id==='a::route').capability.description,'Original route.');
  output.current = await graph.listCatalog();assert.notEqual(output.current.meta.revision,before.meta.revision);
  a.version='3';await fs.writeFile(path.join(root,'a.json'),JSON.stringify(a));
  await fs.writeFile(path.join(root,'b.json'),'not JSON');
  output.failed = await graph.reload();
  assert.equal(output.failed.ok,false);assert.deepEqual(output.failed.providers.map(item=>item.status),['not_applied','failed']);
  assert.equal((await graph.listCatalog()).meta.revision,output.current.meta.revision);
  await fs.writeFile(path.join(root,'b.json'),JSON.stringify(b));
  output.repaired = await graph.reload();assert.equal(output.repaired.ok,true);
  // Each source is valid alone, but their newly combined requires edges form a cycle.
  b.capabilities[0].relations={requires:['a::route']};
  await fs.writeFile(path.join(root,'b.json'),JSON.stringify(b));
  output.combinedCycle = await graph.reload();assert.equal(output.combinedCycle.ok,false);
  assert.equal(output.combinedCycle.error.code,'CG_RELATION_CYCLE');
  assert(output.combinedCycle.providers.every(item=>item.status!=='updated'));
} finally {
  releaseSelection?.();await graph?.close();await fs.rm(root,{recursive:true,force:true});
}
const inlineDefinition={providerId:'inline',name:'Inline',version:'1',capabilities:[{id:'route',name:'Route',description:'Inline route.'}]};
const inline=await CapabilityGraph.open({providers:[{definition:inlineDefinition}]});
try {
  inlineDefinition.version='2';output.inlineReload=await inline.reload();
  assert.equal(output.inlineReload.providers[0].status,'unchanged');
} finally {await inline.close();}
for(const mode of ['close','abort','timeout']) {
  let begin,signal;const entered=new Promise(resolve=>{begin=resolve;});
  const pending=await CapabilityGraph.open({providers:[{definition:inlineDefinition}],model:{id:'termination-demo',async select(request){signal=request.signal;begin();return new Promise(()=>{});}}});
  const controller=new AbortController();
  const operation=pending.match({input:'Demonstrate termination'},{signal:controller.signal,timeoutMs:mode==='timeout'?50:60000});
  const observed=operation.catch(error=>error);
  try {
    await entered;
    if(mode==='close')await pending.close();
    if(mode==='abort')controller.abort();
    const error=await observed;assert(error instanceof GraphError);
    assert.equal(error.code,{close:'CG_GRAPH_CLOSED',abort:'CG_MODEL_CANCELLED',timeout:'CG_MODEL_TIMEOUT'}[mode]);
    assert.equal(error.phase,mode==='close'?'lifecycle':'match');assert.equal(signal.aborted,true);
    output[mode]={code:error.code,phase:error.phase,executorSignalAborted:signal.aborted};
  } finally {await pending.close();await pending.close();}
}
console.log(JSON.stringify(output,null,2));
