# Codex 便捷登记

此路线复用当前 Codex 模型，通过 MCP 发现与解析能力，不需要额外模型 API Key、独立 Codex 匹配目录或 Plugin marketplace。

## 准备包与配置

先安装 CLI：

```sh
npm install --global @devcodex/capability-graph
```

创建[快速开始](/getting-started/quick-start)中的provider.json和graph.config.json即可，不要求知识文件。已有项目本地安装时，也可在该项目中用 `npx --no-install capability-graph` 运行以下命令。其他安装方式见[安装说明](/getting-started/installation)。

## 预览、登记与诊断

```sh
capability-graph setup --host codex --config /absolute/path/graph.config.json --dry-run
capability-graph setup --host codex --config /absolute/path/graph.config.json
capability-graph doctor --host codex
```

setup 记录当前 Node、已安装 CLI 和配置的绝对路径，登记 capability_graph stdio MCP，并安装 capability-discovery Skill。配置中的 Provider 路径按 JSON 所在目录解析。普通 npm 安装不登记。

用户 MCP 配置在 CODEX_HOME/config.toml，缺省 ~/.codex/config.toml；Skill 在 ~/.agents/skills/capability-discovery/SKILL.md；拥有权状态在 ~/.capability-graph/。不静默修改其他登记、全局模型或协议功能开关。

## 开启新会话并使用

按客户端要求重载配置/开启新会话，然后明确请求：

```text
请使用 capability-discovery，为创建带请求校验的 Acme HTTP 接口发现能力，
展示依赖、适用条件和使用说明，不执行能力。
```

流程为读取 Provider/Catalog → 当前模型选择已有完整 ID → Resolve → 需要时按声明 ID 读文档。检查 applicability、completeness 与 Revision；有歧义时澄清，不编造能力。

stdio 服务由宿主按需启动和关闭，不占 HTTP 端口。Skill 不接管每条消息。诊断成功只证明登记服务可用，实际模型调用须单独核对。

stdio 支持 2026-07-28 与 2025-06-18；Codex CLI 0.163.0 的 stdio 使用后者。HTTP 的协议条件见 [MCP](/integrations/mcp)。各接入方式的条件见[版本与兼容](/resources/compatibility)。

## 修复与移除

```sh
capability-graph doctor --host codex --repair --dry-run
capability-graph doctor --host codex --repair
capability-graph clean --host codex --dry-run
capability-graph clean --host codex
```

只管理仍属于本模块的未修改项；用户编辑或同名冲突不会被覆盖。clean 不删业务配置/Provider/知识文件，清理后按宿主要求重载，不强制结束宿主会话。参数、报告与退出码见[CLI](/integrations/cli)。

## 如何判断登记成功

dry-run的planned只表示预览完整；实际setup报告ok及changed表示登记结果。host doctor会临时启动已登记服务并做工具发现，然后关闭子进程；它不证明当前聊天模型已完成业务任务。

新会话中应能发现五个静态工具，Catalog包含显式配置的acme::route/acme::schema，再由当前模型选择ID并Resolve。最小Provider没有guide正文，不要把readDocument失败当安装失败；需要正文时换成[详情来源](/guide/results#读取目录详情与知识正文)。

有登记但工具缺失时先核对Node/CLI/配置绝对路径与宿主协议；只有Skill可见时检查MCP连接。更新安装位置后显式重跑setup再新会话；不要重复安装同名Plugin。隔离维护目录验证与用户实际宿主接入是两项证据。
