# 给已有 MCP Server 添加 Graph 工具

沿用现有连接、tools、resources、prompts；不为增加 Graph 重建一个独立端口。使用 @devcodex/capability-graph/tools 的 createGraphTools，默认五工具。

1. 创建或借用 Graph，取得 definitions/call。
2. tools/list 合并定义，名称冲突明确失败。
3. tools/call 只将命中名称交给 Adapter，其余走原处理器；成功映射为 structuredContent，失败为 isError 文本 JSON。按协商版本投影 MCP 信封。
4. 沿用原传输与关闭逻辑。创建 Graph 的一方负责 close，Adapter 不关闭借用 Graph。

## 完整可运行案例

在你的项目安装依赖并复制示例：

```sh
npm install @devcodex/capability-graph@2.0.0 @modelcontextprotocol/server@2.3.1
cp -R node_modules/@devcodex/capability-graph/examples ./examples
```

让 MCP 客户端使用 node 和 examples/mcp/server.mjs 的绝对路径启动。本例声明 ping 工具、note://welcome 资源和 welcome Prompt，并合入五个 Graph 工具。

<!-- example:examples/mcp/server.mjs -->
```js
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
```

stdout 只传协议。客户端应仍能调用 ping、读取 note://welcome、取得 welcome Prompt，并通过 capability_graph_resolve 解析 acme::route 的 schema 依赖。默认无服务端模型调用。不同 SDK 按同样的定义/调用映射，具体接入由应用维护，不增加专有 Agent 框架包。
