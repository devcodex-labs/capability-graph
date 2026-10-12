# Provider 自有 MCP 示例

本例是SDKv1私有宿主，通过主包`/mcp`复用12个共享查询工具，使用example_前缀，不为每项能力单独注册工具。Provider通过seed://provider/specification资源提供自己的规范正文。共享工具支持普通JSON与SDKv1/v2，资源和主入口策略仍由宿主决定。

## 目录导航

- [运行](#运行)
- [共享工具与参数](#共享工具与参数)

## 运行

1. 在仓库根目录运行 `npm ci` 和 `npm test`，同时生成真实 HTTP 参考的集成测试产物。
2. 在本目录运行 `npm ci`、`npm test`。
3. MCP 客户端启动命令为 `node`，参数使用本目录下 `dist/src/main.js` 的绝对路径，通信方式为 stdio。

构建会先清理本包 `dist`，再编译源码与测试，避免已删除模块残留；输出目录为符号链接或普通文件时明确失败，不跟随链接删除外部内容。共享清理脚本位于仓库根 `scripts/`，本示例应在完整源码仓库内构建。

调用方先列 Provider/目录，按任务选择能力，再调用 `example_resolve_selection` 取得 `requires` 闭包，获取详情、关系与所选知识。`example_list_knowledge_members` 和 `example_list_specification_documents` 只返回有界元数据；正文由 `example_read_documents` 或 `example_read_specification` 按需读取。查询级失败以 `isError: true` 返回 Core 的稳定错误码；批量中的单项失败仍保留原位置。


## 共享工具与参数

固定SDK1.30.0，低层Server合并tools/list和tools/call；查询失败为isError=true、text与structuredContent中的{error:{code,message,nextAction}}，部分槽位失败保留Core原结果。定义、输入和范围来自同一toolkit，名称以example_开头。邻居/文档/Selection都用{providerId,capabilityId}完整身份。

主包正式独立服务采用固定SDKv2，当前私有进程使用v1；工具公共类型不依赖SDK或Zod。完整SDKv1/v2及普通JSON用法见[接入教程](https://devcodex-labs.github.io/capability-graph/integrations/mcp-and-cli)。
