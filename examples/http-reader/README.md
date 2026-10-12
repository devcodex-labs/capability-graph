# HTTP 文档读取示例

运行 `npm run demo:http`，从真实本地 HTTP 服务分页读取关联文档，并核对完整 UTF-8 原字节。示例不会启动能力执行服务。

`knowledge-reader.ts` 是宿主可参考的 Reader 实现，不是主包导出。URL 来源必须配置明确的允许 origin。它支持超时、并发限制、流式取消，以及可选的强 ETag 磁盘快照和已验证范围读取；弱 ETag、无验证器、超出缓存预算时回退到完整扫描，文档仍可分页读取。

可选 `snapshot.directory` 必须由宿主提供绝对路径并放在源码仓库之外。宿主负责关闭 Reader 和自己创建的 Agent；关闭图谱不会代替关闭这些资源。HTTP 错误、正文变化及无效 Range/验证器都显式失败。
