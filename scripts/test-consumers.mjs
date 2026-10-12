import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, cp, rm, realpath } from 'node:fs/promises';
import { createTemporaryDirectory, artifactsRoot } from './lib/artifact-paths.mjs';
const npm = process.env.npm_execpath; assert(npm, 'Run with npm run test:consumers');
const repository = process.cwd(), temporary = await createTemporaryDirectory('capability-graph-consumers-');
const run = (args, cwd = temporary) => execFileSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
try {
  const [packed] = JSON.parse(run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', temporary], repository));
  await writeFile(path.join(temporary, 'package.json'), '{"name":"cold-json-sdk-consumers","private":true,"type":"module"}');
  run([npm, 'install', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', path.join(temporary, packed.filename), '@modelcontextprotocol/sdk@1.30.0', '@types/node@22.18.6']);
  await cp(path.join(repository, 'examples/seed-provider'), path.join(temporary, 'provider'), { recursive: true });
  const script = `import assert from 'node:assert/strict';
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createCapabilityGraphToolkit } from '@devcodex/capability-graph/mcp';
import { createCapabilityGraphServer } from '@devcodex/capability-graph/mcp/server';
import { HttpKnowledgeReader } from '@devcodex/capability-graph/readers/http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client as V1Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport as V1Memory } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer, fromJsonSchema, InMemoryTransport as V2Memory } from '@modelcontextprotocol/server';
import { Client as V2Client } from '@modelcontextprotocol/client';
const graph = await CapabilityGraph.open({ hostAllowedProviders:['seed.http'], integrationEnabledProviders:['seed.http'],
  providers:[{providerId:'seed.http',authority:{kind:'file',rootDir:path.resolve('provider'),definitionLayout:'directory'}}] });
const toolkit=createCapabilityGraphToolkit(graph);
try {
  assert.equal(toolkit.listTools().length,12);
  const plain=await toolkit.callTool('capability_graph_list_catalog',{}); assert.equal(plain.isError,false);
  assert.deepEqual(JSON.parse(plain.content[0].text),plain.structuredContent);
  const server1=new Server({name:'consumer-v1',version:'1'},{capabilities:{tools:{}}});
  server1.setRequestHandler(ListToolsRequestSchema,async()=>({tools:toolkit.listTools()}));
  server1.setRequestHandler(CallToolRequestSchema,async(request,ctx)=>toolkit.callTool(request.params.name,request.params.arguments??{},{signal:ctx.signal}));
  const [a1,b1]=V1Memory.createLinkedPair(),client1=new V1Client({name:'v1',version:'1'});
  try { await server1.connect(a1);await client1.connect(b1);assert.equal((await client1.listTools()).tools.length,12);
    assert.deepEqual((await client1.callTool({name:'capability_graph_list_catalog',arguments:{}})).structuredContent,plain.structuredContent);
  } finally {await client1.close();await server1.close();}
  const server2=new McpServer({name:'consumer-v2',version:'1'});
  for(const definition of toolkit.listTools())server2.registerTool(definition.name,{description:definition.description,inputSchema:fromJsonSchema(definition.inputSchema),annotations:definition.annotations},
    (args,ctx)=>toolkit.callTool(definition.name,args,{signal:ctx.mcpReq.signal}));
  const [a2,b2]=V2Memory.createLinkedPair(),client2=new V2Client({name:'v2',version:'1'});
  try {await server2.connect(a2);await client2.connect(b2);assert.equal((await client2.listTools()).tools.length,12);
    assert.deepEqual((await client2.callTool({name:'capability_graph_list_catalog',arguments:{}})).structuredContent,plain.structuredContent);
  }finally{await client2.close();await server2.close();}
  const handle=createCapabilityGraphServer({graph,transport:'http',http:{port:0}});await handle.close();
  const reader=new HttpKnowledgeReader({allowedOrigins:['https://example.test']});await reader.close();
  assert.equal((await graph.listCatalog()).items.length,5);
  console.log(JSON.stringify({state:'pass',consumers:['plain-JSON','SDK-v1','SDK-v2','server-handle','HTTP-Reader']}));
}finally{await graph.close();}
`;
  await writeFile(path.join(temporary, 'consumer.mjs'), script);
  console.log(run(['consumer.mjs']).trim());
  await writeFile(path.join(temporary, 'consumer.ts'), `import { CapabilityGraph } from '@devcodex/capability-graph';
import { createCapabilityGraphToolkit, type ToolDefinition, type ToolCallResult } from '@devcodex/capability-graph/mcp';
import { createCapabilityGraphServer } from '@devcodex/capability-graph/mcp/server';
import { HttpKnowledgeReader } from '@devcodex/capability-graph/readers/http';
import { McpServer, fromJsonSchema, type JsonSchemaType } from '@modelcontextprotocol/server';
declare const graph: CapabilityGraph; const toolkit=createCapabilityGraphToolkit(graph);
const definitions: readonly ToolDefinition[]=toolkit.listTools();const result:Promise<ToolCallResult>=toolkit.callTool(definitions[0]!.name,{});
const server=new McpServer({name:'typed-host',version:'1'});
for(const tool of definitions)server.registerTool(tool.name,{inputSchema:fromJsonSchema(tool.inputSchema as JsonSchemaType)},async(args,ctx)=>{
 const value=await toolkit.callTool(tool.name,args,{signal:ctx.mcpReq.signal});return {...value,content:[...value.content]};});
const handle=createCapabilityGraphServer({graph,transport:'http',http:{port:0}});
const reader=new HttpKnowledgeReader({allowedOrigins:['https://example.test']});void [result,handle,reader];
`);
  await writeFile(path.join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', lib: ['ES2022','DOM'], module: 'Node16', moduleResolution: 'Node16', strict: true, noUncheckedIndexedAccess: true, noEmit: true, types: ['node'],
  }, include: ['consumer.ts'] }));
  run([path.join(repository, 'node_modules/typescript/bin/tsc'), '-p', path.join(temporary, 'tsconfig.json')]);
  console.log('Cold SDK/public subpath declarations passed');
} finally {
  assert.equal(path.dirname(temporary), artifactsRoot); assert.equal(await realpath(temporary), temporary);
  await rm(temporary, { recursive: true, force: true });
}
