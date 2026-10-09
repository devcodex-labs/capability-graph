# HTTP Runtime 参考

该服务独立运行，注册表同时用于真实 HTTP 请求分派与能力实例采集。Core 不负责启动服务，Adapter 也不包含预设实例列表。

## HTTP 读取与文本检索

在仓库根运行 `npm run demo:http`，会构建并执行 `retrieval-demo.ts`：建立真实 HTTP 文档来源，从公开 Catalog 建立能力词项索引，显式选择能力，读取中文正文，核对 UTF-8 字节偏移的检索片段，再验证零命中、正文变更后的过期拒绝和显式重建恢复，最后实际调用 `POST /users` 得到 201。

`knowledge-reader.ts` 限制来源 origin、并发数、总时限和原始响应字节，拒绝重定向与压缩；超时及关闭都会销毁请求并等待连接关闭。`text-retrieval.ts` 是确定性的内存词项索引，使用有限缓存，按已选 targets 重查内容身份；零命中也需要有效证据。静态定义、正文或分块配置变更后，由接入方显式重建或调用 invalidate，Core 不自动刷新。

分块保留 UTF-8 BOM 和补充字符，偏移对应原始正文的字节。缓存按选择做 LRU 淘汰；即便正文和静态修订相同，切换知识根目录仍须失效旧映射。来源读取失败不会伪装成缓存成功，能力索引重建超容量也不会发布半个索引。这些边界分别由根 `test/http-retrieval.test.ts` 和 `test/text-retrieval.test.ts` 通过真实来源验收。

这条路径使用零次模型调用，证明本机 HTTP 和检索链路，不证明语义搜索质量或 Agent 任务成功率。临时 Provider 位于仓库同级 `capability-graph-artifacts`，结束后关闭 Reader、graph、HTTP 服务并清理自建目录。正式回归位于根 `test/http-retrieval.test.ts`。

## 运行

1. 在仓库运行 `npm test`，生成 `dist-test/examples/seed-runtime`。
2. 接入方从已部署 Provider 定义取得静态修订，在部署时固定它；不要在每次查询时把当前查询修订冒充部署修订。
3. 显式启动服务，传入部署参数。例如 PowerShell：

```powershell
node dist-test/examples/seed-runtime/main.js '{"project":"sample-app","environment":"local","staticRevision":"s:填写实际部署修订","buildId":"local-build-1","port":3107}'
```

端口被占用时启动失败，不接管现有服务。省略 `port` 使用系统空闲端口，启动输出显示实际 URL/PID。退出用 Ctrl+C。该本机参考不提供公网认证、远程集群聚合或后台刷新。

## 接入

在集成代码中使用 `HttpRuntimeAdapter`，传入完整 `http://127.0.0.1:<port>/__capabilities/runtime`，并将实例加入 `CapabilityGraph.open` 的 `runtimeAdapters`。Adapter 源码位于本例，未作为主包导出。

调用 `provider.queryRuntime({ project: "sample-app", environment: "local", instanceOf: { capabilityId: "route.http" } })`。它每次请求服务；成功结果只包含该进程实际注册的路由，包括可调用的 `POST /users` 与 `GET /users`。查看 `facts`、`sourceIdentity`、`runtimeRevision` 与 `observedAgainstStaticRevision`，不要把实例当作新增能力定义。

服务记录进程身份、构建身份、项目环境及部署静态修订。查询修订相同才标 `compatible`，不同标 `unknown`；实时采集为 `current`，不等于构建一定兼容。新增路由或重启改变 Runtime 修订，旧游标必须重新查询。项目/环境不匹配、来源不可达、超时、重定向、非 JSON 或响应超限均失败，不伪装成空实例。

## 验证

`test/real-runtime.test.ts` 启动独立子进程，实际请求业务路由并沿 API 完成目录、关系、实例和知识流程；随后核对项目/环境隔离、源变化、旧构建、失联/恢复及分页。进程 PID 与端口在测试诊断中输出，结束后验证进程不存在且监听端口可重新绑定。IPC 注册只供这个可控制参考应用演示动态注册，不暴露为 HTTP 管理入口。
