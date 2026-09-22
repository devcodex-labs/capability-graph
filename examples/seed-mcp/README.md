# Provider 自有 MCP 示例

本例是独立私有包，不属于 Core 的发布入口。12 个查询工具复用同一 `CapabilityGraph`，不为每项能力单独注册工具。Provider 自己通过 `seed://provider/specification` 资源提供规范正文；Core 关联 Specification Document 元数据并支持显式读取，但不负责 MCP Resource 投递。

## 运行

1. 在仓库根目录运行 `npm ci` 和 `npm test`，同时生成真实 HTTP 参考的集成测试产物。
2. 在本目录运行 `npm ci`、`npm test`。
3. MCP 客户端启动命令为 `node`，参数使用本目录下 `dist/src/main.js` 的绝对路径，通信方式为 stdio。

构建会先清理本包 `dist`，再编译源码与测试，避免已删除模块残留；输出目录为符号链接或普通文件时明确失败，不跟随链接删除外部内容。共享清理脚本位于仓库根 `scripts/`，本示例应在完整源码仓库内构建。

调用方先列 Provider/目录，按任务选择能力，再调用 `example_resolve_selection` 取得 `requires` 闭包，获取详情、关系与所选知识。`example_list_knowledge_members` 和 `example_list_specification_documents` 只返回有界元数据；正文由 `example_read_documents` 或 `example_read_specification` 按需读取。Runtime、能力召回、知识检索在默认配置下分别返回未启用或未配置，不伪造空成功结果。查询级失败以 `isError: true` 返回 Core 的稳定错误码；批量中的单项失败仍保留原位置。

接入真实 Runtime 时，在 Provider 启动代码中为 `CapabilityGraph.open` 显式配置 [HTTP 参考 Adapter](../seed-runtime/README.md)，再传给 `createSeedServer(graph, providerRoot)`。测试覆盖此组合及错误透传；默认 stdio 入口不自动寻找或启动业务服务。

固定使用 SDK 1.30.0 和 zod 3.25.76。已核对 [官方 v1 服务端文档](https://ts.sdk.modelcontextprotocol.io/server) 的高层注册和 stdio 接口，以及 [客户端文档](https://ts.sdk.modelcontextprotocol.io/client) 的工具调用与进程传输；不混用 v2 拆包接口。MCP SDK 依赖及锁文件只位于本示例；主包的运行时依赖仅用于 BCP 47 语言标签校验。
