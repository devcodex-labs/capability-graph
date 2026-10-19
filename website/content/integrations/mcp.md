# Tool、MCP、CLI 与 Plugin

通用 Agent Tool Adapter 借用 Graph，返回 definitions 和 call，不关闭 Graph：

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

把 CG_HTTP_TOKEN 配到部署环境。不要把明文 token 放 JSON、manifest 或命令行。对外 HTTPS/TLS 由部署代理提供；如宿主要求用户级 OAuth，使用其支持的网关，v1 不提供 OAuth/RBAC 服务。公共匿名配置 access:'public-readonly' 时 Graph 必须显式 allowedProviders，仅包含已批准公开的声明；默认禁止文档正文，enableMatch 必须 false。可信部署可以显式 publicDocuments:true 批准所有已声明文档正文，公开前审核文件根。

代码片段中的 graph 来自[快速开始](/getting-started/quick-start)，由应用创建并最终关闭。

主动模型路径需在 CLI 顶层设置 model 和 enableMatch:true，YOUR_MODEL_ID 替换为你有权限且支持结构化输出的模型。model 为 `{type:'openai',apiKeyEnv:'CG_MODEL_API_KEY',model:'YOUR_MODEL_ID'}` 或 `{type:'codex',command,authHome,scratchRoot,runtimeRoot,model?}`，字段含义见[模型配置](/models/match)。HTTP 开启 match 还必须显式配置 requestTimeoutMs 至少 65000（推荐 75000），涵盖 60 秒 Graph deadline 和协议收尾。匿名公开模式始终拒绝开启它。

CLI 配置 schemaVersion 为 1（可省），providers 必填；可选 allowedProviders、limits、model、transport、enableMatch、http。Provider 来源、所有 documentRoot/模型路径以配置文件目录解析。Codex command 若配置，使用明确的原生可执行路径；不配置则查 PATH。密钥字段只接受环境变量名。validate 验证单 Provider 文件和自身关系；多 Provider 整体一致性用 doctor。doctor 不进行模型付费调用，modelVerification 为 not_run，不能当模型登录测试。SIGINT/SIGTERM 和 stdio EOF 关闭服务。



## 客户端手工配置

本地 stdio 客户端填写已安装 capability-graph 可执行文件绝对路径，参数为 serve、--config、绝对 JSON 路径、--transport、stdio。客户端负责进程生命周期。HTTP 则由部署方先启动服务，客户端填写实际 URL；默认本地 URL 为 http://127.0.0.1:3333/mcp。

从项目内启动可使用 npx --no-install capability-graph serve --config graph.config.json --transport http，或把 http 换为 stdio。不要把人工终端日志输出到 stdio stdout。

宿主从 Catalog 选择真实 ID，再 Resolve；刷新后若 Revision 不同应重新选择。安装 Skill/Plugin 的流程见对应页面，远程 HTTPS 见[远程部署](/integrations/remote)。
