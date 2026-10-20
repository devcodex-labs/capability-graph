# 产品与接入路线

Capability Graph 是静态 JSON 声明驱动的能力图谱引擎。Provider 作者描述已有能力，Graph 校验定义、授权、适用条件与关系，应用或宿主决定如何使用。它不执行能力或依赖。

| 你的场景 | 最短路径 | 模型来源 |
| --- | --- | --- |
| 程序知道能力 ID | JSON → open → Catalog/Detail/Resolve | 无需模型 |
| 已有 Codex 等宿主 | MCP → Catalog → 选择 ID → Resolve | 宿主当前模型 |
| 程序需要自然语言匹配 | open({model}) → match | 显式 ModelExecutor |

[安装](/getting-started/installation)后运行[第一个图谱](/getting-started/quick-start)：只建声明和脚本两个文件，无需知识目录和模型。先用文件式完成第一次依赖解析；已有内存对象时可选同页的内联式，输出相同结构。

拿到结果后看[结果指南](/guide/results)，再按任务补充声明、条件或关联知识。已有 Agent/MCP 服务可[嵌入工具层](/integrations/existing-server)，全部方式见下方接入清单。

Provider 声明、用户请求、模型输出和知识正文都是待校验的数据。Graph 不自动探测项目事实，不做 RAG、Embedding、关键词 Matcher、数据库、Agent Runtime 或能力执行。

本手册对应 **v2.0.0**。运行环境、MCP 协议和各接入方式的条件见[版本与兼容](/resources/compatibility)。

## 完整接入清单

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

## 读这些术语时先看任务

| 术语 | 白话含义 | 何时看 |
| --- | --- | --- |
| Provider | 框架、SDK或项目的能力声明来源 | 接入或维护声明 |
| Catalog | 给选择者看的精简能力目录 | 选真实ID，尚未读取长说明 |
| Detail | 能力的完整说明、关系及文档引用 | 看usage和使用前提 |
| Subgraph / ResolveResult | 选中根及展开关系的结果 | 看依赖为何出现、哪些目标不可用 |
| Context | 调用方提供的平面事实与备注 | 判断条件，不授予权限 |
| Revision | 授权静态图谱视图的标识 | 比较跨请求是否同一声明 |

推荐路径：[安装](/getting-started/installation)→[最小运行](/getting-started/quick-start)→[结果](/guide/results)→[编写Provider](/guide/providers)，再选择本页路线。API与配置用于查表，维护者内容后置。
