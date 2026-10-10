# 场景验收入口

本目录保存可持续执行的回归测试与固定材料。产物隔离及清理规则统一见[贡献指南](../CONTRIBUTING.md#源码与目录约定)。Core 文件测试使用 `contract/temporary-directory.ts`，通过通用 `scripts/lib/artifact-paths.mjs` 分配仓库外目录。独立私有 MCP 示例包的测试位于 `examples/seed-mcp/test/`，由其自身构建和测试命令管理。

根 `npm test` 先构建公开包、验证类型并编译测试；下表中的 `dist-test` 命令在该构建完成后使用。测试验证具体输入、结果与失败语义，不能用测试数量推导场景覆盖率。

| 场景与验收行为 | 可执行断言 | 命令 | 证明层级 |
|---|---|---|---|
| 文件定义、Provider 身份、关系端点和环检查 | `file-validation.test.ts`、`identity.test.ts`、`static-query.test.ts` | `npm test` | Core 合同及真实文件 I/O |
| directory/legacy 布局、迁移修订一致、混用与文件冲突；目录与 scoped/pnpm 包知识根、Unicode/空格及越界拒绝 | `provider-layout.test.ts` | `npm test` | Core 合同及真实文件 I/O |
| 分页连续性、游标参数/修订失配、UTF-8 元数据预算 | `cursor.test.ts`、`budgets.test.ts`、`v101.test.ts` | `npm test` | Core 合同 |
| 显式选择及 requires 闭包、跨 Provider 隔离 | `seed.test.ts`、`provider-isolation.test.ts`、`v101.test.ts` | `npm test` | Core 合同与 Seed 流程 |
| 精确文档/规范读取、Collection 成员发现、混合错误槽位 | `knowledge-read.test.ts`、`v101.test.ts` | `npm test` | Core 合同及真实文件 I/O |
| 大文档、长代码块、中文/emoji/BOM 分页拼接、来源漂移、无 Range HTTP 及实际取消 | `document-pages.test.ts` | `npm test` | 真实文件与本机 HTTP |
| 原始输入先限量、完整 JSON 响应边界、旧预算配置兼容 | `read-budgets.test.ts`、`budgets.test.ts`、`consumer/public-api.ts` | `npm test` | 公共 API 与类型合同 |
| 召回排名间隙、范围与身份拒绝、知识映射/配置/内容证据 | `retrieval.test.ts`、`review-retrieval.test.ts` | `npm test` | Core 合同，使用受控后端 |
| 外部索引未使用 access 时仍核验实际来源；Document/Specification 全文与分页 BOM/CRLF/MIME 一致；数据库目录与八类关系漏项拒绝；Runtime 私有诊断过滤 | `source-integrity.test.ts` | `npm test` | Core 合同与真实来源，数据库/Runtime 使用受控实现 |
| 稳定数据库视图、查询 pin、reload/previous、退休与失败清理 | `store-lifecycle.test.ts`、`source-binding.test.ts` | `npm test` | 数据库 Adapter 合同，使用假实现 |
| 实际路由实例、项目/环境隔离、失联恢复及端口释放 | `real-runtime.test.ts`、`contract/http-service-process.ts` | `node --test dist-test/test/real-runtime.test.js` | 独立 Node.js HTTP 进程 |
| 实际 HTTP 正文、中文分块、零命中证据、旧索引拒绝、重建恢复、201 业务请求 | `http-retrieval.test.ts` | `npm run demo:http`；`node --test dist-test/test/http-retrieval.test.js` | 真实本机 HTTP 与有限词项索引，零模型调用 |
| BOM/补充字符的原始字节偏移、LRU 淘汰、来源映射变化、失效与旧请求回填竞争、在途配置快照、读失败恢复及重建原子性 | `http-retrieval.test.ts`、`text-retrieval.test.ts` | `npm test` | 真实本机 HTTP 与文件来源 |
| 强 ETag 完整快照复核、弱验证器/超缓存预算流式回退、快照篡改与租约；有界索引缓存与超额流式 Top-K | `http-retrieval.test.ts`、`text-retrieval.test.ts` | `npm test` | 真实本机 HTTP 与文件来源，不限制全文总大小 |
| 高扇入反向关系排序、源数组不变；完整全局分页、每个 Provider 的多轮 reload/previous 退休与 pin、混合负载及失败清理 | `memory-graph-store.test.ts`、`validation/capacity.test.mjs` | `npm test`；`npm run evaluate:capacity -- --nodes 100000 --providers 2 --concurrency 100 --operations 3000 --duration-ms 120000 --reload-every 1000 --reload-rounds 2` | 索引回归及真实文件负载；正确性与负载分阶段，规模运行不在默认 CI 中，报告保存在仓库外 |
| Core 临时目录覆盖配置、归属清理与替换 junction 拒绝 | `validation/temporary-directory.test.mjs` | `npm test` | 文件系统保护合同 |
| MCP Collection 分页/点读、召回/知识成功及失败透传、stdio 子进程退出 | `examples/seed-mcp/test/server.test.ts`、`examples/seed-mcp/test/retrieval.test.ts` | 根测试后，在 `examples/seed-mcp` 执行 `npm ci --ignore-scripts`、`npm test` | 实际 MCP 协议，受控检索后端 |
| 页面还原、教程负例、发布/防回退规则、手动恢复标签快照与外部产物清理保护 | `website/unit/` | `npm run test:docs` | 文档消费者与发布规则；不代表已经部署 |
| 导航、搜索、键盘、移动视口及页面元数据 | `website/browser/` | `npm --prefix website run build` 后执行 `npm run test:site`；`npm run test:site:cross` | Chromium 完整回归，Firefox/WebKit 代表性冒烟 |
| 本地源码标准打包、预构建一致性、独立 tarball 安装/类型、未泄露私有材料 | `scripts/test-package.mjs` | `npm run test:package` | 本地构建包的实装消费者，不证明 Registry 已发布 |
| 原生角色、稳定导出、未知运行证据及游标漂移；独立任务遗漏、零命中与无依据推荐拒绝 | `validation/vextjs-adapter.test.mjs`、`validation/retrieval-gates.test.mjs` | `npm test` | 接入合同与受控检索门槛，不代表真实框架运行 |
| 显式复用构建时拒绝旧源、输出改动和孤儿文件 | `validation/build-state.test.mjs` | `npm test` | 构建指纹合同 |

`scripts/validation/website/check-registry-install.mjs` 在匹配发布版本与部署身份的工作流中独立安装 Registry 包；它与 `test:package` 的本地构建包验证是不同证据。

真实 VextJS MCP、TCP Session 及 VextJS/MonSQLize 多 Provider 来源矩阵的命令、前置条件和来源身份见 [examples/vextjs/README.md](../examples/vextjs/README.md)。`scripts/validation/provider-sources.mjs` 使用固定源码目录、实际安装包及可选公开 HTTPS，执行分页、正文与片段证据、跨 Provider 隔离和 reload 验证；独立任务材料位于 `fixtures/vextjs/`。这些入口需要外部固定来源，不属于默认 `npm test`。

`scripts/validation/vextjs-consumer.mjs` 是可选的全新实装消费者验收，需要 Linux/Docker、已构建并核验的 Vext 固定源码及 `mongo:8.0` 镜像。它标准打包并实际安装当前 Core，使用消费者自己的公开入口重跑来源矩阵和原生 MCP，再验证真实路由/schema、插件、数据库分页、Session/CSRF、停库/重启、来源漂移、取消与关闭。持续维护的 verifier 在 `scripts/validation/lib/vextjs-consumer-checks.mjs`；生成的应用、Provider、tarball、日志及报告全部位于仓库外，完成后自建容器及卷释放。业务应用为集成作者编写，知识正文保留可核验原始出处；零模型调用，不证明 Agent 成功率。运行命令与证明边界见上述 README。

真实数据库驱动、模型/Agent 任务、生产容量和长期负载需要对应项目及运行条件；默认回归不能证明这些交付。VextJS 的真实验证需外部固定来源与服务，独立记录执行证据。屏幕阅读器和真实用户走读也需要独立执行证据。CI 声明 Windows/Linux 与 Node 20.19.0、22.12.0、24.19.0，实际通过情况以具体运行记录为准。
