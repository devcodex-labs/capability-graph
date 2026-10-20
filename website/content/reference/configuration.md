# 完整配置参考

SDK 从根入口导入CapabilityGraph，CLI从graph.config.json读取纯JSON。未知字段和错误类型按各字段拒绝；null不是通用“采用默认值”的写法，具体差异见本页对照。undefined只适用于代码调用，不能写进JSON。

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

| 路径（SDK：open.limits；CLI：limits） | 默认UTF-8字节 | 限制的对象与超限 |
| --- | --- | --- |
| limits.maxProviderBytes | 8388608（8 MiB） | 每份Provider文件原始字节/内联定义JSON；CG_DEFINITION_INVALID |
| limits.maxCatalogBytes | 8388608（8 MiB） | 完整CatalogResult；CG_CATALOG_TOO_LARGE |
| limits.maxResultBytes | 8388608（8 MiB） | 普通查询/文档/匹配的完整JSON返回；CG_RESULT_TOO_LARGE |
| limits.maxDocumentBytes | 1048576（1 MiB） | 单次本地文档原始字节；CG_DOCUMENT_TOO_LARGE |
| limits.maxInputBytes | 65536（64 KiB） | match.input文本；CG_INPUT_TOO_LARGE |
| limits.maxContextBytes | 131072（128 KiB） | 结构化Context的JSON字节；CG_INPUT_TOO_LARGE |
| limits.maxModelCatalogBytes | 8388608（8 MiB） | 发给executor的完整候选Catalog数组；CG_MODEL_CONTEXT_EXCEEDED |
| limits.maxModelOutputBytes | 65536（64 KiB） | executor返回选择的JSON字节；CG_MODEL_OUTPUT_TOO_LARGE |

超限显式失败，不隐式分页、截断或删字段冒充完整结果。

以上均为正安全整数，不是token配额。目录结果也受maxResultBytes限制。OpenAI/Codex适配器自己的maxOutputBytes默认65536，用于模型候选/外部传输边界；HTTP响应预算则约束协议封套，不能把三个层次互相替代。

## 省略、undefined、null与空数组

| 调用位置 | 省略或undefined | null | [] |
| --- | --- | --- | --- |
| SDK open.providers | 必填，缺少失败 | 配置失败 | 合法空图谱 |
| open.allowedProviders | 全部已加载 | 配置失败 | 零授权 |
| listCatalog/listProviders的query.providers | 全部授权来源 | 输入失败 | 完整空列表 |
| resolve.ids/getCapabilities.ids | 缺少失败 | 输入失败 | 非法，根数组必须非空 |
| resolve.relations | 默认requires闭包 | CG_INPUT_INVALID | 只取根 |
| 查询context | 空事实 | CG_CONTEXT_INVALID | 结构非法 |
| match.options.timeoutMs | 60000毫秒 | CG_INPUT_INVALID | 类型非法 |
| open.limits或某个预算值 | 容器省略用默认；容器中显式undefined预算值不合法 | CG_CONFIG_INVALID | 容器非法 |
| MCP http及其预算/认证字段 | 按字段默认 | CG_CONFIG_INVALID | 仅allowedOrigins/allowedHostnames等数组字段可为空 |

例外需按当前实现区分：两个内置模型适配器的maxOutputBytes运行时使用nullish缺省，null会采用65536；公开TypeScript声明仍仅接受可选number，推荐省略字段，不把这一兼容行为推广到Graph/HTTP预算。关系或超时传null不会采用默认值。

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
| limits.requestTimeoutMs | 整数1–2147483647（毫秒） | 30000；HTTP enableMatch 时必须显式 >=65000，推荐 75000 |
| limits.shutdownTimeoutMs | 整数1–2147483647（毫秒） | 5000；超出范围在服务监听前报 CG_CONFIG_INVALID |

public-readonly 必须显式 Graph 授权，禁止 enableMatch。HTTP 服务不自行提供 TLS/OAuth。stdio 的 stdout 仅协议；同一 API 的 http 字段不改变 stdio 本身的进程传输。

[Provider 字段](/guide/providers)、[SDK 参数/结果](/reference/sdk)、[模型参数](/models/openai)、[CLI 维护](/integrations/cli)分别列出细项与恢复办法。
