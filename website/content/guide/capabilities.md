# 按任务查能力

从你要完成的任务出发，找到使用指南和可运行示例。这里按当前 2.1.1 的公开功能组织；类型与参数的精确形状见 [SDK](/reference/sdk) 和[公开类型](/reference/types)。

首次使用推荐[第一个图谱](/getting-started/quick-start)；本地 Codex 用户可直接走[客户端接入教程](/integrations/codex)。示例路径相对安装包根目录，复制方式见[运行示例](/examples/index)。

## 声明、发现与理解能力

| 稳定任务 ID | 你要做什么 | 示例 |
| --- | --- | --- |
| `declare-provider` | [声明已有能力](/guide/providers) | `examples/minimal/provider.json` |
| `open-graph` | [打开图谱](/getting-started/quick-start) | `examples/minimal/static.mjs` |
| `authorize-providers` | [限制来源访问](/guide/relations#区分三种范围) | `examples/scenarios/relations.mjs` |
| `discover-catalog` | [浏览来源与能力目录](/guide/results#读取目录详情与知识正文) | `examples/minimal/details.mjs` |
| `read-details` | [查看能力使用说明](/guide/results) | `examples/minimal/details.mjs` |
| `resolve-relations` | [解析依赖与查找引用者](/guide/relations) | `examples/scenarios/relations.mjs` |
| `evaluate-context` | [判断环境适用性](/guide/context) | `examples/scenarios/context.mjs` |
| `read-documents` | [读取本地正文与引用 URL](/guide/documents) | `examples/documents/read.mjs` |
| `reload-close` | [更新与释放图谱](/guide/lifecycle) | `examples/scenarios/lifecycle.mjs` |

遇到 `partial`、`unknown` 或拒绝时，先按[错误与恢复](/reference/errors)处理，不能把已匹配等同于可执行。

## 接入应用或宿主

| 稳定任务 ID | 你要做什么 | 示例或安装材料 |
| --- | --- | --- |
| `match-task` | [由应用模型选择能力](/models/match) | `examples/scenarios/match.mjs` |
| `openai-executor` | [连接 OpenAI 与兼容网关](/models/openai) | 同页完整客户端代码 |
| `codex-executor` | [使用隔离的 Codex 匹配进程](/models/codex) | 同页完整配置与代码 |
| `custom-executor` | [接入自定义模型执行器](/models/custom) | `examples/custom-executor.mjs` |
| `agent-tools` | [接入已有 Agent 工具循环](/integrations/tools) | 同页定义转换与调用代码 |
| `mcp-server` | [通过 MCP 提供查询](/integrations/mcp) | 同页 stdio/HTTP 完整代码 |
| `existing-mcp` | [合入已有 MCP 服务](/integrations/existing-server) | `examples/mcp/server.mjs` |
| `codex-host` | [接入本地 Codex 客户端](/integrations/codex) | `examples/codex-host/verify.mjs` |
| `plugin-host` | [通过 Skill 与 Plugin 接入](/integrations/skill-plugin) | `plugin/mcp.json` |
| `remote-host` | [连接远程 HTTPS 服务](/integrations/remote) | 同页服务、认证和客户端代码 |
| `cli-operations` | [校验配置与维护登记](/integrations/cli) | `examples/minimal/graph.config.json` |

宿主当前模型路线无需再配置独立匹配模型；应用主动 `match` 才需要执行器。独立 Codex 执行器的 Linux 隔离前提，不适用于“本地 Codex 客户端通过 MCP 查询”这条路线。

## 为后续能力图谱准备文档

稳定任务 ID 用于文档维护，目前不是已注册的 `providerId::capabilityId`。机器可读维护清单位于源码 `website/capability-map.json`，包含用途、输入、输出、前置、错误入口和代码依据；它不随 npm 分发，也不由运行时自动加载。

后续编写本包的 Provider 时，按用户任务组织能力，一个能力可关联完整章节或文件，无需给每个类型创建能力。沿用现有字段：

| 材料 | Provider 中的表达 |
| --- | --- |
| 稳定任务与选择依据 | `id`、`name`、`description`、`whenToUse` |
| 操作、参数、结果与示例 | `usage.instructions/input/output/examples` |
| 环境前提 | `appliesTo`，只放调用方能提供的事实 |
| 前置与关联任务 | `relations`，由作者确认，不从链接自动推断 |
| 较长指南 | `documents`，按 ID 关联根内文件或 HTTPS URL |

:::note 引用与正文
网页锚点用于阅读定位。`file` 按整文件读取，`guide.md#section` 不是片段读取参数；URL 仅引用，`readDocument` 不抓取远程正文。宿主要读取正文时，提供已声明的本地 Markdown，或显式调用外部获取工具。
:::

新增功能时同步维护清单、指南和示例。“接口名出现在文档中”只证明符号可查，第一次成功路径仍需实际运行。`llms.txt` 是页面链接索引，不能替代能力声明、关系或正文。
