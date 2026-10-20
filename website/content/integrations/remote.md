# 远程 HTTPS 与 ChatGPT Work

远程宿主不能访问开发机 localhost 或你的本地文件树。先在部署环境加载已批准 Provider 和文档，再提供宿主真正可访问的 HTTPS MCP。

## 先分清服务端与客户端

服务端需要 Node、批准的 Provider/知识文件、进程管理、TLS 与认证；客户端只需要可达的 HTTPS URL、兼容协议与相应凭据。下文先在 MCP 客户端脚本验证，再按宿主实际连接流程接入。默认不启用服务端模型。

| 阶段 | 成功证据 | 失败先看哪里 |
| --- | --- | --- |
| 服务启动 | 部署环境的 `/mcp` 实际监听 | 进程日志、配置路径、文件权限 |
| 网络与认证 | HTTPS 可达，正确凭据可连接，缺失/错误凭据被拒绝 | DNS/TLS/代理、Host、凭据与认证模式 |
| MCP | 协商 `2026-07-28`，发现五个查询工具 | 协议支持与客户端开关，不能只看 HTTP 200 |
| 业务任务 | Catalog 有真实 ID；Resolve/按需正文读取成功 | Provider 授权、ID 与文档声明 |
| 真实宿主 | 宿主聊天中有工具调用记录和正确结果 | 安装/连接状态、宿主认可的认证及任务指令 |

本地 Bearer 客户端验证不能替代真实 TLS、OAuth 或宿主账号验收。公网 URL 与客户端界面以实际部署为准，不将示意域名视为已部署服务。

## 私有服务

CLI JSON 的 http.access 为 private，非回环监听必须配置 bearer/tokenEnv；SDK 直接传可信 token。反向代理负责 TLS，保留正确 Host 并限制直达端口。宿主需要用户级 OAuth 时使用其支持的网关；本项目不新增 OAuth/RBAC 服务。

```json
{"providers":[{"file":"./provider.json"}],"allowedProviders":["acme"],"transport":"http","http":{"host":"0.0.0.0","port":3333,"path":"/mcp","access":"private","auth":{"type":"bearer","tokenEnv":"CG_HTTP_TOKEN"},"allowedHostnames":["graph.example.com"]}}
```

将 CG_HTTP_TOKEN 配到部署环境，启动 capability-graph serve --config 绝对路径 --transport http。域名为示意，实际部署替换；不将凭据写入 JSON、manifest 或命令行。

## 公开只读服务

access:public-readonly 必须显式 allowedProviders，仅批准公开内容。默认禁正文；publicDocuments:true 才明确批准所有已声明正文。公开匿名始终禁止 enableMatch。Host/Origin 检查与响应/并发/请求预算仍生效。

## 用 Bearer 客户端验证私有服务

先完成下方服务部署，或使用你已运行的私有 MCP 服务。本节使用官方客户端 2.3.1，支持服务要求的 2026-07-28 协议。在客户端项目安装：

```sh
npm install @modelcontextprotocol/client@2.3.1
```

将以下完整脚本保存为 `mcp-private.mjs`。它传入 Bearer 认证、发现工具、读取 Catalog，并从返回目录确认真实的 acme::route 后 Resolve；stdout 只输出完整 MCP 结果，工具名和错误写 stderr。示例使用已知案例 ID，换成你的声明时同步调整它。

```js title="mcp-private.mjs"
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client({ name: 'graph-private-reader', version: '1' }, {
  versionNegotiation: { mode: { pin: '2026-07-28' } }
});
try {
  const url = process.env.CG_MCP_URL;
  if (!url) throw new Error('请设置 CG_MCP_URL 为私有服务的完整 MCP URL');
  const token = process.env.CG_MCP_TOKEN;
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  }));
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

在客户端进程中设置以下变量。地址和凭据是待替换示意；凭据值必须与服务端配置相同。Bash：

```sh
export CG_MCP_URL='https://graph.example.com/mcp'
export CG_MCP_TOKEN='你的服务凭据'
node mcp-private.mjs
```

PowerShell：

```powershell
$env:CG_MCP_URL='https://graph.example.com/mcp'
$env:CG_MCP_TOKEN='你的服务凭据'
node mcp-private.mjs
```

| 变量 / 配置 | 谁读取 | 含义 |
| --- | --- | --- |
| 服务端 `http.auth.tokenEnv: "CG_HTTP_TOKEN"` | Graph CLI | 从服务进程环境读取期望的 token；JSON 中不存 token 值 |
| 客户端 `CG_MCP_URL` | 本页脚本 | 完整 HTTPS MCP 端点，Graph 不自动采用该变量 |
| 客户端 `CG_MCP_TOKEN` | 本页脚本 | 通过 requestInit.headers 发送为 Authorization: Bearer；Graph 不自动读取该变量 |

认证参数依据官方 [StreamableHTTPClientTransportOptions](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/streamableHttp.ts)，并按本项目安装的 2.3.1 类型与客户端执行验证。缺失或错误的 token 会被私有服务以 HTTP 401 拒绝，脚本以 1 退出；请核对客户端环境与代理是否转发 Authorization。固定 Bearer 不会自动完成 OAuth。

成功时五工具可发现，stdout 的 structuredContent 与[快速开始的完整结果](/getting-started/quick-start)相同（前提是使用同一 Provider 与授权）。client.close() 只关闭本客户端连接；私有服务仍由部署方管理。本地回环验证不等于公网 TLS 或真实宿主连接已验收。

## 添加宿主连接

在 ChatGPT Work 支持的连接设置中添加 HTTPS 地址和所需认证。宿主必须支持本服务 HTTP 的 2026-07-28 协议，并接受部署端的认证方式；协议或认证方式不兼容时，需要先调整宿主或网关配置。

在新会话请求宿主列出 Provider 和 Catalog，选择一个已声明的能力并调用 Resolve。结果应只包含批准的 Provider，Revision 应一致。若连接失败，依次检查 HTTPS 可达性、MCP 协议、Host/Origin、认证和反向代理路由，见[故障排查](/resources/troubleshooting)。

## 从工作目录到HTTPS的完整材料

准备一台受控服务机、已指向它的真实域名、有效TLS证书、宿主接受的认证方式及兼容MCP协议。以下graph.example.com和证书路径都是待替换示意，不会自动申请域名或创建证书。

部署目录示例：

```text
graph-service/
├── package.json
├── graph.config.json
└── providers/acme/provider.json
```

在该目录安装 `npm install @devcodex/capability-graph`，provider.json使用[最小声明](/getting-started/quick-start)或你批准的实际声明；有知识正文时一并放在对应Provider根下。保存完整graph.config.json：

```json title="graph.config.json"
{
  "schemaVersion": 1,
  "providers": [
    {
      "file": "./providers/acme/provider.json"
    }
  ],
  "allowedProviders": [
    "acme"
  ],
  "transport": "http",
  "enableMatch": false,
  "http": {
    "host": "127.0.0.1",
    "port": 3333,
    "path": "/mcp",
    "access": "private",
    "auth": {
      "type": "bearer",
      "tokenEnv": "CG_HTTP_TOKEN"
    },
    "allowedHostnames": [
      "graph.example.com"
    ],
    "allowedOrigins": [],
    "limits": {
      "maxBodyBytes": 1048576,
      "maxResponseBytes": 20971520,
      "maxInFlight": 32,
      "requestTimeoutMs": 30000,
      "shutdownTimeoutMs": 5000
    }
  }
}
```

此例只让代理访问回环3333，http.access:private仍显式设置bearer。allowedHostnames必须匹配代理转发的真实Host；allowedOrigins:[]拒绝带Origin的跨来源请求，如果合法客户端确实发送Origin，只加入它的精确HTTP(S) origin，不含路径。Host/Origin不是账号认证的替代品。

在服务环境配置CG_HTTP_TOKEN（Bash用 `export CG_HTTP_TOKEN='你的服务凭据'`，PowerShell用 `$env:CG_HTTP_TOKEN='你的服务凭据'`），再从部署目录运行：

```sh
npx --no-install capability-graph doctor --config graph.config.json
npx --no-install capability-graph serve --config graph.config.json --transport http
```

doctor检查配置，不做真实模型验证；serve的stderr报告ready及内部回环地址。内部地址是给代理的，不是远程宿主要填写的URL。

例如已有Nginx/TLS部署可按下面的server块转发，替换域名和已存在证书路径，并先执行部署方的 `nginx -t`：

```nginx
server {
    listen 443 ssl;
    server_name graph.example.com;
    ssl_certificate /etc/ssl/graph/fullchain.pem;
    ssl_certificate_key /etc/ssl/graph/privkey.pem;

    location = /mcp {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_buffering off;
        proxy_read_timeout 80s;
    }
}
```

配置依据Nginx官方[代理模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)及[SSL模块](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)。保留Host、认证与MCP请求头，关闭响应缓冲以转发流式结果。请求预算、代理超时和上游关闭策略需一并配置；这里没有替你部署或完成证书验收。

## 验证远程连接的顺序

1. 从宿主实际可达网络确认 `https://你的域名/mcp` 的证书、域名和路由；普通GET有响应不等于MCP握手成功。
2. 用支持2026-07-28的MCP客户端及同一认证发起工具发现，确认默认五工具。静态接入不需要模型Key。
3. 请求Catalog，确认只包含批准来源及真实ID；再Resolve并检查完整structuredContent、applicability、completeness和revision。
4. 在目标宿主的连接设置填写同一HTTPS URL及其支持的认证；开启新会话检查实际工具调用。宿主只支持OAuth时，需要你自己的合规OAuth网关；固定Bearer不会自动变成OAuth。
5. 缺域名、账号、认证适配或协议支持时，该条真实宿主连接保持未验证；本地JSON合法、代理启动或URL存在不能代替上述成功结果。

401检查凭据与代理Authorization；Host/Origin拒绝核对精确值；协议不兼容先核对双方版本；超时检查Graph/HTTP/代理三个层次。不要统一当网络故障重试。更多见[故障排查](/resources/troubleshooting)。部署服务由其拥有者按实际服务管理方式关闭，客户端close只关闭自己的连接。
