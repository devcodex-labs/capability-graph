import {CapabilityGraph} from '@devcodex/capability-graph';
const graph=await CapabilityGraph.open({providers:[
  {definition:{providerId:'acme',name:'Acme endpoints',version:'1',capabilities:[{id:'route',name:'Validated endpoint',description:'Create a validated endpoint.',relations:{requires:['shared::schema']}}]}},
  {definition:{providerId:'shared',name:'Shared validation',version:'1',capabilities:[{id:'schema',name:'Schema',description:'Declare request validation.'}]}}
],allowedProviders:['acme','shared']});
try {
  const result=await graph.resolve({ids:['acme::route']});
  console.log(JSON.stringify({selected:result.selected,nodes:result.nodes.map(n=>n.capability.id),edges:result.edges,completeness:result.meta.completeness},null,2));
} finally {await graph.close();}
