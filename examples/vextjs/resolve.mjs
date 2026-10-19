import { fileURLToPath } from 'node:url';
import { CapabilityGraph } from '@devcodex/capability-graph';

const graph = await CapabilityGraph.open({ providers: [{ file: fileURLToPath(new URL('./vextjs.capabilities.json', import.meta.url)) }] });
try {
  console.log(JSON.stringify(await graph.resolve({ ids: ['vextjs::greeting.create'], context: { facts: { framework: 'vextjs', 'framework.version': '2.0.0' } } }), null, 2));
} finally { await graph.close(); }
