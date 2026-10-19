import {CapabilityGraph} from '@devcodex/capability-graph';
import {fileURLToPath} from 'node:url';
const graph=await CapabilityGraph.open({providers:[{file:fileURLToPath(new URL('./provider.json',import.meta.url))}]});
try {
  const catalog=await graph.listCatalog();
  const detail=await graph.getCapabilities({ids:['acme::route']});
  const resolved=await graph.resolve({ids:['acme::route']});
  const document=await graph.readDocument({capabilityId:'acme::route',documentId:'guide'});
  console.log(JSON.stringify({catalog:catalog.items.map(c=>c.id),usage:detail.items[0].capability.usage.instructions,selected:resolved.selected,nodes:resolved.nodes.map(n=>({id:n.capability.id,origin:n.origin,applicability:n.applicability.status})),completeness:resolved.meta.completeness,documentId:document.documentId},null,2));
} finally {await graph.close();}
