import {Server,ProtocolError} from '@modelcontextprotocol/server';
import {serveStdio,StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {CapabilityGraph} from '@devcodex/capability-graph';
import {createGraphTools} from '@devcodex/capability-graph/tools';
import {fileURLToPath} from 'node:url';

const graph=await CapabilityGraph.open({providers:[{file:fileURLToPath(new URL('../minimal/provider.json',import.meta.url))}]});
const adapter=createGraphTools(graph),names=new Set(adapter.definitions.map(t=>t.name));
const original=[{name:'ping',description:'Return pong.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
if(original.some(t=>names.has(t.name)))throw new Error('Graph tool names conflict with existing tools.');
const transport=new StdioServerTransport();
const handle=serveStdio(()=>{
  const server=new Server({name:'existing-server-with-graph',version:'1'},{capabilities:{tools:{},resources:{},prompts:{}},supportedProtocolVersions:['2026-07-28','2025-06-18']});
  server.setRequestHandler('tools/list',async()=>({tools:[...original,...adapter.definitions]}));
  server.setRequestHandler('tools/call',async(request,ctx)=>{
    if(names.has(request.params.name)){
      const result=await adapter.call(request.params.name,request.params.arguments??{},{signal:ctx.mcpReq.signal});
      return result.ok?server.projectCallToolResult({isError:false,content:[],structuredContent:result.data},adapter.definitions.find(t=>t.name===request.params.name).outputSchema):{isError:true,content:[{type:'text',text:JSON.stringify(result.error)}]};
    }
    if(request.params.name!=='ping')throw new ProtocolError(-32602,'Unknown tool');
    return server.projectCallToolResult({isError:false,content:[{type:'text',text:'pong'}]});
  });
  server.setRequestHandler('resources/list',async()=>({resources:[{uri:'note://welcome',name:'welcome',mimeType:'text/plain'}]}));
  server.setRequestHandler('resources/read',async request=>{
    if(request.params.uri!=='note://welcome')throw new ProtocolError(-32602,'Unknown resource');
    return {contents:[{uri:'note://welcome',mimeType:'text/plain',text:'Existing resource remains available.'}]};
  });
  server.setRequestHandler('prompts/list',async()=>({prompts:[{name:'welcome',description:'Existing prompt'}]}));
  server.setRequestHandler('prompts/get',async request=>{
    if(request.params.name!=='welcome')throw new ProtocolError(-32602,'Unknown prompt');
    return {messages:[{role:'user',content:{type:'text',text:'Welcome'}}]};
  });
  return server;
},{transport,onerror:()=>process.stderr.write('MCP transport failed.\n')});
let stopping;
function close(){return stopping??=(async()=>{try{await handle.close();}finally{await graph.close();}})();}
const onclose=transport.onclose;transport.onclose=()=>{onclose?.();void close();};
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
