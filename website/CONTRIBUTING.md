# 用户文档写作与验证

文档服务于接入者完成任务。沿用顶部 `v1`/`GitHub`、全局分区侧栏默认展开和现有路由；新增独立页面必须有独立用户任务，不为每个字段拆页。

## 内容要求

- Getting Started 说明目标、前置条件、创建文件、字段含义、执行命令、预期结果、常见错误和下一步；主路径至少有一份可从空项目执行的完整代码。
- Guide 解释适用场景、关键取舍与验证方式。配置片段明确合并位置，保留必填字段；代码依赖外部变量时写明来源，不标成独立可运行。
- Integration 区分 Core 和实现方职责，解释输入/输出、预算、失败语义、资源所有权及最小实现边界。骨架通过公开类型编译，不将依赖注入的合同示例宣称为真实后端。
- Example 包含场景、源码布局、运行目录/命令、关键调用和预期输出，说明证明范围。源码链接补充正文，不替代正文。
- Reference 保持精炼，准确列出必填/可选、默认值和限制，与公开声明和可执行用例核对，不复制整套教程。

## 真实性

完整脚本、配置片段、接口节选和概念设计必须明确区分。`Runnable` 需要自动执行路径；类型检查只能证明骨架合同。不得把 Flat Catalog 说成自动只返回主能力，也不得把有界详情说成无裁剪全量定义。

使用相同的 Acme 概念示例串联教程；Seed 是仓库真实执行来源，两个 Provider ID 不混用。公开文档按当前正式产品接口说明安装和使用，不夹带发布准备、凭据或内部验证状态；实际 npm/Pages 可用性记录在交付报告，不能凭本地 manifest 宣称已经完成发布。

## 验证

在 `website/` 执行 `npm run build`：生成公开合同、核对内容/字段、执行教程，再构建站点。`check:examples` 会核对文档 JSON/Markdown 与 Fixture，直接提取并运行 `discover.mjs`、比对页面预期输出，编译列入校验清单的 Guide/API/Adapter 片段，并执行主入口投影和 Reader 内容身份合同。

维护 First Provider Fixture 时，在仓库根先构建主包，再执行：

```sh
npm run build
node website/fixtures/first-provider/discover.mjs
cd website
npm run check:examples
```

这些命令属于源码贡献者验证，不应放回公开教程的 npm 使用主路径。

新增被称为可运行的代码时，将其加入 `scripts/check-doc-code.mjs` 或真实示例测试；不要只增一个状态标签。生成与验证临时文件必须清理。Seed 的真实性另由根 `npm test` 和 `examples/seed-mcp` 的 `npm test` 验证。

运行 `npm run check:build`、`npm run build:ai` 和 `npm run test:site` 核对正式页面/跳转、AI 输出、导航、搜索、响应式和可访问性。浏览器预览由 Playwright 管理，结束后确认监听端口释放。自动检查不替代人工阅读，尤其不以字数、段落数量或固定标题证明教学质量。
