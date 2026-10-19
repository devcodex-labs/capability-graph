# 完整接入清单

各入口共用一份 Graph 定义与授权语义。Skill 是指导、Plugin 是分发、setup 是登记，均可与 MCP 组合。

| 接入方式 | 模型来源 | 入口 |
| --- | --- | --- |
| SDK 静态查询 | 无 | CapabilityGraph.open → Catalog/Detail/Resolve |
| SDK OpenAI 主动匹配 | 显式 API 模型 | createOpenAIExecutor → match |
| SDK 独立 Codex CLI | 独立只读进程 | createCodexExecutor → match |
| SDK 自定义模型 | 调用方现有模型 | ModelExecutor.select → match |
| 通用 Agent Tool Adapter | 通常宿主当前模型 | createGraphTools |
| 已有 MCP Server | 宿主当前模型或显式服务端模型 | 合并工具列表/分流调用，保留原传输 |
| 独立 MCP stdio | 通常宿主当前模型 | 客户端启动 serve --transport stdio |
| 独立 MCP HTTP | 通常宿主当前模型 | 服务端启动，客户端连接 URL |
| ChatGPT Work | 远程宿主当前模型 | 真实 HTTPS MCP + 宿主连接配置 |
| Codex 便捷登记 | 当前模型 | setup → stdio MCP + 官方 Skill |
| Skill 单独安装 | 当前模型 | 已连通的 MCP + Skill 指导 |
| Plugin | 当前模型 | 宿主 Plugin 安装机制 + MCP/Skill 清单 |

默认五工具：capability_graph_list_providers、capability_graph_list_catalog、capability_graph_get_capabilities、capability_graph_resolve、capability_graph_read_document。配置服务端 executor 且 enableMatch:true 才增加 capability_graph_match。普通已有模型宿主默认不再调用第二个模型。

推荐应用用 SDK；普通 Codex 用户用便捷登记；已有 Agent/MCP 服务嵌入工具；共享/远程宿主用 HTTPS；Plugin 供需要整体分发的宿主使用。状态和限制见[兼容页](/resources/compatibility)。
