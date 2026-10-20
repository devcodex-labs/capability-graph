# Capability Graph

用静态 JSON 声明框架、SDK 和项目已有的能力，让应用与 AI 宿主发现能力、获取使用说明、检查适用条件并解析显式依赖。

**v2.0.0** · Node.js / TypeScript SDK · MCP stdio / Streamable HTTP · Codex Skill / Plugin

Provider 作者声明能力与关系；模型选择已有 ID；Graph 验证授权、结构化条件及依赖；调用方决定如何使用。Graph 不执行能力或依赖，不自动扫描项目推断事实，也不提供 RAG、Embedding、关键词 Matcher 或 Agent Runtime。

## 目录导航

[选择接入方式](#接入方式) · [安装](#安装到使用项目) · [第一个图谱](#声明与静态查询) · [配置](#配置与多个-provider) · [Codex](#codex-使用当前模型) · [主动匹配](#应用主动匹配) · [CLI](#cli-与维护) · [完整使用手册](website/content/getting-started/introduction.md)

## 接入方式

| 使用场景 | 接入入口 | 谁选择能力 |
| --- | --- | --- |
| 程序已知 ID，无模型查询 | Node.js / TypeScript SDK | 调用方 |
| 程序自然语言匹配，调用 OpenAI API | `createOpenAIExecutor` → `match()` | 显式 API 模型 |
| 程序自然语言匹配，独立调用 Codex CLI | `createCodexExecutor` → `match()` | 独立只读 CLI 任务 |
| 复用已有 SDK、私有模型或网关 | 自定义 `ModelExecutor.select` → `match()` | 调用方提供的模型 |
| 已有 Agent | `createGraphTools` 定义与调用封装 | 通常宿主当前模型 |
| 已有 MCP Server | 合并工具列表、转发 Graph 调用 | 通常客户端当前模型 |
| 本地 MCP 客户端 | stdio，客户端管理服务进程 | 客户端当前模型 |
| 本地或共享 MCP 服务 | Streamable HTTP，客户端连接 URL | 通常客户端当前模型 |
| ChatGPT Work | 真实 HTTPS MCP + 宿主连接配置 | 远程宿主当前模型 |
| 普通 Codex 用户 | 显式 `setup` → stdio MCP + 官方 Skill | Codex 当前模型 |
| 已有 MCP 连接，只安装使用指导 | 官方 `capability-discovery` Skill | 宿主当前模型 |
| 按 Plugin 机制整体分发 | MCP 清单 + Skill | 宿主当前模型 |

Skill 指导调用，Plugin 提供分发，setup 管理登记；它们可以组合使用，同一份 Graph 定义和授权语义贯穿全部入口。默认 MCP 不调用第二个模型。

## 安装到使用项目

使用 **Node.js >=22.12.0、ESM**，JavaScript 和 TypeScript API 相同。`.mjs` 可直接执行；`.js` 所在项目需设置 `"type":"module"`；TypeScript 编译到 ESM/NodeNext 后运行。

在你的应用项目中通过 npm 安装：

```sh
mkdir graph-demo
cd graph-demo
npm init -y
npm install @devcodex/capability-graph
```

静态 Graph 无需 OpenAI/Codex SDK 或模型凭据。安装不启动服务、不调用模型、不登记 MCP/Skill，也不修改宿主配置。本地命令可在使用项目中通过 `npx --no-install capability-graph` 调用。

需要在多个项目中使用 CLI 时，可以全局安装：

```sh
npm install --global @devcodex/capability-graph
```

## 声明与静态查询

首次运行只需两个文件，不需要模型、凭据或知识目录。在 `graph-demo/` 项目根目录创建 `provider.json`：

<!-- example:examples/minimal/provider.json -->
```json title="provider.json"
{
  "providerId": "acme",
  "name": "Acme HTTP",
  "version": "1.0.0",
  "capabilities": [
    {
      "id": "route",
      "name": "Validated HTTP endpoint",
      "description": "Create an HTTP endpoint with request validation.",
      "whenToUse": "The application needs an HTTP endpoint with validated input.",
      "usage": { "instructions": "Declare the request schema, then register the endpoint." },
      "relations": { "requires": ["schema"] }
    },
    { "id": "schema", "name": "Request schema", "description": "Declare a schema to validate request input." }
  ]
}
```

本例描述“带请求校验的 HTTP 接口”。`route` 通过作者显式声明的 `requires` 依赖 `schema`；Graph 解析声明，真正注册和执行仍由应用负责。`providerId/name/version/capabilities` 是来源必填字段，能力必填 `id/name/description`；`whenToUse`、`usage` 和关系按需填写。`schema` 没有使用说明也是合法的。

在同一目录创建 `static.mjs`。`import.meta.url` 定位脚本旁的声明；成功时只输出完整 JSON，失败时诊断写 stderr，最后关闭 Graph。

<!-- example:examples/minimal/static.mjs -->
```js title="static.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }]
  });
  const result = await graph.resolve({ ids: ['acme::route'] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

```sh
node static.mjs
```

| 配置/调用 | 含义与默认行为 |
| --- | --- |
| `providers:[{file:...}]` | 加载这个 JSON；同一来源的 file 与内联 definition 互斥 |
| `allowedProviders` 省略 | 授权全部已加载来源；空数组表示零授权 |
| `resolve.ids:['acme::route']` | 选中的根；必须使用完整 ID，数组非空 |
| `relations` 省略 | 默认展开 requires 依赖闭包；`[]` 仅保留根 |
| `context` 省略 | 不提供事实；本例无静态条件，因此 applicable |
| `model` 省略 | 静态方法不调用模型 |

以下是该稳定声明的真实完整 stdout，与 API 原结果一致。Revision 取决于声明和授权，修改输入后可能改变：

```json
{
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
}
```

`selected` 是请求的根；依赖也会进入 `nodes`，由 `origin` 区分。ID 在 `node.capability.id`；`edges` 保持原始正向，`unresolved:[]` 和 `meta.completeness:'complete'` 表示关系完整展开，不能据此宣称已执行成功。

在取得 `result` 后可用这段**消费片段**展示说明；它不是另一个独立脚本：

```js
for (const { capability, origin, applicability } of result.nodes) {
  console.log(`${capability.id} (${origin}, ${applicability.status})`);
  console.log(capability.usage?.instructions ?? '该能力没有提供使用说明');
}
```

已有内存对象时可传 `providers:[{definition}]`，完整无文件版本见 [inline.mjs](examples/minimal/inline.mjs)，复制到项目后执行 `node inline.mjs`。两种来源返回同一种完整结果。[快速开始](website/content/getting-started/quick-start.md)解释两种写法及参数，[结果指南](website/content/guide/results.md)说明每个字段和下一步判断。

目录、详情与知识读取独立放在 [details.mjs](examples/minimal/details.mjs)。按[运行示例](website/content/examples/index.md)复制完整 examples 后，运行 `node examples/minimal/details.mjs`；它使用 `details.provider.json` 和随附 `knowledge/guide.md`，输出完整 `{catalog,details,document}`，不增加最小示例前置条件。

## 配置与多个 Provider

SDK 在代码中使用 `CapabilityGraph.open(options)`；CLI 从纯 JSON 配置加载。先保存 `graph.config.json`：

```json
{
  "schemaVersion": 1,
  "providers": [{ "file": "./provider.json" }],
  "allowedProviders": ["acme"]
}
```

| 配置 | 使用规则 |
| --- | --- |
| `providers` | 必填数组，可为 []；多 Provider 配置多个来源，providerId 唯一 |
| `providers[].file` | JSON 路径，与 definition 互斥；文档根固定为该 JSON 所在目录 |
| `providers[].definition` | 内联纯 JSON 定义，按值加载 |
| `providers[].documentRoot` | 仅内联来源可用，存在本地文档时必需，为可信本地根 |
| `allowedProviders` | 省略为全部已加载；[] 为零授权。调用参数只能缩小范围 |
| `model` | SDK 为 ModelExecutor；CLI 为 openai/codex adapter 配置；静态查询可省略 |
| `limits` | 正安全整数的字节预算，默认见下文 |
| CLI `transport` | 缺省 stdio；serve 的显式 --transport 覆盖它 |
| CLI `enableMatch` | 缺省 false，true 要求已配置 executor |
| CLI `http` | HTTP 地址、认证、来源、预算；与 Provider 定义分开 |

SDK 相对路径以 open 当时 cwd 为基准；CLI 相对路径以配置文件目录为基准。上面的静态示例使用 import.meta.url 固定文件位置，避免启动目录差异。

可以按 Provider 放置文件：

```text
my-graph/
├── graph.config.json
└── providers/
    ├── acme/
    │   ├── provider.json
    │   └── knowledge/guide.md
    └── shared/
        ├── provider.json
        └── knowledge/schema.md
```

然后 providers 分别写 `./providers/acme/provider.json`、`./providers/shared/provider.json`。这是显式文件接入；当前不会自动扫描目录或合并 capabilities 分文件。

跨 Provider 关系写完整 ID，例如 `requires:["shared::schema"]`。目标已加载且授权时展开；未加载或无权读取时统一返回 `target_unavailable` 与 partial。显式查询越权根整次失败，不当空结果。完整可运行例子见 [multi-provider/main.mjs](examples/multi-provider/main.mjs)。

## 关系、Context 与知识文件

四类正向关系为 parents、specializes、related、requires；反向 children、specializedBy、relatedBy、requiredBy 由索引产生，不写入声明。parents/specializes/requires 各自禁止环，related 可以有环。

resolve 默认展开 requires 传递闭包；显式 `relations:[]` 只取根；其他正/反向关系从根一跳，不自动继续展开所到关联节点的依赖。边始终保留原始正向方向。

Context 示例：

```json
{
  "facts": { "framework": "acme", "framework.version": "1.0.0", "production": true },
  "notes": "Only the supplied facts are known."
}
```

facts 是平面 string/有限 number/boolean 映射，点号是字面键，不访问嵌套对象。`appliesTo.all` 支持严格同类型 eq、in、稳定 SemVer 的 AND 比较范围，例如 `>=1.0.0 <2.0.0`；不支持 ^/~/*/或、预发布与 build metadata。notes 仅供模型参考，不参与静态适用判断。Context 不授予权限，Graph 不自动补事实。

关联文档通过 `documents:[{id,source:{type:'file',path:'knowledge/guide.md'}}]` 声明，再按 capabilityId/documentId 读取；不能传任意路径。text 为 UTF-8，去首 BOM、保留 CRLF；byteLength/contentHash 来自同一次稳定读取的原始字节。URL 只作引用，readDocument 返回 `CG_DOCUMENT_REFERENCE_ONLY`，不自动抓取。完整路径安全前提见[安全说明](website/content/resources/security.md)。

## Codex 使用当前模型

这条路线使用当前 Codex 模型，通过 MCP 选择与解析能力；无需额外 API Key 或独立 Codex 匹配登录目录。

全局安装 CLI 后，将命令中的配置路径替换为你的真实绝对路径：

```sh
capability-graph setup --host codex --config /absolute/path/graph.config.json --dry-run
capability-graph setup --host codex --config /absolute/path/graph.config.json
capability-graph doctor --host codex
```

本地安装则使用该 bin 的绝对路径，或在使用项目执行 `npx --no-install capability-graph ...`。

setup 显式登记 `capability_graph` stdio MCP，安装 `capability-discovery` Skill，并记录 Node/CLI/配置的绝对路径。服务进程由宿主管理，无需手工常驻 HTTP 或 Plugin marketplace。

按客户端要求重载配置/开启新会话，然后明确请求：

```text
请使用 capability-discovery，为创建带请求校验的 Acme HTTP 接口发现能力，
展示依赖、适用条件和使用说明，不执行能力。
```

Skill 指导 Provider/Catalog → 当前模型选择真实 ID → Resolve → 必要时按 ID 读文档，不自动处理每条消息。匹配依据来自用户任务与可靠项目事实，不因只加载某个 Provider 就假设项目采用该框架。

stdio 支持 **2026-07-28 / 2025-06-18**。Codex CLI 0.163.0 的 stdio 使用后者；服务按协商版本输出结果信封。HTTP 使用 2026-07-28，接入条件见[兼容说明](website/content/resources/compatibility.md)。

## 应用主动匹配

需要由应用提交自然语言并一次得到选择和子图时，显式配置 ModelExecutor，调用 match。无需先手工 resolve。

### OpenAI API

另装可选 SDK：

```sh
npm install openai@7.39.0
```

在应用运行环境配置 `CG_MODEL_API_KEY`、`CG_MODEL_NAME`；这些名称由下例读取，库不自动采用它们。模型需支持 strict Structured Outputs，Codex 登录不提供 API 凭据。

```js
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { createOpenAIExecutor } from '@devcodex/capability-graph/adapters/openai';
import { fileURLToPath } from 'node:url';

const apiKey = process.env.CG_MODEL_API_KEY;
const model = process.env.CG_MODEL_NAME;
const baseURL = process.env.CG_MODEL_BASE_URL;
if (!apiKey || !model) throw new Error('Configure CG_MODEL_API_KEY and CG_MODEL_NAME');
let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }],
    model: createOpenAIExecutor({ apiKey, model, ...(baseURL ? { baseURL } : {}) })
  });
  const result = await graph.match({
    input: '创建带请求校验的 Acme HTTP 接口',
    context: { facts: { framework: 'acme' } }
  }, { timeoutMs: 60000 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

适配器使用 Responses、strict JSON Schema、store:false、无自动重试；只发送授权 Catalog、input、Context 和 Revision。可配置 HTTPS baseURL 对接兼容该协议的网关，或提供可信 fetch。确认所用模型与账号支持 strict Structured Outputs；Chat Completions 地址不能直接用作 Responses 地址。

### 独立 Codex CLI

普通 Node.js 应用需要独立匹配任务时使用此路径；不接管当前桌面会话、不依赖 Codex SDK。

```js
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { createCodexExecutor } from '@devcodex/capability-graph/adapters/codex';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }],
    model: createCodexExecutor({
      command: '/opt/pinned-codex/bin/codex',
      runtimeRoot: '/opt/pinned-codex',
      authHome: '/private/dedicated-codex-home',
      scratchRoot: '/var/tmp/capability-graph-matcher'
    })
  });
  console.log(JSON.stringify(await graph.match({ input: '创建带请求校验的 Acme HTTP 接口' }), null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

上述路径是需替换的本机配置。当前仅支持 **Linux + bubblewrap + 原生 CLI 0.163.0**。先在独立 CODEX_HOME 完成该 CLI 的 login --device-auth 与 login status，再配置 authHome。runtimeRoot 只含可信 CLI 安装资源；每轮独立只读最小挂载、禁用执行工具，取消/超时后回收子进程及 scratch。不满足隔离条件时明确拒绝。完整准备与默认值见[模型接入](website/content/models/codex.md)。

### 自定义已有模型调用

实现公开 `ModelExecutor.select(request)`，接收 input、context、授权 catalog、revision、signal，返回 ModelSelection，再传给 open.model。无需新建网关。Graph 校验候选 ID/授权/结构，再确定性解析。

完整自有 Chat Completions 示例见 [custom-executor.mjs](examples/custom-executor.mjs)。它是应用代码适配，不表示新增内置协议；配置其三个环境变量后才能对真实服务运行。CLI JSON 不接受函数或执行模块。

## 如何判断返回结果

| 维度 | 状态与含义 |
| --- | --- |
| `match.status` | matched/no_match/ambiguous/needs_context，模型选择的业务状态 |
| `node.applicability.status` | applicable/inapplicable/unknown，显式 Context 条件的确定性判断 |
| `graph.meta.completeness` | complete/partial，依赖与请求关系是否完整展开 |

多项共同需要可以 matched；互斥候选缺依据才 ambiguous。matched 仍可能 unknown 或 partial，不能直接等同可执行。模型语义可能误选，Graph 不保证语义正确率。

认证、取消、超时、拒绝、非法/越权 ID 是错误，不伪装 no_match。默认 match 总 deadline 60000ms，可设 1–600000ms；signal、deadline、close 首先观察到的终止生效，迟到结果丢弃。timeoutMs:null 与 relations:null 都不是省略。自定义 executor 负责自己的外部资源回收。

## MCP stdio 与 Streamable HTTP

已有 MCP 客户端可直接启动：

```sh
npx --no-install capability-graph serve --config graph.config.json --transport stdio
```

客户端 command 使用已安装可执行文件的绝对路径，args 填 serve、--config、绝对 JSON 路径、--transport、stdio。stdout 仅协议，诊断写 stderr，进程由客户端管理。

HTTP 由部署方显式启动：

```sh
npx --no-install capability-graph serve --config graph.config.json --transport http
```

默认 `http://127.0.0.1:3333/mcp`。支持现代协议的客户端连接此 URL。Codex CLI 0.163.0 的 HTTP 路线需显式启用其现代协议能力，例如已有配置中合并：

```toml
[features]
mcp_2026_07_28 = true

[mcp_servers.capability_graph]
url = "http://127.0.0.1:3333/mcp"
```

不要重复添加同名 TOML 节。setup 管理的 stdio 与手工 HTTP 是可选路线，不同时覆盖同名登记。stdio 支持 2026-07-28/2025-06-18；HTTP 仅 2026-07-28，不承诺其他版本兼容。

默认五工具与 SDK 对应：

| Tool | 方法 |
| --- | --- |
| capability_graph_list_providers | listProviders |
| capability_graph_list_catalog | listCatalog |
| capability_graph_get_capabilities | getCapabilities |
| capability_graph_resolve | resolve |
| capability_graph_read_document | readDocument |

成功 structuredContent 与 SDK 一致；执行失败 isError:true，文本为机器可读错误 JSON。服务端明确配置 executor 并 enableMatch:true 才增加 capability_graph_match。HTTP 开启它还需显式 requestTimeoutMs >=65000，推荐75000；公开匿名始终禁止开启。

默认 HTTP 预算：请求体1 MiB、响应20 MiB、并发32、请求30000ms、关闭5000ms。Host、Origin、认证、路由和预算在调用前检查。远程 private 需要认证；公开 anonymous 仅明确批准的 Provider，默认不提供文档正文。TLS/OAuth 网关由部署层提供。

ChatGPT Work 接入需要宿主可访问的 **HTTPS** 地址、兼容的 MCP HTTP 协议和宿主接受的认证方式。部署后按宿主要求添加连接，在新会话检查工具发现、选择与 Resolve。详见[远程接入](website/content/integrations/remote.md)。

## 已有 Agent 或 MCP Server

Agent 使用 `@devcodex/capability-graph/tools` 的 createGraphTools，取得 definitions 和 call。每个定义包含 inputSchema/outputSchema，Adapter 借用 Graph；默认五工具，可显式启用 match。宿主格式映射由应用负责，不为各框架增加专有包。

已有 MCP Server 保留原 transport/tools/resources/prompts，只合并 Graph 工具定义并分流命中名称。工具冲突明确失败，未命中调用交回原路由。成功/错误映射成协商版本的 MCP 信封，最后由 Graph 创建者关闭它。

[完整 server.mjs](examples/mcp/server.mjs) 提供原 ping、资源、Prompt 与 Graph 工具共存的可运行例子。消费者另装官方 @modelcontextprotocol/server@2.3.1，复制整个 examples/ 后由客户端启动它。

## Skill 与 Plugin

官方 Skill 位于 `plugin/skills/capability-discovery/SKILL.md`，可单独复制到宿主支持的 Skill 位置，但仍需已有可用 MCP 连接。setup 会显式安装同一 Skill；它不接管每条用户消息。

Plugin 包含根 plugin.json/mcp.json、skills，以及 Codex 兼容 `.codex-plugin/plugin.json` / `.mcp.json`。默认指向本地 HTTP 3333 端口，服务需显式启动；安装 Plugin 不自动提供运行中的服务。

需要 Plugin 分发时：通过 npm 安装 → 复制包内 plugin 到自有目录 → 配置其中 graph.config.json → 显式启动 HTTP 服务 → 按宿主本地 marketplace 机制安装 Plugin → 新会话使用 Skill。初始 providers/allowedProviders 为空，需要自己的声明。

Codex 安装步骤、清单差异和兼容限制见[完整教程](website/content/integrations/skill-plugin.md)。Codex Plugin 使用 HTTP；stdio 请使用前面的 setup 登记方式。

## CLI 与维护

图谱命令：

```sh
capability-graph validate --file provider.json
capability-graph doctor --config graph.config.json
capability-graph serve --config graph.config.json --transport stdio
capability-graph serve --config graph.config.json --transport http
```

宿主维护：

```sh
capability-graph setup --host codex --config /absolute/path/graph.config.json --dry-run
capability-graph setup --host codex --config /absolute/path/graph.config.json
capability-graph doctor --host codex
capability-graph doctor --host codex --repair --dry-run
capability-graph doctor --host codex --repair
capability-graph clean --host codex --dry-run
capability-graph clean --host codex
```

维护命令支持 --json；host 支持 codex。用户 MCP 配置在 CODEX_HOME/config.toml，缺省 ~/.codex/config.toml；Skill 在 ~/.agents/skills/capability-discovery/SKILL.md；拥有权状态在 ~/.capability-graph/。

setup 幂等，只修改自有 MCP 表和 Skill，保存绝对路径。dry-run 不写文件、不启动服务、不调用模型。doctor 实际启动登记服务列工具后关闭测试进程，不等同宿主模型完成任务。repair 只补自有缺失项，clean 不删业务配置、Provider 或知识文件。遇到同名非自有项、用户编辑、未知 symlink 或不安全 TOML 布局明确冲突，不覆盖。

维护报告含 command/status/changed/checks/paths/warnings；status 为 ok/planned/conflict/failed。退出码 0 成功或预览、1 配置/启动失败、2 参数无效、3 保护冲突。validate/doctor --config/serve 失败退出1。

更新后安装路径变化可显式重跑 setup。清理后按宿主要求重载，不强制杀掉宿主会话。中断事务/锁需检查状态，不能强制覆盖用户内容。

## API、生命周期与预算

| 方法 | 返回及行为 |
| --- | --- |
| open | 加载/严格校验全部来源；授权固定 |
| listProviders / listCatalog | 完整授权摘要或精简目录，没有隐式分页或截断 |
| getCapabilities | 完整详情与适用结果，不读取文档正文 |
| resolve | selected/nodes/edges/unresolved/meta |
| readDocument | 已声明本地正文、原始字节数/哈希 |
| match | status/selection/同快照 graph |
| reload | ok/revision/providers/error?，全部候选校验后原子发布 |
| close | 幂等，拒绝新工作、取消活动 match，不关闭借用 executor |

所有静态结果包含授权视图 Revision。它不包含文档正文、Context、模型状态或绝对路径；隐藏 Provider 更新不改变公开 Revision。reload 失败保留旧快照，必须检查 ok 和 updated/unchanged/failed/not_applied；增删来源需重新 open。

Core 默认 UTF-8 字节预算：Provider/Catalog/Result/ModelCatalog 各8 MiB，Document1 MiB，input/ModelOutput各64 KiB，Context128 KiB。对应 limits 字段完整列在[配置参考](website/content/reference/configuration.md)。超限显式错误，不删数据冒充完整。

SDK 失败为 GraphError，稳定字段 code/phase/message/可选 nextAction，可用 toJSON。空结果、unknown、partial 与错误分别处理。详细参数、嵌套返回字段、全部公开类型和错误恢复见 [SDK 参考](website/content/reference/sdk.md)、[类型](website/content/reference/types.md)、[错误](website/content/reference/errors.md)。

## 运行示例

本地 npm 安装后，将包内 examples/ 复制到你的项目中运行：

```sh
cp -R node_modules/@devcodex/capability-graph/examples ./examples
node examples/minimal/static.mjs
node examples/multi-provider/main.mjs
node examples/vextjs/resolve.mjs
```

[VextJS 示例](examples/vextjs/guide.md) 基于真实 vextjs@2.0.0 API；另安装该版本后执行 `node --experimental-strip-types examples/vextjs/verify.mjs`，在Node22.12剥离类型，验证真实框架处理链的路由和body校验。createTestApp使用内存请求，不监听TCP端口；Graph不加载或执行路由，示例关系由作者维护。

独立 Codex 匹配适配器要求 Linux、bubblewrap 和固定版本的原生 CLI，不支持 Windows/WSL。Codex Plugin 使用 HTTP，普通 Codex stdio 接入使用 setup。OpenAI 与远程宿主还需满足模型、协议、网络和认证条件，详见[兼容说明](website/content/resources/compatibility.md)。

## 源码开发

以下命令面向源码贡献者。应用集成请使用前面的 npm 安装方式。

```sh
npm ci
npm test
npm run build
npm run smoke:package
npm --prefix website ci
npm run docs:check
npm run docs:build
npm run docs:browser
```

文档源码位于 website/content，独立 Rspress 工程和主题位于 website/。docs:dev 启动本地开发；站点依赖与构建输出不进入 SDK npm 包。

CG_BUILD_DIR、CG_TEST_DIR、CG_ARTIFACTS_DIR 指定仓库外构建、夹具与消费者位置；CG_SITE_BUILD_DIR 指定仓库外站点输出，CG_SITE_ARTIFACTS_DIR 指定浏览器报告/截图。工具不会因此配置模型或登记宿主。

smoke:package 构建 npm 包并在独立项目安装，检查公开入口、TypeScript、ESM、CLI、MCP 和示例。完整命令与产物路径见[源码开发说明](website/content/resources/development.md)。

维护者直接在 main 开发。推送 main 后自动构建并部署 Pages 文档；推送稳定版本 tag 后，release.yml 依次校验版本、运行 CI、通过 npm Trusted Publisher 发布已验证包、核验 Registry 并创建 GitHub Release。认证配置、只读演练和恢复步骤见[维护者发版](website/content/resources/releasing.md)，新版变更见 [CHANGELOG](CHANGELOG.md)。
