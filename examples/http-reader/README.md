# HTTP 文档读取示例

运行 `npm run demo:http`，从真实本地 HTTP 服务分页读取关联文档，并核对完整 UTF-8 原字节。示例不会启动能力执行服务。

`knowledge-reader.ts`消费主包`/readers/http`导出的同一实现。URL来源必须配置明确Origin。它支持超时、并发限制、四正文接口取消，以及可选强ETag磁盘快照与已验证范围读取；弱ETag、无验证器或超缓存预算时回退完整扫描，文档仍可分页读取。

## 目录导航

- [运行与参数](#运行与参数)

## 运行与参数

`allowedOrigins`必填且非空，要求精确http/https原点；timeoutMs默认2000毫秒，maxConcurrent默认4。snapshot可省略；启用时maxBytes默认16777216、maxEntries默认8、ttlMs默认300000。完整解释与独立消费代码见[接入教程](https://devcodex-labs.github.io/capability-graph/integrations/mcp-and-cli#6-http-reader)。

可选 `snapshot.directory` 必须由宿主提供绝对路径并放在源码仓库之外。宿主负责关闭 Reader 和自己创建的 Agent；关闭图谱不会代替关闭这些资源。HTTP 错误、正文变化及无效 Range/验证器都显式失败。
