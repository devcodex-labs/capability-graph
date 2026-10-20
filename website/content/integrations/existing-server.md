# 给已有 MCP Server 添加 Graph 工具

沿用现有连接、tools、resources、prompts；不为增加 Graph 重建一个独立端口。使用 @devcodex/capability-graph/tools 的 createGraphTools，默认五工具。

1. 创建或借用 Graph，取得 definitions/call。
2. tools/list 合并定义，名称冲突明确失败。
3. tools/call 只将命中名称交给 Adapter，其余走原处理器；成功映射为 structuredContent，失败为 isError 文本 JSON。按协商版本投影 MCP 信封。
4. 沿用原传输与关闭逻辑。创建 Graph 的一方负责 close，Adapter 不关闭借用 Graph。

## 完整可运行案例

本例是一个保留 `ping`、资源和 Prompt 的完整服务，不是向任何现有 SDK 自动注入工具的补丁。先在独立目录验证，再把定义合并和调用分发移入你的服务。

在你的项目安装依赖并复制示例：

```sh
npm install @devcodex/capability-graph @modelcontextprotocol/server@2.3.1
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

## 验证原功能与 Graph 同时可用

在你的 MCP 客户端将启动命令设为 `node` 的绝对路径，参数设为 `examples/mcp/server.mjs` 的绝对路径。Windows 复制示例可用 `Copy-Item -LiteralPath node_modules/@devcodex/capability-graph/examples -Destination examples -Recurse`；Bash 使用上面的 `cp`。脚本用 `import.meta.url` 定位 Provider，不依赖客户端 cwd。

按顺序检查：`tools/list` 应有 `ping` 和五个 Graph 工具；调用 `ping` 得 `pong`；`resources/read` 读取 `note://welcome`；`prompts/get` 取得 `welcome`；最后读 Catalog 并用真实 `acme::route` 调用 Resolve。Graph 的业务结果字段见[结果指南](/guide/results)。

若原工具消失，检查合并时是否覆盖原列表；若有名称冲突，先解决冲突再启动；若列表有工具但调用失败，检查分发条件和协议投影。不要把 Graph 的错误 JSON 当 MCP 成功结果回送。

客户端断开会关闭示例传输并释放 Graph；手动运行时用 Ctrl+C 退出。移入已有服务后，借用的 Graph 由创建方关闭；原服务的资源、Prompt、认证和关闭流程继续由原应用管理。
