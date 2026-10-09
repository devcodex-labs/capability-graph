# 用户文档写作与验证

文档服务于接入者完成任务。沿用顶部 `v1`/`GitHub`、全局分区侧栏默认展开和现有路由；新增独立页面必须有独立用户任务，不为每个字段拆页。

## 内容要求

- Getting Started 从空 npm 项目只创建最小 Provider 和一个能力，完成 Catalog；关系、Knowledge、requires/Selection、Specification 在唯一进阶页按G1-G4添加。每检查点完整脚本独立open/close，G3/G4能仅从G0开始，不隐藏高级Fixture输入。
- Guide 解释适用场景、关键取舍与验证方式。配置片段明确合并位置，保留必填字段；代码依赖外部变量时写明来源，不标成独立可运行。
- Integration 区分 Core 和实现方职责，解释输入/输出、预算、失败语义、资源所有权及最小实现边界。骨架通过公开类型编译，不将依赖注入的合同示例宣称为真实后端。
- Example 包含场景、源码布局、运行目录/命令、关键调用和预期输出，说明证明范围。源码链接补充正文，不替代正文。
- Reference 保持精炼，准确列出必填/可选、默认值和限制，与公开声明和可执行用例核对，不复制整套教程。

## 真实性

完整脚本、配置片段、接口节选和概念设计必须明确区分。`Runnable` 需要自动执行路径；类型检查只能证明骨架合同。不得把 Flat Catalog 说成自动只返回主能力，也不得把有界详情说成无裁剪全量定义。

使用相同的 Acme 概念示例串联教程；Seed 是仓库真实执行来源，两个 Provider ID 不混用。公开文档按当前正式产品接口说明安装和使用，不夹带发布准备、凭据或内部验证状态；实际 npm/Pages 可用性记录在交付报告，不能凭本地 manifest 宣称已经完成发布。

## 验证

在 website 执行 npm run build。scripts/lib/tutorial.mjs 是本地、Registry及MCP测试共用的页面还原器，只接受固定检查点/文件白名单。页面是输入真相源，Fixture只对照，不能复制Fixture补文件。check:examples运行helper负例、G0-G4及独立G4四例、页面输出，保留高级Fixture Specification/Reader/API和类型片段回归。安装验证需使用仓库外消费者和独立冻结的期望版本，不以实际读取的版本自证。

维护 First Provider Fixture 时，在仓库根先构建主包，再执行：

```sh
npm run build
node website/fixtures/first-provider/discover.mjs
cd website
npm run check:examples
```

这些命令属于源码贡献者验证，不应放回公开教程的 npm 使用主路径。

新增被称为可运行的代码时，将其加入 `scripts/check-doc-code.mjs` 或真实示例测试；不要只增一个状态标签。生成与验证临时文件必须清理。Seed 的真实性另由根 `npm test` 和 `examples/seed-mcp` 的 `npm test` 验证。

最终验收顺序是 build → build:ai → check:build → test:site → check:build/check:package，记录最终doc_build全部文件SHA；浏览器预览不得隐式重建。之后若页面/配置/生成输入或输出变化，必须重建并重验同一制品。Playwright管理自己的preview，结束确认端口释放，不复用或杀用户服务。自动检查不替代独立用户走读，未取得真实走读证据时仍UNVERIFIED。

MCP完整Server/Client由公开页面还原到私有包下一层临时目录，保留固定SDK解析与Seed相对路径，标准stdio测试核对主入口无首轮泄漏、修订/参数/文档错误和进程退出。原十二工具/五能力平坦Catalog回归不可替换。新增验证消费者必须同步页面、状态数据、helper、安装链、生成输出和测试，不只改截图断言。
