import path from 'node:path';
import { CapabilityGraph } from '../../dist/index.js';
import { createCapabilityGraphServer } from '../../dist/mcp/server.js';
const graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed.http'], integrationEnabledProviders: ['seed.http'],
  providers: [{ providerId: 'seed.http', authority: { kind: 'file', rootDir: path.resolve('examples/seed-provider'), definitionLayout: 'directory' } }] });
const server = createCapabilityGraphServer({ graph, transport: 'stdio' });
let closing;
const close = () => closing ??= (async () => { await server.close(); await graph.close(); })().catch(error => { console.error(error); process.exitCode = 1; });
process.once('SIGTERM', close); process.once('SIGINT', close); process.stdin.once('end', close);
await server.start();
process.send?.({ ready: true }); // Raw protocol negative tests wait for actual startup, not a filesystem-speed guess.
