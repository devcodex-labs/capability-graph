# Skill 与 Plugin

当你需要通过宿主 Plugin 机制分发 Skill 与 MCP 配置时选择这条路线；只想接入自己的本地 Codex，优先使用[客户端教程](/integrations/codex)。Plugin 不包含业务 Provider，实现能力仍由你自己的软件提供。

## 安装材料与配置

Plugin 目录包含 Agent Plugins 1.0 的 plugin.json/mcp.json/skills 和 Codex 兼容清单。先在你的项目安装并复制 Plugin：

```sh
npm install @devcodex/capability-graph
cp -R node_modules/@devcodex/capability-graph/plugin ./plugin
```

PowerShell 用 `Copy-Item -LiteralPath node_modules/@devcodex/capability-graph/plugin -Destination plugin -Recurse`。工作目录为本地安装该包的项目根，复制后确认 `plugin/graph.config.json` 存在。

然后配置服务和宿主：

1. 在当前项目中使用 `npx --no-install capability-graph` 运行 CLI。需要直接使用 `capability-graph` 时，先执行 `npm install --global @devcodex/capability-graph`。
2. 把包内 plugin 复制到你管理的 Plugin 目录。修改 graph.config.json，配置自己的 Provider 与明确 allowedProviders。初始为空且不暴露任何能力；不要把凭据写入这里。显式运行 `capability-graph serve --config /absolute/plugin/graph.config.json --transport http`，保持服务运行。
3. 默认 Plugin 连接本机 `http://127.0.0.1:3333/mcp`，不会自动启动服务。便携宿主使用根 mcp.json，Codex 兼容模式使用 .mcp.json。两份文件保持相同 URL；远程部署替换实际 HTTPS 地址。便携 HTTP 声明为 `{type:'streamable-http',url}`，Codex 为 `{url}`。
4. 将该目录加入宿主的本地 marketplace，再显式安装 Plugin。marketplace 顶层 `name` 为 `capability-graph-local`；`plugins[]` 中的 `name` 为 `capability-graph`，与 Plugin 清单一致。例如 plugins 项为 `{name:'capability-graph',source:{source:'local',path:'./plugin'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}`。路径相对于 marketplace 根。使用 `codex plugin marketplace add /absolute/marketplace-root`，然后 `codex plugin add capability-graph@capability-graph-local`；安装 ID 为 `插件名@marketplace名`。只有你显式执行这些命令才修改该宿主配置。
5. 用 capability-discovery Skill 执行目录→语义选择→resolve，检查 partial/unknown 和 Revision。Codex CLI 0.163.0 需要 `-c features.mcp_2026_07_28=true`；其他宿主版本请确认其 HTTP 协议配置。宿主需要能只读读取已安装 SKILL.md。默认 server 不调用模型。

Codex Plugin 使用 HTTP。Codex Plugin 的 stdio 模式不在 v2.0.0 支持范围内；需要 stdio 时使用 [setup 登记](/integrations/codex)。其他 MCP 客户端的 stdio 配置见 [MCP](/integrations/mcp)。

可单独把 `plugin/skills/capability-discovery` 复制到宿主支持的 Skill 位置；安装 Skill 不会自动接通 MCP。不要把临时验证环境的登录文件或安装缓存纳入 Plugin。

ChatGPT Work 使用宿主可访问的 HTTPS MCP 地址，通过宿主连接设置添加。私有连接还需宿主接受的认证方式与兼容协议；步骤见[远程 HTTPS](/integrations/remote)。


## 与便捷登记的关系

setup 安装同一官方 Skill 并登记独立 stdio MCP。Plugin 继续采用当前已验证的 HTTP 分发配置，服务由部署方显式启动。不要同时安装两份同名登记并期待自动合并；同名/用户编辑由维护工具保护。

单独 Skill 仅指导用法，需要已有可用 Graph 工具；Plugin 清单不是能力实现，也不会自动启动当前 HTTP 服务。普通 Codex 用户优先按[便捷接入](/integrations/codex)，需要 Plugin 分发时使用本页。

## 完整本地marketplace示例

本节适合需要整体分发MCP/Skill的使用者；普通个人Codex接入优先[setup](/integrations/codex)。以下路径都位于你新建的 `graph-marketplace/` 工作目录，不能将包内空providers模板当作已有图谱。

先创建ESM/npm项目并安装 `npm install @devcodex/capability-graph`。接着复制包内Plugin和非空最小Provider：

Bash（在graph-marketplace目录）：

```bash
mkdir -p .agents/plugins providers/acme
cp -R node_modules/@devcodex/capability-graph/plugin ./plugin
cp node_modules/@devcodex/capability-graph/examples/minimal/provider.json providers/acme/provider.json
```

PowerShell（同一目录）：

```powershell
New-Item -ItemType Directory -Path .agents/plugins,providers/acme -Force | Out-Null
Copy-Item -LiteralPath node_modules/@devcodex/capability-graph/plugin -Destination ./plugin -Recurse -Force
Copy-Item -LiteralPath node_modules/@devcodex/capability-graph/examples/minimal/provider.json -Destination providers/acme/provider.json
```

目标plugin目录应事先不存在，避免混入旧清单。完整布局为：

```text
graph-marketplace/
├── package.json
├── .agents/plugins/marketplace.json
├── providers/acme/provider.json
└── plugin/
    ├── plugin.json
    ├── mcp.json
    ├── graph.config.json
    ├── .codex-plugin/plugin.json
    ├── .mcp.json
    └── skills/capability-discovery/SKILL.md
```

providers/acme/provider.json即[最小声明](/getting-started/quick-start)，包含route和schema，route显式requires schema。它与Plugin清单是两种数据，安装Plugin不自动发现Provider。

将下列**完整配置**保存到plugin/graph.config.json，替换包内空模板；路径基于该配置所在目录，`../providers`因此指向marketplace根下的providers：

```json title="plugin/graph.config.json"
{
  "schemaVersion": 1,
  "providers": [
    {
      "file": "../providers/acme/provider.json"
    }
  ],
  "allowedProviders": [
    "acme"
  ],
  "transport": "http",
  "enableMatch": false
}
```

新建 `.agents/plugins/marketplace.json`：

```json title=".agents/plugins/marketplace.json"
{
  "name": "capability-graph-local",
  "interface": {
    "displayName": "Capability Graph local"
  },
  "plugins": [
    {
      "name": "capability-graph",
      "source": {
        "source": "local",
        "path": "./plugin"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

source.path相对于 `graph-marketplace/` 根，而非 `.agents/plugins/`。包内两套清单分别为便携格式与Codex兼容格式；保留已有文件，关键完整内容如下。

plugin/plugin.json：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "capability-graph",
  "version": "2.0.0",
  "description": "Discover declared capabilities and resolve their dependency graph before using them.",
  "license": "Apache-2.0"
}
```

plugin/mcp.json（便携格式需要type）：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "capability_graph": { "type": "streamable-http", "url": "http://127.0.0.1:3333/mcp" }
  }
}
```

plugin/.codex-plugin/plugin.json与plugin/.mcp.json（兼容格式）：

```json
{
  "name": "capability-graph",
  "version": "2.0.0",
  "description": "Discover declared capabilities and resolve their dependency graph before using them.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

```json
{
  "mcpServers": {
    "capability_graph": { "url": "http://127.0.0.1:3333/mcp" }
  }
}
```

这些清单的URL必须与实际服务一致。本地开发默认回环，远程则提供可达HTTPS及宿主接受的认证；不是把本机localhost写进清单就能远程使用。

## 先验证服务，再安装分发

在marketplace根执行：

```sh
npx --no-install capability-graph doctor --config plugin/graph.config.json
npx --no-install capability-graph serve --config plugin/graph.config.json --transport http
```

doctor应显示非空来源和五工具，serve的stderr应报告ready及URL；保持服务运行。先用[MCP客户端](/integrations/mcp#http先启动服务再连接)检查Catalog含acme::route/acme::schema及两节点Resolve，确认声明与授权正确。

需要手动CLI安装的宿主，先 `codex plugin --help` 核对目标版本支持，再从marketplace根显式执行：

```sh
codex plugin marketplace add .
codex plugin add capability-graph@capability-graph-local
```

桌面宿主也可按[官方本地marketplace安装说明](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)重启后在Plugins目录选择该来源并安装。CLI与桌面的安装入口依宿主版本而定；此处完整文件格式不等于已在你的宿主安装通过。

安装后开启新会话，启用Plugin并明确请求使用capability-discovery，检查工具可见→Catalog非空→选择真实ID→Resolve完整结果。Codex CLI0.163.0的HTTP还需其现代协议开关；不要把该CLI开关直接套到其他桌面宿主。已有同名setup登记时先选择一种路线，避免重复连接。

结束本地验证后按Ctrl+C关闭自己启动的服务；Plugin卸载/停止启用不等于自动停止外部HTTP进程。仅安装Skill也不会自动连通MCP。
