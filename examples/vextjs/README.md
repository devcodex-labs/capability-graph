# VextJS 原生知识与运行证据接入

本例复用固定安装快照的原生 MCP schema 2，内核没有 VextJS 依赖。`native-provider.mjs` 从原生 resources/knowledge 工具回读正文，生成稳定的 `native.c03` 等能力 ID；原生 ID、kind、status、目录 digest、来源身份保存在真实知识文档中。`vext://` 保留为来源引用，生成的读取 locator 是实际相对文件。

capability、rule、recipe、knowledge、workflow 分别作为原生角色保留；它们是可发现知识，不意味着 Core 可执行 Recipe。`relatedIds` 只映射可选上下文，不自动推导 `requires`。源更新应重新导出并 reload，按 Provider invalidate/rebuild 检索索引。导出必须写入新的仓库外目录，同来源导出内容稳定。

原生 MCP 没有分页枚举全部 knowledge 的资源。验证入口从固定安装快照的 `dist/assistant/catalog.js` 读取发现材料，随后通过原生 MCP 回读全部条目并核对目录 digest/身份/正文。这是特定 schema 2 的接入边界，不能假定任意未来版本都支持。接入方也可以提供经过固定来源核验的目录 JSON。

先在根目录运行 `npm test`。真实验证要求已安装且固定的 VextJS 快照，以及该快照可检查的实际项目；占位路径须替换为外部目录：

```bash
node scripts/validation/vextjs.mjs /external/fixed-vextjs /external/project SOURCE_ID
node scripts/validation/vextjs-session.mjs /external/fixed-vextjs
node scripts/validation/vextjs-service-lifecycle.mjs /external/fixed-vextjs redis://127.0.0.1:OWNED_PORT mongodb://127.0.0.1:OWNED_PORT
```

`SOURCE_ID` 用提交 SHA 或 npm integrity 标识真实来源，不能仅用 package.version。入口在根 scripts/；固定检索任务在根 test/fixtures/vextjs/；临时 Provider/应用自动写在仓库同级专用目录并清理。JSON 报告由调用者重定向至仓库外。

`VextNativeRuntimeAdapter` 连接 project identity 与启动快照：停止的实例仍保留 `state=stopped`、`liveness=unverified`、`availability=partial`。没有可信部署来源时 compatibility 为 unknown；不会复制查询 revision 冒充部署证据。原生快照无法证明公开 HTTP、Job 执行或隐藏路由的完整运行图；这些需独立证据。超过原生枚举窗口时拒绝声称完整。

独立检索基线对比原生 MCP 与 CG 词法召回，核对片段字节，报告召回、遗漏、响应量与 P50/P95，模型调用为零。中文单字匹配容易产生假阳性，否定与同义词需要更大独立任务集评估；当前结果不代表 Agent 成功率。

已单独核验 npm `vextjs@2.0.0`：其 CLI 不包含 `mcp`，因此不能使用原生 schema 2 Provider/Runtime 接入；该发布包的实际 TCP Session/CSRF 场景可另行验证。此原生接入当前适用于固定 main 快照 `ef926649926e17543562b8169982fa1786285ecf`，不把同版本号的发布包视为等价来源。

并行运行不同 Node 版本的上游 dev/cluster 验证时，每个矩阵单元须使用独立的仓库外 `TMPDIR`。VextJS 的进程 owner 注册目录依赖系统临时目录；共享目录会导致验证之间的 owner 冲突。框架构建也须串行或使用独立安装副本。

`.github/workflows/vextjs-ci.yml` 固定源码提交，在 Linux/Windows、Node 20/22/24 上验证原生目录、检索和实际 TCP Session。框架下载、构建、临时应用及报告均在仓库外。Redis/MongoDB、cluster 和浏览器的扩展验证单独记录，不归为这个兼容矩阵的覆盖内容。

`node scripts/validation/knowledge-profile.mjs` 可测量实际 HTTP 单篇/多篇正文的冷启动、缓存复核、零命中场景，比较 read-only 与 streaming Reader 的调用、传输量和延迟。该合成工作负载用于比较传输成本，不替代上面的独立检索任务集；每次完整 hash 复核仍可能需要读取整篇正文。
