# 接入本地 Codex 客户端

<a id="codex-便捷登记"></a>

此路线复用当前 Codex 模型，通过 MCP 发现与解析能力，不需要额外模型 API Key、独立 Codex 匹配目录或 Plugin marketplace。

## 选择客户端与准备环境

<a id="准备包与配置"></a>

这条路线把 Graph 当作本地 MCP 服务，查询使用当前聊天的模型。它与[独立 Codex 匹配进程](/models/codex)不同，不要求 Linux/bubblewrap，也不要求第二次模型登录。

| 客户端 | 配置加载方式 | 本项目的验证边界 |
| --- | --- | --- |
| Codex CLI | 同一 host 的 `config.toml`；新会话用 `/mcp` 查看连接 | CLI 0.163.0 的 stdio 使用 `2025-06-18`；登记/诊断可隔离验证 |
| 本地桌面客户端 | 设置 → MCP servers，检查服务并 Restart；开启新本地任务 | 官方支持共享配置；不将 CLI 验证称为所有桌面版本实测 |
| Codex IDE 扩展 | 同一 host 的共享配置；重新加载扩展/新会话后核对连接 | 官方支持共享配置；具体扩展版本需在目标环境验证 |

“同一 host”指运行 Node/MCP 进程的同一台主机与用户配置环境。Windows、WSL、SSH 远端、容器各自有路径和环境，不能把 Windows 路径直接交给 Linux 端。云端任务也不会自动获得本地文件。

配置共享与桌面加载步骤依据 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)。客户端界面随版本变化；先记录客户端版本、Node 版本与报错，再排查连接。

前置：Node.js `>=22.12.0`、已能正常使用的 Codex 客户端，以及可读的本地目录。以下示例不安装 Acme 框架、不生成 HTTP 接口，只提供能力说明供宿主查询。

## 安装并准备完整示例

先安装 CLI：

```sh
npm install --global @devcodex/capability-graph
```

再创建独立目录并本地安装，用来运行验证脚本。以下两组命令选择与你的终端相符的一组，然后按下文保存四个文件，再执行验证：

```sh title="Bash"
mkdir cg-codex-demo
cd cg-codex-demo
npm init -y
npm install @devcodex/capability-graph
mkdir -p graph/knowledge
```

```powershell title="PowerShell"
New-Item -ItemType Directory -Path cg-codex-demo
Set-Location cg-codex-demo
npm init -y
npm install @devcodex/capability-graph
New-Item -ItemType Directory -Path graph/knowledge
```

全局安装提供下文 `capability-graph` 命令；本地安装为脚本提供模块解析。已有项目可只本地安装，并把下文命令前缀替换为 `npx --no-install capability-graph`。其他方式见[安装](/getting-started/installation)。本页四个文件可直接手动保存，不依赖安装包是否已包含这组新增示例；源码中的对应材料在 `examples/codex-host/`。

目录应为：

```text
cg-codex-demo/
  graph/
    graph.config.json
    provider.json
    verify.mjs
    knowledge/route.md
  node_modules/
  package.json
```

### 配置、能力与正文分别是什么

`graph.config.json` 指向 Provider，且只授权 `acme`；没有模型配置，默认不会提供服务端 `match` 工具。

<!-- example:examples/codex-host/graph.config.json -->
```json title="graph.config.json"
{
  "schemaVersion": 1,
  "providers": [{ "file": "./provider.json" }],
  "allowedProviders": ["acme"]
}
```

Provider 定义两项能力：`route` 依赖 `schema`，并关联本地正文 `guide`。`file` 相对配置文件，知识路径相对 Provider 根目录；都不依赖宿主从哪个目录启动。

<!-- example:examples/codex-host/provider.json -->
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
      "whenToUse": "The application needs an endpoint with validated input.",
      "usage": { "instructions": "Declare the request schema, then register the endpoint." },
      "relations": { "requires": ["schema"] },
      "documents": [{ "id": "guide", "title": "Route guide", "source": { "type": "file", "path": "knowledge/route.md" } }]
    },
    { "id": "schema", "name": "Request schema", "description": "Declare a schema to validate request input." }
  ]
}
```

`knowledge/route.md` 是普通 UTF-8 文件，内容为：

<!-- example:examples/codex-host/knowledge/route.md -->
```md title="knowledge/route.md"
# Route guide

Declare the request schema, then register the endpoint.
Capability Graph describes these steps; your application implements them.
```

### 先验证自己的材料

先展开下方“完整验证脚本”并保存为 `graph/verify.mjs`。四个文件都保存后，在 `cg-codex-demo` 执行 `node graph/verify.mjs`，预期摘要：

```json
{
  "providerIds": ["acme"],
  "catalogIds": ["acme::route", "acme::schema"],
  "selected": ["acme::route"],
  "nodeIds": ["acme::route", "acme::schema"],
  "completeness": "complete",
  "documentText": "# Route guide\n\nDeclare the request schema, then register the endpoint.\nCapability Graph describes these steps; your application implements them.\n"
}
```

这是脚本显式生成的摘要，不是原始 `ResolveResult`。`node graph/verify.mjs --full` 输出五次工具调用的完整原始结果，包括 Revision、适用条件、关系和正文哈希。结果字段解释见[读取解析结果](/guide/results)。

<details>
<summary>查看完整验证脚本及参数说明</summary>

脚本只打开声明并调用与 MCP 相同的五个静态工具，不修改宿主配置、不调用模型。默认无参数；`--full` 只切换输出。调用失败会抛出工具错误，`finally` 始终释放 Graph。

<!-- example:examples/codex-host/verify.mjs -->
```js title="verify.mjs"
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createGraphTools } from '@devcodex/capability-graph/tools';
import { fileURLToPath } from 'node:url';

const graph = await CapabilityGraph.open({
  providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }],
  allowedProviders: ['acme']
});
try {
  const tools = createGraphTools(graph);
  const call = async (name, args = {}) => {
    const outcome = await tools.call(name, args);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
    return outcome.data;
  };
  const providers = await call('capability_graph_list_providers');
  const catalog = await call('capability_graph_list_catalog');
  const details = await call('capability_graph_get_capabilities', { ids: ['acme::route'] });
  const resolved = await call('capability_graph_resolve', { ids: ['acme::route'] });
  const document = await call('capability_graph_read_document', {
    capabilityId: 'acme::route', documentId: 'guide'
  });
  // Default output is an explicit summary; --full preserves every raw result.
  const output = process.argv.includes('--full') ? { providers, catalog, details, resolved, document } : {
    providerIds: providers.items.map(item => item.providerId),
    catalogIds: catalog.items.map(item => item.id),
    selected: resolved.selected,
    nodeIds: resolved.nodes.map(node => node.capability.id),
    completeness: resolved.meta.completeness,
    documentText: document.text
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  await graph.close();
}
```

</details>

## 预览、登记与诊断

在 `cg-codex-demo` 中运行；`config` 必须指向上面的文件。两种终端均先解析绝对路径，不需要把示意路径原样复制：

```sh title="Bash 登记"
GRAPH_CONFIG="$(pwd)/graph/graph.config.json"
capability-graph setup --host codex --config "$GRAPH_CONFIG" --dry-run
capability-graph setup --host codex --config "$GRAPH_CONFIG"
capability-graph doctor --host codex
```

```powershell title="PowerShell 登记"
$graphConfig = (Resolve-Path -LiteralPath ./graph/graph.config.json).Path
capability-graph setup --host codex --config $graphConfig --dry-run
capability-graph setup --host codex --config $graphConfig
capability-graph doctor --host codex
```

setup 记录当前 Node、已安装 CLI 和配置的绝对路径，登记 capability_graph stdio MCP，并安装 capability-discovery Skill。配置中的 Provider 路径按 JSON 所在目录解析。普通 npm 安装不登记。

用户 MCP 配置在 CODEX_HOME/config.toml，缺省 ~/.codex/config.toml；Skill 在 ~/.agents/skills/capability-discovery/SKILL.md；拥有权状态在 ~/.capability-graph/。不静默修改其他登记、全局模型或协议功能开关。

## 开启新会话并使用

1. 在桌面设置的 MCP servers 中核对 `capability_graph` 并 Restart；CLI 开启新会话后输入 `/mcp`；IDE 重新加载扩展/会话并核对服务。
2. 确认连接的是包含上述文件的本地 host；不要在另一台远端机器上找同一路径。
3. 在新会话明确请求：

```text
请使用 capability-discovery，为创建带请求校验的 Acme HTTP 接口发现能力，
展示依赖、适用条件和使用说明，不执行能力。
```

流程为读取 Provider/Catalog → 当前模型选择已有完整 ID → Resolve → 需要时按声明 ID 读文档。检查 applicability、completeness 与 Revision；有歧义时澄清，不编造能力。

你应能在宿主调用记录中核对：

| 操作 | 工具名与参数 | 预期结果 |
| --- | --- | --- |
| 查来源 | `capability_graph_list_providers`，`{}` | 包含 `acme` |
| 读目录 | `capability_graph_list_catalog`，`{}` | `acme::route`、`acme::schema` |
| 看用法 | `capability_graph_get_capabilities`，`{"ids":["acme::route"]}` | 包含 `usage`、依赖与 `guide` 引用 |
| 解析依赖 | `capability_graph_resolve`，`{"ids":["acme::route"]}` | 根 route、依赖 schema；`complete` |
| 读正文 | `capability_graph_read_document`，`{"capabilityId":"acme::route","documentId":"guide"}` | 上述本地正文及 `contentHash` |

工具名前缀可能由宿主添加；以宿主显示的完整名称为准。参数里的 ID 必须来自当前目录，正文使用声明的 `documentId`，不能传任意本地路径或让模型自行猜测文件。

stdio 服务由宿主按需启动和关闭，不占 HTTP 端口。Skill 不接管每条消息。诊断成功只证明登记服务可用，实际模型调用须单独核对。

stdio 支持 2026-07-28 与 2025-06-18；Codex CLI 0.163.0 的 stdio 使用后者。HTTP 的协议条件见 [MCP](/integrations/mcp)。各接入方式的条件见[版本与兼容](/resources/compatibility)。

<a id="修复与移除"></a>

## 排错、更新与移除

| 现象 | 先检查 | 恢复动作 |
| --- | --- | --- |
| 配置路径报错 | `graph.config.json` 及相对 Provider 路径 | 在示例根重新解析绝对路径，再运行 validate/setup |
| 只有 Skill，没有工具 | MCP servers 或 `/mcp` 中的连接、Node/CLI路径 | 看启动错误；修正登记后 Restart/新会话 |
| Catalog 为空 | Provider 的能力数组与 `allowedProviders` | 修正可信配置，重新启动服务；空数组可以合法表示无能力 |
| 同名冲突或用户编辑保护 | setup 报告 `conflict` 及 paths | 保留现有内容，人工合并或选择一种接入路线，不强行覆盖 |
| 正文读取失败 | `documentId`、根内文件、读权限 | 以本页 guide 核对文件；URL 引用不能当本地正文读 |
| doctor 成功但聊天未调用 | 当前会话的工具发现记录、任务是否明确 | 新会话明确请求查询，并核对真实调用结果 |

移动 Node/全局包/配置位置后重新 `setup`。只更新已配置 Provider 时，由服务所有者显式重载或重启；新增来源、改授权需重新打开 Graph。移除登记前可以先预览：

```sh
capability-graph doctor --host codex --repair --dry-run
capability-graph doctor --host codex --repair
capability-graph clean --host codex --dry-run
capability-graph clean --host codex
```

只管理仍属于本模块的未修改项；用户编辑或同名冲突不会被覆盖。clean 不删业务配置/Provider/知识文件，清理后按宿主要求重载，不强制结束宿主会话。参数、报告与退出码见[CLI](/integrations/cli)。

## 如何判断登记成功

dry-run的planned只表示预览完整；实际setup报告ok及changed表示登记结果。host doctor会临时启动已登记服务并做工具发现，然后关闭子进程；它不证明当前聊天模型已完成业务任务。

本页示例应能发现五个静态工具、两个能力，并读取 `guide` 正文。若你改用快速开始的最小 Provider，它没有正文引用，此时不能要求 `readDocument` 成功。

有登记但工具缺失时先核对Node/CLI/配置绝对路径与宿主协议；只有Skill可见时检查MCP连接。更新安装位置后显式重跑setup再新会话；不要重复安装同名Plugin。隔离维护目录验证与用户实际宿主接入是两项证据。
