# Skill 与 Plugin

Plugin 目录包含 Agent Plugins 1.0 的 plugin.json/mcp.json/skills 和 Codex 兼容清单。先在你的项目安装并复制 Plugin：

```sh
npm install @devcodex/capability-graph@2.0.0
cp -R node_modules/@devcodex/capability-graph/plugin ./plugin
```

然后配置服务和宿主：

1. 在当前项目中使用 `npx --no-install capability-graph` 运行 CLI。需要直接使用 `capability-graph` 时，先执行 `npm install --global @devcodex/capability-graph@2.0.0`。
2. 把包内 plugin 复制到你管理的 Plugin 目录。修改 graph.config.json，配置自己的 Provider 与明确 allowedProviders。初始为空且不暴露任何能力；不要把凭据写入这里。显式运行 `capability-graph serve --config /absolute/plugin/graph.config.json --transport http`，保持服务运行。
3. 默认 Plugin 连接本机 `http://127.0.0.1:3333/mcp`，不会自动启动服务。便携宿主使用根 mcp.json，Codex 兼容模式使用 .mcp.json。两份文件保持相同 URL；远程部署替换实际 HTTPS 地址。便携 HTTP 声明为 `{type:'streamable-http',url}`，Codex 为 `{url}`。
4. 将该目录加入宿主的本地 marketplace，再显式安装 Plugin。示例 marketplace 的 plugins 项为 `{name:'capability-graph',source:{source:'local',path:'./plugin'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}`，name 可为 capability-graph-local。路径相对于 marketplace 根。使用 `codex plugin marketplace add /absolute/marketplace-root`，然后 `codex plugin add capability-graph@capability-graph-local`。只有你显式执行这些命令才修改该宿主配置。
5. 用 capability-discovery Skill 执行目录→语义选择→resolve，检查 partial/unknown 和 Revision。Codex CLI 0.163.0 需要 `-c features.mcp_2026_07_28=true`；其他宿主版本请确认其 HTTP 协议配置。宿主需要能只读读取已安装 SKILL.md。默认 server 不调用模型。

Codex Plugin 使用 HTTP。Codex Plugin 的 stdio 模式不在 v2.0.0 支持范围内；需要 stdio 时使用 [setup 登记](/integrations/codex)。其他 MCP 客户端的 stdio 配置见 [MCP](/integrations/mcp)。

可单独把 `plugin/skills/capability-discovery` 复制到宿主支持的 Skill 位置；安装 Skill 不会自动接通 MCP。不要把临时验证环境的登录文件或安装缓存纳入 Plugin。

ChatGPT Work 使用宿主可访问的 HTTPS MCP 地址，通过宿主连接设置添加。私有连接还需宿主接受的认证方式与兼容协议；步骤见[远程 HTTPS](/integrations/remote)。


## 与便捷登记的关系

setup 安装同一官方 Skill 并登记独立 stdio MCP。Plugin 继续采用当前已验证的 HTTP 分发配置，服务由部署方显式启动。不要同时安装两份同名登记并期待自动合并；同名/用户编辑由维护工具保护。

单独 Skill 仅指导用法，需要已有可用 Graph 工具；Plugin 清单不是能力实现，也不会自动启动当前 HTTP 服务。普通 Codex 用户优先按[便捷接入](/integrations/codex)，需要 Plugin 分发时使用本页。
