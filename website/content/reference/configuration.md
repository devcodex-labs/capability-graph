# 完整配置参考

SDK 从根入口导入 CapabilityGraph，CLI 从 graph.config.json 读取纯 JSON。字段严格校验，未知字段/错误类型/null 不按省略处理。参数中的 undefined 仅适用于代码调用。

## Graph 与 Provider 来源

| 路径 | 类型 / 必填 | 默认、边界与作用 |
| --- | --- | --- |
| open.providers | ProviderSource[] / 是 | [] 合法；来源 ID 不重复 |
| providers[].file | string / 与 definition 二选一 | 非空文件路径；文档根固定 JSON 所在目录，不再传 documentRoot |
| providers[].definition | ProviderDefinition / 与 file 二选一 | 纯 JSON 按值加载；reload 不重读原 JS 对象 |
| providers[].documentRoot | string / 内联本地文档需要 | 仅 definition 可用，可信本地根 |
| open.allowedProviders | string[] / 否 | 省略为已加载全部，[] 为零授权；查询只能缩小范围 |
| open.model | ModelExecutor / 否 | 不配置仍可静态查询；match 明确报未配置 |
| open.limits | Partial GraphLimits / 否 | 正安全整数预算，单位 UTF-8 字节 |

SDK 相对路径按 open 时 cwd 固定。CLI 对 Provider、documentRoot、Codex 模型路径按配置 JSON 所在目录解析，不使用宿主启动目录。

## GraphLimits

| 字段 | 默认 |
| --- | --- |
| maxProviderBytes | 8388608 |
| maxCatalogBytes | 8388608 |
| maxResultBytes | 8388608 |
| maxDocumentBytes | 1048576 |
| maxInputBytes | 65536 |
| maxContextBytes | 131072 |
| maxModelCatalogBytes | 8388608 |
| maxModelOutputBytes | 65536 |

超限显式失败，不隐式分页、截断或删字段冒充完整结果。

## CLI 顶层

| 路径 | 类型 / 必填 | 默认与规则 |
| --- | --- | --- |
| schemaVersion | 1 / 否 | 省略允许 |
| providers | ProviderSource[] / 是 | 来源规则同 SDK |
| allowedProviders | string[] / 否 | 授权规则同 SDK |
| limits | Partial GraphLimits / 否 | 同上 |
| model | object / 否 | type 为 openai 或 codex，见下表；不接受函数或可执行配置 |
| enableMatch | boolean / 否 | false；true 必须有 executor |
| transport | stdio或http / 否 | stdio；serve --transport 显式覆盖 |
| http | object / 否 | HTTP 端点/认证/预算配置 |

CLI OpenAI model：type:'openai'、apiKeyEnv（必填环境变量名）、model（必填模型 ID）、可选 baseURL/maxOutputBytes。SDK 对应 createOpenAIExecutor 是 apiKey 本身，另有可信 fetch；默认/作用见 OpenAI 页。

CLI Codex model：type:'codex'、可选 command/authHome/scratchRoot/runtimeRoot/model/maxOutputBytes，按 Codex 页解释；command 配置时为明确原生可执行路径，省略查 PATH。SDK createCodexExecutor 接受同名字段，不接受 type。自定义 executor 只从代码接入。

## MCP Server / Tool Adapter

createMcpServer({graph,transport,enableMatch?,http?}) 的 graph/transport 必填，enableMatch 默认 false；服务借用 Graph。createGraphTools(graph,{enableMatch?}) 同样默认 false。启用 match 时初始化验证 executor 已配置。

| http 路径 | 类型 | 默认 / 规则 |
| --- | --- | --- |
| host | string | 127.0.0.1；local 仅回环 |
| port | integer | 3333；0–65535，0 为系统分配 |
| path | string | /mcp；以 / 开头，无 query/fragment |
| access | local/private/public-readonly | local；远程 private 必须认证，公开须批准范围 |
| auth.type | none或bearer | none |
| auth.token | string（SDK） | bearer 必需非空；可信部署提供 |
| auth.tokenEnv | string（仅 CLI JSON） | bearer 必需环境变量名，不是 token 本身 |
| publicDocuments | boolean | false；公开模式批准正文须显式 true |
| allowedHostnames | string[] | 回环默认 localhost/127.0.0.1/::1，否则监听 host；部署填可接受主机名 |
| allowedOrigins | string[] | 默认拒绝所有带 Origin 的跨来源请求；允许项须为精确 HTTP(S) origin |
| limits.maxBodyBytes | 正安全整数 | 1048576 |
| limits.maxResponseBytes | 正安全整数 | 20971520 |
| limits.maxInFlight | 正安全整数 | 32 |
| limits.requestTimeoutMs | 正安全整数 | 30000；HTTP enableMatch 时必须显式 >=65000，推荐 75000 |
| limits.shutdownTimeoutMs | 正安全整数 | 5000 |

public-readonly 必须显式 Graph 授权，禁止 enableMatch。HTTP 服务不自行提供 TLS/OAuth。stdio 的 stdout 仅协议；同一 API 的 http 字段不改变 stdio 本身的进程传输。

[Provider 字段](/guide/providers)、[SDK 参数/结果](/reference/sdk)、[模型参数](/models/openai)、[CLI 维护](/integrations/cli)分别列出细项与恢复办法。
