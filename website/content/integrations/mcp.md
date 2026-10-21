# MCP stdio 与 HTTP

让已有 MCP 宿主查询能力时，先选择传输，再准备 Provider 和启动配置。宿主模型负责从目录选择 ID，本服务负责确定性查询；默认不会再调用服务端模型。

| 你的场景 | 推荐路线 | 谁启动和关闭 |
| --- | --- | --- |
| 本地 Codex CLI、桌面或 IDE | [完整 Codex 教程](/integrations/codex)，stdio | 宿主启动子进程；会话/连接结束时关闭 |
| 其他支持 stdio 的本地 MCP 客户端 | 下文 stdio 配置，使用 Node/CLI/配置绝对路径 | 客户端管理子进程，stdout 仅传协议 |
| 本机多个客户端共享服务 | 下文 HTTP 完整脚本 | 你显式启动服务，结束后停止该进程 |
| 远程客户端或 ChatGPT Work | [远程 HTTPS](/integrations/remote) | 部署方管理进程、TLS 与认证 |
| 已经有 MCP Server | [合入现有服务](/integrations/existing-server) | 保留原服务所有权，不再新开端口 |

首次使用先按[第一个图谱](/getting-started/quick-start)准备声明，或复用 Codex 教程的 `examples/codex-host` 全套材料。不要只安装 Skill 后等待工具自动出现。

## 理解工具与调用结果

下面是已创建 `graph` 后的嵌入片段；要写完整 Agent 工具循环，见[Tool Adapter](/integrations/tools)。Adapter 借用 Graph，返回 `definitions` 和 `call`，不关闭 Graph：

```js
import { createGraphTools } from '@devcodex/capability-graph/tools';
const tools = createGraphTools(graph);
// 把 definitions 的 inputSchema/outputSchema 转为宿主要求的工具格式
const result = await tools.call('capability_graph_resolve', { ids: ['acme::route'] });
if (result.ok) console.log(result.data);
else console.error(result.error.code, result.error.phase);
```

默认工具：capability_graph_list_providers、capability_graph_list_catalog、capability_graph_get_capabilities、capability_graph_resolve、capability_graph_read_document。参数对应 SDK。成功使用 JSON Schema Draft2020 outputSchema；错误不冒充成功结构。`createGraphTools(graph,{enableMatch:true})` 另加 capability_graph_match，必须已有 executor。传入 call 第三个参数 `{signal,timeoutMs}` 可控制 match。

MCP 使用官方 TypeScript SDK v2，stdio 支持 **2026-07-28 / 2025-06-18**；HTTP 保持 **2026-07-28**。两类握手分别验证，不承诺其他版本。现代模式需客户端显式支持，不能把“连上 HTTP”算兼容。

```js
import { createMcpServer } from '@devcodex/capability-graph/mcp';
const server = createMcpServer({ graph, transport: 'http', http: { port: 3333 } });
try {
  const address = await server.start(); // 已监听，可以连接
  console.error(address);
  await server.waitUntilClosed();
} finally { await server.close(); await graph.close(); }
```

服务借用 Graph，close 只关闭自身传输，不关闭 Graph。stdio 每连接一个协议实例；HTTP 每请求按官方 handler 管理。服务 start/close 幂等，close 后不能重启同一对象；可创建新对象。HTTP 默认地址 127.0.0.1:3333/mcp，local，只读五工具；stdio stdout 只能是协议。

默认 HTTP 限制：maxBodyBytes 1MiB、maxResponseBytes 20MiB、maxInFlight 32、requestTimeoutMs 30000、shutdownTimeoutMs 5000。路由/方法/Host/Origin/认证/请求体检查在工具调用前执行。allowedHostnames 为部署允许的主机名集合，allowedOrigins 为精确 HTTP(S) origin；缺省拒绝所有带 Origin 的跨来源请求。SDK 默认上游 HTTP handler 不代替这些边界。设置更小的响应预算可能返回 CG_RESULT_TOO_LARGE；流式传输预算失败会中止连接，不能当完整结果。

远程 private 示例 CLI JSON：

```json
{
  "schemaVersion": 1,
  "providers": [{ "file": "./provider.json" }],
  "allowedProviders": ["acme"],
  "transport": "http",
  "http": {
    "host": "0.0.0.0", "port": 3333, "path": "/mcp", "access": "private",
    "auth": { "type": "bearer", "tokenEnv": "CG_HTTP_TOKEN" },
    "allowedHostnames": ["graph.example.com"]
  }
}
```

把CG_HTTP_TOKEN配到部署环境。CLI配置接受环境变量名，SDK接受token本身。对外HTTPS/TLS由部署代理提供；宿主要求用户级OAuth时使用其支持的网关，本服务不实现OAuth/RBAC。公共匿名配置access:'public-readonly'时Graph必须显式allowedProviders，仅包含已批准声明；默认禁止正文且enableMatch必须false。publicDocuments:true会批准全部已声明正文，公开前核对根与材料。

代码片段中的 graph 来自[快速开始](/getting-started/quick-start)，由应用创建并最终关闭。

主动模型路径需在 CLI 顶层设置 model 和 enableMatch:true，YOUR_MODEL_ID 替换为你有权限且支持结构化输出的模型。model 为 `{type:'openai',apiKeyEnv:'CG_MODEL_API_KEY',model:'YOUR_MODEL_ID'}` 或 `{type:'codex',command,authHome,scratchRoot,runtimeRoot,model?}`，字段含义见[模型配置](/models/match)。HTTP 开启 match 还必须显式配置 requestTimeoutMs 至少 65000（推荐 75000），涵盖 60 秒 Graph deadline 和协议收尾。匿名公开模式始终拒绝开启它。

CLI 配置 schemaVersion 为 1（可省），providers 必填；可选 allowedProviders、limits、model、transport、enableMatch、http。Provider 来源、所有 documentRoot/模型路径以配置文件目录解析。Codex command 若配置，使用明确的原生可执行路径；不配置则查 PATH。密钥字段只接受环境变量名。validate 验证单 Provider 文件和自身关系；多 Provider 整体一致性用 doctor。doctor 不进行模型付费调用，modelVerification 为 not_run，不能当模型登录测试。SIGINT/SIGTERM 和 stdio EOF 关闭服务。



## 客户端手工配置

本地 stdio 客户端填写已安装 capability-graph 可执行文件绝对路径，参数为 serve、--config、绝对 JSON 路径、--transport、stdio。客户端负责进程生命周期。HTTP 则由部署方先启动服务，客户端填写实际 URL；默认本地 URL 为 http://127.0.0.1:3333/mcp。

从项目内启动可使用 npx --no-install capability-graph serve --config graph.config.json --transport http，或把 http 换为 stdio。不要把人工终端日志输出到 stdio stdout。

宿主从 Catalog 选择真实 ID，再 Resolve；刷新后若 Revision 不同应重新选择。安装 Skill/Plugin 的流程见对应页面，远程 HTTPS 见[远程部署](/integrations/remote)。

## stdio：让客户端托管进程

在你的ESM项目安装本库和客户端SDK：

```sh
npm install @devcodex/capability-graph @modelcontextprotocol/client@2.3.1
```

按[快速开始](/getting-started/quick-start)在项目根保存provider.json与graph.config.json。把下列代码保存为mcp-stdio.mjs，在该目录执行 `node mcp-stdio.mjs`。示例使用Node启动本地安装包的bin脚本，不依赖源码仓库；GUI宿主也须填实际已安装Node/CLI/配置的绝对路径。

```js title="mcp-stdio.mjs"
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'graph-reader', version: '1' }, {
  versionNegotiation: { mode: { pin: '2026-07-28' } }
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./cli/main.js', import.meta.resolve('@devcodex/capability-graph'))),
    'serve', '--config', path.resolve('graph.config.json'), '--transport', 'stdio'],
  stderr: 'pipe'
});
transport.stderr?.on('data', bytes => process.stderr.write(bytes));
try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.error('工具：', tools.tools.map(tool => tool.name));
  const catalog = await client.callTool({ name: 'capability_graph_list_catalog', arguments: {} });
  if (catalog.isError) throw new Error(JSON.stringify(catalog));
  const entry = catalog.structuredContent?.items?.find(item => item.id === 'acme::route');
  if (!entry) throw new Error('Catalog中没有acme::route，请检查声明与授权');
  const result = await client.callTool({ name: 'capability_graph_resolve', arguments: { ids: [entry.id] } });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close();
}
```

客户端启动服务→发现五工具→读Catalog→从真实目录确认acme::route→Resolve→打印完整MCP结果→关闭连接和子进程。工具名及服务就绪诊断写stderr，客户端stdout只输出结果JSON；服务进程stdout专用于MCP，不能混入日志。这里选择已知案例ID，不调用第二个模型。

## HTTP：先启动服务，再连接

在终端A的项目根执行，保持进程运行：

```sh
npx --no-install capability-graph serve --config graph.config.json --transport http
```

默认stderr报告ready及 `http://127.0.0.1:3333/mcp`。这是MCP Streamable HTTP端点，不存在REST `/resolve`。在终端B同一项目保存mcp-http.mjs并执行 `node mcp-http.mjs`：

```js title="mcp-http.mjs"
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = process.env.CG_MCP_URL ?? 'http://127.0.0.1:3333/mcp';
const client = new Client({ name: 'graph-http-reader', version: '1' }, {
  versionNegotiation: { mode: { pin: '2026-07-28' } }
});
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const tools = await client.listTools();
  console.error('工具：', tools.tools.map(tool => tool.name));
  const catalog = await client.callTool({ name: 'capability_graph_list_catalog', arguments: {} });
  if (catalog.isError) throw new Error(JSON.stringify(catalog));
  const entry = catalog.structuredContent?.items?.find(item => item.id === 'acme::route');
  if (!entry) throw new Error('Catalog中没有acme::route，请检查声明与授权');
  const result = await client.callTool({ name: 'capability_graph_resolve', arguments: { ids: [entry.id] } });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close();
}
```

CG_MCP_URL由此示例读取以选择已有服务，Graph不自动采用该变量。本例连接默认本地无认证服务；私有服务请使用[带 Bearer 的完整客户端](/integrations/remote#用-bearer-客户端验证私有服务)。HTTP客户端close仅关闭自己的连接；验证结束后回终端A按Ctrl+C，由服务依次关闭传输和Graph。共享服务由其部署方管理，不因某个客户端退出就停止。

## 工具参数与结果

| 工具 | 参数 | 成功structuredContent |
| --- | --- | --- |
| capability_graph_list_providers | 可选providers数组 | ProviderListResult |
| capability_graph_list_catalog | 可选providers数组 | CatalogResult，精简目录 |
| capability_graph_get_capabilities | ids、可选context | CapabilityDetailResult |
| capability_graph_resolve | ids、可选context/relations | 完整ResolveResult |
| capability_graph_read_document | capabilityId、documentId | DocumentReadResult |
| capability_graph_match（显式启用） | input、可选context/providers | MatchResult |

默认是五个静态查询工具，不是一项能力一个Tool。第六个工具只有服务端显式配置executor和enableMatch:true才出现；它会使用服务端模型，不是自动复用客户端模型。HTTP还需显式requestTimeoutMs>=65000，公开匿名模式禁止开启。

## 读取协议封套

现代2026-07-28成功结果包含isError:false、content及structuredContent，后者与SDK返回相同，完整字段见[结果指南](/guide/results)。执行失败是isError:true，content中的text为GraphError JSON，通常没有成功structuredContent；协议本身的坏请求由SDK返回协议错误，客户端调用可reject。

stdio协商2025-06-18时，当前官方SDK2.3.1实测仍返回content:[]、structuredContent和isError，不能写成“只有text”。现代2026-07-28线路另外带外层_meta（含io.modelcontextprotocol/serverInfo）与resultType，SDK客户端可能规范化外层字段。外层MCP元信息不是Graph结果内的meta.revision。

本页脚本固定现代协议。SDK2.3.1需要旧协议时使用 `versionNegotiation:{mode:'legacy'}`，不要用pin:'2025-06-18'（pin只接受现代协议）；实际版本用client.getNegotiatedProtocolVersion()核对。HTTP只支持当前实现的2026-07-28，不从stdio兼容性推断HTTP支持。

<details>
<summary>现代协议一次成功调用的完整线路封包</summary>

```json
{
  "_meta": {
    "io.modelcontextprotocol/serverInfo": {
      "name": "capability-graph",
      "version": "2.1.0"
    }
  },
  "content": [],
  "structuredContent": {
    "selected": [
      "acme::route"
    ],
    "nodes": [
      {
        "capability": {
          "id": "acme::route",
          "providerId": "acme",
          "name": "Validated HTTP endpoint",
          "description": "Create an HTTP endpoint with request validation.",
          "whenToUse": "The application needs an HTTP endpoint with validated input.",
          "usage": {
            "instructions": "Declare the request schema, then register the endpoint."
          },
          "relations": {
            "parents": [],
            "specializes": [],
            "related": [],
            "requires": [
              "acme::schema"
            ]
          },
          "documents": []
        },
        "origin": "selected",
        "applicability": {
          "status": "applicable",
          "missingFacts": [],
          "invalidFacts": [],
          "failedConditions": []
        }
      },
      {
        "capability": {
          "id": "acme::schema",
          "providerId": "acme",
          "name": "Request schema",
          "description": "Declare a schema to validate request input.",
          "relations": {
            "parents": [],
            "specializes": [],
            "related": [],
            "requires": []
          },
          "documents": []
        },
        "origin": "dependency",
        "applicability": {
          "status": "applicable",
          "missingFacts": [],
          "invalidFacts": [],
          "failedConditions": []
        }
      }
    ],
    "edges": [
      {
        "from": "acme::route",
        "type": "requires",
        "to": "acme::schema"
      }
    ],
    "unresolved": [],
    "meta": {
      "revision": "sha256:be714d7dc37a706d72862ee2d485c7c127a9f684d8124796f4fc65e786a5285a",
      "completeness": "complete",
      "warnings": []
    }
  },
  "isError": false,
  "resultType": "complete"
}
```

</details>

同一SDK对不存在ID的执行失败如下；text需JSON.parse后读取code/phase，不能访问成功structuredContent：

```json
{
  "_meta": {
    "io.modelcontextprotocol/serverInfo": {
      "name": "capability-graph",
      "version": "2.1.0"
    }
  },
  "content": [
    {
      "type": "text",
      "text": "{\"code\":\"CG_CAPABILITY_NOT_FOUND\",\"phase\":\"query\",\"message\":\"Requested capability does not exist\",\"nextAction\":\"refresh\"}"
    }
  ],
  "isError": true
}
```

下一步：普通[Codex登记](/integrations/codex)、[已有Server](/integrations/existing-server)、[Agent工具](/integrations/tools)或[远程HTTPS](/integrations/remote)。
