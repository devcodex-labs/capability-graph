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

文档材料维护：最小 acme.http/route 对照为 website/fixtures/minimal-provider，输入来自公开页面；website/fixtures/first-provider 是独立的关系、知识、Specification 高级回归，不能暗中给最小教程补文件。两者由 check:examples 分别验证，不向读者解释内部夹具组织。

VextJS 仅为概念示例。升级为可运行状态前，需要公开源码/固定材料、公开包入口编译、真实主入口/下钻/错误路径，以及 CI 与页面同源验证；只补代码或标签不能改变状态。

主题覆盖依赖固定的 Rspress 2.0.22 搜索 hook/SuggestItem 内部入口；保留其本地索引和排序，覆盖事件、模态与失败恢复。显式重试或失败后重开须重建失败搜索器及请求缓存，成功搜索器继续复用；不得直接修改 node_modules。侧栏覆盖布局按 ≤768px，目录展开按 ≤1279px，触发器/关闭按钮/模态语义与布局同步，跨断点必须释放滚动和 inert。升级依赖时运行 check:types 与完整浏览器回归，特别是索引 503 恢复、空/关闭搜索 Enter、IME、焦点约束、导航/搜索叠加、跨断点、目录 Escape 和折叠语义。侧栏与分区快速跳转只从同一 _meta 派生，不另建导航配置。

check:reference 独立比较公开声明与生成签名，包括函数、类静态方法、类型别名、接口泛型和字段；共同改错 JSON/MDX 的负例不能被同源一致性检查掩盖。Reader 算法与知识检索错误表由公开页面读取，再通过公共 API 验证，包括逐文档错误、查询级失败、单项 warning/partial 和真正零命中。

## 仅文档部署

合并并确认后，可在 GitHub Actions 手动运行 `Deploy documentation only`，选择 main；它不会发 npm、创建标签或部署 PR。使用 github-pages 环境的审批/保护规则；这些远端配置需由仓库维护者核对，本地测试不证明部署权限已就绪。

门禁冻结实际文档 SHA 与已发布包标签：manifest 必须等于 npm latest，公开 Core/构建输入须与该标签一致，运行页面还原、Registry 实装、类型、合同、AI/HTML/链接/浏览器/包边界检查后才上传同一制品。部署前再次核对 main 和 Registry，并拒绝覆盖更新或分叉的文档；npm 发布流程也共享并发组与防回退门禁。公开 identity 区分 releaseCommit（包基线）与 documentationCommit/Id（实际文档及制品哈希），本地脏工作区标记为 local，不冒充已提交部署。

网络错误、缺失发布标签、版本漂移或未知部署身份都应停止流程并排查，只有明确 404 才作为首次站点部署处理。此工作流落地不等于已上线；需要独立的公网 verify-public 证据。

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
