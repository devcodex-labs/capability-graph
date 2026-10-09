# 场景验收入口

本目录保存可持续执行的回归测试与固定材料。临时消费者、日志、截图及一次性诊断统一位于仓库同级 `capability-graph-artifacts`，测试只清理自己创建的目录。不要把本机报告或生成结果作为新的测试源码提交。

根 `npm test` 先构建公开包、验证类型并编译测试；下表中的 `dist-test` 命令在该构建完成后使用。测试验证具体输入、结果与失败语义，不能用测试数量推导场景覆盖率。

| 场景与验收行为 | 可执行断言 | 命令 | 证明层级 |
|---|---|---|---|
| 文件定义、Provider 身份、关系端点和环检查 | `file-validation.test.ts`、`identity.test.ts`、`static-query.test.ts` | `npm test` | Core 合同及真实文件 I/O |
| 分页连续性、游标参数/修订失配、UTF-8 元数据预算 | `cursor.test.ts`、`budgets.test.ts`、`v101.test.ts` | `npm test` | Core 合同 |
| 显式选择及 requires 闭包、跨 Provider 隔离 | `seed.test.ts`、`provider-isolation.test.ts`、`v101.test.ts` | `npm test` | Core 合同与 Seed 流程 |
| 精确文档/规范读取、Collection 成员发现、混合错误槽位 | `knowledge-read.test.ts`、`v101.test.ts` | `npm test` | Core 合同及真实文件 I/O |
| 原始输入先限量、完整 JSON 响应边界、旧预算配置兼容 | `read-budgets.test.ts`、`budgets.test.ts`、`consumer/public-api.ts` | `npm test` | 公共 API 与类型合同 |
| 召回排名间隙、范围与身份拒绝、知识映射/配置/内容证据 | `retrieval.test.ts`、`review-retrieval.test.ts` | `npm test` | Core 合同，使用受控后端 |
| 稳定数据库视图、查询 pin、reload/previous、退休与失败清理 | `store-lifecycle.test.ts`、`source-binding.test.ts` | `npm test` | 数据库 Adapter 合同，使用假实现 |
| 实际路由实例、项目/环境隔离、失联恢复及端口释放 | `real-runtime.test.ts`、`contract/http-service-process.ts` | `node --test dist-test/test/real-runtime.test.js` | 独立 Node.js HTTP 进程 |
| 实际 HTTP 正文、中文分块、零命中证据、旧索引拒绝、重建恢复、201 业务请求 | `http-retrieval.test.ts` | `npm run demo:http`；`node --test dist-test/test/http-retrieval.test.js` | 真实本机 HTTP 与有限词项索引，零模型调用 |
| BOM/补充字符的原始字节偏移、LRU 淘汰、相同修订下来源映射变化、读失败恢复及重建原子性 | `http-retrieval.test.ts`、`text-retrieval.test.ts` | `npm test` | 真实本机 HTTP 与文件来源 |
| 高扇入反向关系的完整排序、源数组不变；多 Provider 混合查询、改版 reload、previous 与关闭时 pin | `memory-graph-store.test.ts`、`validation/capacity.test.mjs` | `npm test`；`npm run evaluate:capacity -- --nodes 100000 --providers 2 --concurrency 100 --operations 3000 --duration-ms 120000 --reload-every 1000` | 索引回归及可复用真实文件负载；规模运行不在默认 CI 中，报告保存在仓库外 |
| MCP Collection 分页/点读、召回/知识成功及失败透传、stdio 子进程退出 | `examples/seed-mcp/test/server.test.ts`、`retrieval.test.ts` | 根测试后，在 `examples/seed-mcp` 执行 `npm ci --ignore-scripts`、`npm test` | 实际 MCP 协议，受控检索后端 |
| 页面还原、教程负例、发布/防回退规则、外部产物清理保护 | `website/unit/` | `npm run test:docs` | 文档消费者与发布规则；不代表已经部署 |
| 导航、搜索、键盘、移动视口及页面元数据 | `website/browser/` | `npm --prefix website run build` 后执行 `npm run test:site`；`npm run test:site:cross` | Chromium 完整回归，Firefox/WebKit 代表性冒烟 |
| 实际公开 tarball、独立安装/类型、未泄露私有材料 | `scripts/test-package.mjs` | `npm run test:package` | 实装消费者，执行完清理 |

真实数据库驱动、VextJS 接入、模型/Agent 任务、生产容量和长期负载需要对应项目及运行条件；当前测试不能证明这些交付。屏幕阅读器和真实用户走读也需要独立执行证据。CI 声明 Windows/Linux 与 Node 20.19.0、22.12.0、24.19.0，实际通过情况以具体运行记录为准。
