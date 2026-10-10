# HTTP Runtime 参考

该服务独立运行，注册表同时用于真实 HTTP 请求分派与能力实例采集。Core 不负责启动服务，Adapter 也不包含预设实例列表。

## HTTP 读取与文本检索

在仓库根运行 `npm run demo:http`，会构建并执行 `retrieval-demo.ts`：建立真实 HTTP 文档来源，从公开 Catalog 建立能力词项索引，显式选择能力，读取中文正文，核对 UTF-8 字节偏移的检索片段，再验证零命中、正文变更后的过期拒绝和显式重建恢复，最后实际调用 `POST /users` 得到 201。

`knowledge-reader.ts` 显式限制来源 origin、并发数及完整传输时限，拒绝重定向、压缩、HTML 和非预期的部分响应。`stream` 按块读取完整正文，文档总大小不设准入上限；旧 `read` 接口完整返回正文，仍受调用方 `maxBytes` 单次返回预算约束。超时、取消及关闭会终止真实请求。

来源经代理访问时，宿主通过 `agentForUrl` 注入兼容 Node 20/22/24 的 Agent，例如根开发依赖中的 `proxy-agent`。Agent 由宿主管理和关闭，Reader 不接管它的生命周期；代理凭据不进入报告。

可选 `snapshot` 由宿主指定仓库外绝对目录，并配置 `maxBytes`、`maxEntries`、`ttlMs`。只有完整读取且带强 ETag 的正文才写入快照；后续条件 GET 返回 304 时仍核对本地完整正文的字节数和 SHA-256。弱/无验证器或正文超过磁盘快照预算时继续完整流式读取；快照预算控制缓存保留，不限制可读取文档大小。

正文续页支持 `isContentCurrent`：条件 HEAD 的 304 核验已绑定的强 ETag。Core 复用已完整哈希的私有副本，正文与证明共用每实例最多 4 MiB、16 条。启用磁盘快照时还提供 `readRange`，较大正文只读取所需的证明块，由 Core 用首次扫描留下的 SHA-256 独立核对原始字节；不要求来源支持 HTTP Range。缺失快照回退完整读取，损坏快照明确失败；不支持 HEAD、弱验证器、过期或超磁盘预算时重新完整核验。Reader 的 `close()` 等待在途范围读取和租用结束，只清理自己创建的快照子目录。

`text-retrieval.ts` 是确定性的词项索引。`TextKnowledgeRetriever` 通过 `scan` 消费大正文，查询时保留有界 Top-K；完整索引仅在 `maxCachedBytes`、`maxCachedEntries` 及选择数预算内缓存，超过预算时继续流式检索。`configure({ pageBytes })` 控制扫描块大小，`maxDocumentBytes` 是兼容旧名称，两者都不表示全文准入上限；只提供 `read` 的旧 access 使用有界全文回退。Core 正文分页接口只保留所选范围，并计算全文哈希；模型决定是否继续读取。

分块保留 UTF-8 BOM 和补充字符，偏移对应原始正文的字节。缓存按选择做 LRU 淘汰；即便正文和静态修订相同，切换知识根目录仍须失效旧映射。每次检索固定读取预算、分块和停用词配置；invalidate 按 Provider 标记在途请求，旧请求可以完成原来的快照，但不能在失效后回填旧缓存或覆盖新缓存。无关 Provider 的失效保持隔离，查询结束时释放在途标记。来源读取失败不会伪装成缓存成功，能力索引重建超容量也不会发布半个索引。这些边界分别由根 `test/http-retrieval.test.ts` 和 `test/text-retrieval.test.ts` 通过真实来源验收。

流式分块增量统计 UTF-8 字节，避免短行密集时反复统计整个剩余字符串。空行、纯标点或停用词过滤后没有词项的块仍推进原始字节偏移，但不占用索引缓存条目；缓存预算不足时仍完成全文扫描和 Top-K 检索。

构建 Core 和测试源码后，可运行 `node scripts/validation/knowledge-profile.mjs` 测量受控 HTTP 来源。基准分别覆盖可缓存、短行密集和容量溢出场景，每个场景使用独立检索器及固定选择，记录实际 `cachedSelections`、`cachedEntries`、`cachedBytes`，分别汇总冷查询、索引缓存命中、未命中和零命中。索引命中仍会核验实际来源，不表示免除 HTTP 读取；无样本的耗时字段为 null，缓存字节计账也不等于堆内存峰值。

`node --expose-gc scripts/validation/knowledge-page-profile.mjs` 验证 5 MiB 合成来源的 160 页、6 个并发范围查询及无强证明的完整扫描回退。各场景使用独立子进程，分别记录完整扫描字节、范围读取字节、HTTP 请求，以及分页和并发阶段的采样内存峰值。可用 `--baseline-core /absolute/dist/index.js` 对照已验证的旧 Core。采样峰值包含来源服务和测试消费者，不等于缓存保留量；耗时用于观察趋势，不作为共享环境的硬性通过阈值。

检索按已选 targets 重查内容身份，零命中也需要有效证据。静态定义、正文或分块配置变更后，由接入方显式重建或调用 invalidate，Core 不自动刷新。这条路径使用零次模型调用，证明本机 HTTP 和检索链路，不证明语义搜索质量或 Agent 任务成功率。临时 Provider 位于仓库同级 `capability-graph-artifacts`，结束后关闭 Reader、graph、HTTP 服务并清理自建目录。正式回归位于根 `test/http-retrieval.test.ts` 和 `test/text-retrieval.test.ts`。

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

`test/http-retrieval.test.ts` 核对强 ETag 快照复用、304 正文复核、快照篡改、弱验证器及超缓存预算回退、无 Range 来源、完整传输期限和 AbortSignal 取消。`test/text-retrieval.test.ts` 核对超缓存预算时的流式 Top-K 排名、原始字节偏移和全文哈希，确认大文档不会因缓存容量不足被拒绝。
