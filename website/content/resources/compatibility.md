# 版本与兼容

本手册对应 **Capability Graph v2.0.0**，包名为 `@devcodex/capability-graph`。

## 运行环境

| 项目 | 要求 |
| --- | --- |
| Node.js | >=22.12.0；Linux Node 22.12 与 24 已验证 |
| 模块格式 | ESM；JavaScript 使用 .mjs 或 type:module，TypeScript 使用 NodeNext/ESM |
| 类型 | npm 包自带 TypeScript 声明，无需另装 @types 包 |
| 静态查询 | 无模型、模型 SDK 或模型凭据要求 |
| 其他运行平台 | 在目标环境检查文件权限、路径和 MCP 进程启动；独立 Codex 匹配另有下述限制 |

Provider 的 version 描述其声明版本，与 SDK 的 npm 版本独立。Graph Revision 标识当前授权视图，也不等同于 npm 版本。

## MCP 协议与宿主

| 接入方式 | 协议 / 条件 |
| --- | --- |
| MCP stdio | 2026-07-28、2025-06-18；客户端管理服务进程 |
| MCP Streamable HTTP | 仅 2026-07-28；客户端需支持该版本 |
| Codex setup | 登记 stdio MCP + Skill；Codex CLI 0.163.0 使用 2025-06-18 |
| Codex Plugin | 使用 HTTP；Codex CLI 0.163.0 需启用 features.mcp_2026_07_28 |
| Codex Plugin stdio | 不在 v2.0.0 支持范围；需要 stdio 时使用 setup |
| ChatGPT Work 等远程宿主 | 可达的 HTTPS、兼容的 HTTP 协议、宿主接受的认证方式 |

新宿主或新版本应先确认其协议和认证支持，再检查工具列表与一次完整的 Catalog → 选择 → Resolve 调用。Codex 的 HTTP 配置见 [MCP](/integrations/mcp)，远程连接见 [HTTPS 接入](/integrations/remote)。

## 模型与可选依赖

| 方式 | 条件 |
| --- | --- |
| 宿主当前模型 | 已建立 MCP 连接；服务默认只提供五个静态工具，无需额外 API Key |
| OpenAI | 另装 openai@7.39.0；有效 API 凭据、模型权限、Responses + strict Structured Outputs |
| 兼容网关 | HTTPS baseURL，兼容 Responses 和 strict 输出；仅修改地址不会转换协议 |
| 独立 Codex CLI | Linux + bubblewrap + 原生 CLI 0.163.0；可信固定安装、专用登录目录和可用隔离权限 |
| 自定义 ModelExecutor | 由应用适配现有模型，遵守结构化选择、AbortSignal 与资源清理约定 |

独立 Codex 匹配不支持 Windows/WSL，也不会退回无隔离执行。不满足平台、版本或隔离条件时返回 CG_MODEL_EXECUTOR_UNSAFE。普通 Codex 宿主通过 MCP 使用当前模型，不需要安装这个独立匹配适配器的隔离环境。

模型选择受输入、Context、目录描述及模型影响。Graph 校验已有 ID、权限、关系和适用条件；调用方仍需处理 ambiguous、needs_context、unknown 和 partial。参见 [match 与结果处理](/models/match)。

## 示例版本

[VextJS 案例](/examples/vextjs) 使用 `vextjs@2.0.0`，只描述带请求校验的 greeting 流程及其依赖。使用其他框架版本时，应由 Provider 作者更新声明、使用说明和 appliesTo 条件。
