# 测试与验证入口

在根目录执行 `npm ci`、`npm test`。测试先从当前源码构建、验证独立 TypeScript 消费者，再清理并编译测试。材料使用真实文件 Provider；受控 Reader 只用于可重复的故障和并发注入，不能替代实际 HTTP 证据。

| 场景 | 持续维护的材料 | 入口 |
|---|---|---|
| 身份、Schema、四种关系及无环/端点检查 | identity/hash/file-validation/provider-layout | npm test |
| 目录过滤/预算/分页、详情、八类关系、必要上下文 | static-query/cursor/budgets/v101 | npm test |
| Provider 隔离、固定根、reload/current/previous、pin 与清理失败 | provider-isolation/source-binding/store-lifecycle/seed | npm test |
| 文档/Collection/规范、BOM/CRLF/UTF-8、路径边界、输入及 JSON 预算 | knowledge-read/source-integrity/read-budgets | npm test |
| 原文分页、稳定来源与分块证明、缓存容量/漂移 | document-pages/document-range-reader | npm test |
| 真实 HTTP 超时/取消/连接、强弱 ETag、快照与范围验证 | http-reader | npm test；npm run demo:http |
| 删除接口及旧配置明确失败 | core-scope、consumer/public-api.ts | npm test |
| 冷打包、陈旧输出清理、独立安装与公共类型边界 | build/package、scripts/test-package.mjs | npm run test:package |
| 官方主题、全部原始 Markdown/MDX、来源漂移/缺失与导出边界 | validation/vextjs-documentation | npm test；固定来源入口 |
| MCP 工具、Collection/规范、错误透传和实际 stdio 退出 | examples/seed-mcp/test/server.test.ts | 根测试后，在私有示例执行 npm ci --ignore-scripts 和 npm test |
| 公开教程/签名/数值/错误/链接/导航、浏览器与无障碍 | test/website、scripts/validation/website | website build、根 test:docs 与 test:site |
| 文件容量、完整目录、并发与重载 | validation/capacity | npm run evaluate:capacity |

VextJS 的真实入口见 [examples/vextjs](../examples/vextjs/README.md)。全新安装消费者验证目录、node_modules 和 HTTPS 文档，使用实际安装的 Core；不再包含数据库驱动、检索或 Runtime 合同及完整框架业务执行门禁。

所有测试动态来源、消费者、tarball、快照、日志、报告和浏览器输出放在仓库外的专用目录。CG_ARTIFACTS_DIR 必须不包含或位于源码目录中；各测试只清理本次拥有的目录。

CI 保留 Linux/Windows、Node 20.19.0/22.12.0/24.19.0 和 Chromium、Firefox/WebKit 的适用矩阵。声明矩阵不等于本机已执行远端平台；实际证据以具体运行日志为准。
