# 产品与接入路线

Capability Graph 是静态 JSON 声明驱动的能力图谱引擎。Provider 作者描述已有能力，Graph 校验定义、授权、适用条件与关系，应用或宿主决定如何使用。它不执行能力或依赖。

| 你的场景 | 最短路径 | 模型来源 |
| --- | --- | --- |
| 程序知道能力 ID | JSON → open → Catalog/Detail/Resolve | 无需模型 |
| 已有 Codex 等宿主 | MCP → Catalog → 选择 ID → Resolve | 宿主当前模型 |
| 程序需要自然语言匹配 | open({model}) → match | 显式 ModelExecutor |

[安装](/getting-started/installation)后运行[第一个图谱](/getting-started/quick-start)：只建声明和脚本两个文件，无需知识目录和模型。先用文件式完成第一次依赖解析；已有内存对象时可选同页的内联式，输出相同结构。

拿到结果后看[结果指南](/guide/results)，再按任务补充声明、条件或关联知识。已有 Agent/MCP 服务可[嵌入工具层](/integrations/existing-server)，全部方式见[接入清单](/integrations/overview)。

Provider 声明、用户请求、模型输出和知识正文都是待校验的数据。Graph 不自动探测项目事实，不做 RAG、Embedding、关键词 Matcher、数据库、Agent Runtime 或能力执行。

本手册对应 **v2.0.0**。运行环境、MCP 协议和各接入方式的条件见[版本与兼容](/resources/compatibility)。
