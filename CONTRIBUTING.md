# 项目贡献与维护

本文件集中维护源码贡献、文档真实性、验证及发布规则。常用开发命令见 [根 README](README.md#development)，站点安装与构建见 [website/README.md](website/README.md)，场景与测试入口见 [test/README.md](test/README.md)。公开站点面向接入者；本文件面向仓库维护者。

## 源码与目录约定

- 对外接口和 Adapter 合同使用 JSDoc，说明作用域、修订、错误、预算单位及资源所有权；不重复 TypeScript 已表达的类型。
- 关键算法注释解释校验顺序、生命周期和边界选择，行为修改时同步注释及回归测试，不按行数或注释比例验收。
- 区分候选失败与查询失败、超时与取消、观察为空与后端不可用。Adapter 错误不能带出内部路径；Core 公开诊断只保留明确投影的字段。
- 外部审查先复现再修复，异步错误包含严格拒绝模式及失败对照；最低 Node 版本、公开声明和实际安装包都需验证。测试 Fixture 不作为真实后端交付证据。

`src/` 保存 Core，`examples/` 保存持续维护的源码参考。正式测试与固定材料位于根 `test/`，通用验证工具位于 `scripts/validation/`；站点验证工具位于其 `website/` 子目录。独立私有 MCP 示例包的测试保留在 `examples/seed-mcp/test/`，由该包自己的构建与测试命令管理。站点只保留页面、主题、持久数据和必要构建配置及生成入口，具体职责见站点 README。

通用仓库路径、产物边界与临时目录分配由 `scripts/lib/artifact-paths.mjs` 管理；`scripts/lib/website-paths.mjs` 只管理站点路径及生成目录清理。包验证、Core 测试和框架验证直接使用通用工具。

临时消费者、一次性脚本、报告、日志、生成片段、站点制品、截图及 trace 位于仓库同级 `capability-graph-artifacts/`，不得在仓库内部另建隐藏产物目录。`CG_ARTIFACTS_DIR` 可指定其他仓库外目录，不能指向仓库内部或包含仓库的目录；创建与清理前核对真实路径和符号链接，测试只清理自建目录。截图使用 `testInfo.outputPath()` 随用例隔离，CI 从同级目录上传制品。正式主包构建及测试编译仍使用既有的 `dist/`、`dist-test/`。

## 文档维护

文档服务于接入者完成任务。沿用顶部 `v1`/`GitHub`、全局分区侧栏默认展开和现有路由；新增独立页面必须有独立用户任务，不为每个字段拆页。

### 内容要求

- Getting Started 从空 npm 项目只创建最小 Provider 和一个能力，完成 Catalog；关系、Knowledge、requires/Selection、Specification 在唯一进阶页按G1-G4添加。每检查点完整脚本独立open/close，G3/G4能仅从G0开始，不隐藏高级Fixture输入。
- Guide 解释适用场景、关键取舍与验证方式。配置片段明确合并位置，保留必填字段；代码依赖外部变量时写明来源，不标成独立可运行。
- Integration 区分 Core 和实现方职责，解释输入/输出、预算、失败语义、资源所有权及最小实现边界。骨架通过公开类型编译，不将依赖注入的合同示例宣称为真实后端。
- Example 包含场景、源码布局、运行目录/命令、关键调用和预期输出，说明证明范围。源码链接补充正文，不替代正文。
- Reference 保持精炼，准确列出必填/可选、默认值和限制，与公开声明和可执行用例核对，不复制整套教程。

### 真实性

完整脚本、配置片段、接口节选和概念设计必须明确区分。`Runnable` 需要自动执行路径；类型检查只能证明骨架合同。不得把 Flat Catalog 说成自动只返回主能力，也不得把有界详情说成无裁剪全量定义。

使用相同的 Acme 示例串联教程；Seed 是另一条仓库真实执行来源，两个 Provider ID 不混用。公开文档必须说明影响接入的版本可用性：仓库包含 Registry 尚未发布的接口时，安装页须标明仓库目标版本与已发布版本的差异，并给出可执行的源码打包路径。包发布后同步安装说明和状态，不凭本地 manifest 宣称包或站点已发布。凭据不写入文档；内部诊断及本机验证报告保存在仓库外。影响用户安装与使用的版本差异不能只写在交付报告中。

### 验证与证明范围

文档材料维护：最小 acme.http/route 对照为 test/fixtures/website/minimal-provider，输入来自公开页面；test/fixtures/website/advanced-provider 是独立的关系、知识、Specification 高级回归，不能暗中给最小教程补文件。两者由 check:examples 分别验证，不向读者解释内部夹具组织。

VextJS 已有原生 Provider/Runtime 源码参考与默认合同回归，固定来源下另有真实 MCP、TCP Session 和文档来源矩阵验证。根 `npm test` 对该集成的证明范围仍为 `Contract-only`；需要外部源码、安装快照或服务的验证应单列前置条件、命令、来源身份及结果，不作为通用生产认证或 Agent 任务成功的证据。具体入口与兼容边界见 [examples/vextjs/README.md](examples/vextjs/README.md)。新增 `Runnable` 声明需要真实自动执行路径、公开包入口及页面同源验证，不能只补代码或状态标签。

主题覆盖依赖固定的 Rspress 2.0.22 搜索 hook/SuggestItem 内部入口；保留其本地索引和排序，覆盖事件、模态与失败恢复。显式重试或失败后重开须重建失败搜索器及请求缓存，成功搜索器继续复用；不得直接修改 node_modules。侧栏覆盖布局按 ≤768px，目录展开按 ≤1279px，触发器/关闭按钮/模态语义与布局同步，跨断点必须释放滚动和 inert。升级依赖时运行 check:types 与完整浏览器回归，特别是索引 503 恢复、空/关闭搜索 Enter、IME、焦点约束、导航/搜索叠加、跨断点、目录 Escape 和折叠语义。侧栏与分区快速跳转只从同一 _meta 派生，不另建导航配置。

check:reference 独立比较公开声明与生成签名，包括函数、类静态方法、类型别名、接口泛型和字段；共同改错 JSON/MDX 的负例不能被同源一致性检查掩盖。Reader 算法与知识检索错误表由公开页面读取，再通过公共 API 验证，包括逐文档错误、查询级失败、单项 warning/partial 和真正零命中。

### 本地示例与站点验收

在 `website` 执行 `npm run build`。`scripts/validation/website/lib/tutorial.mjs` 是本地、Registry 及 MCP 测试共用的页面还原器，只接受固定检查点/文件白名单。页面是输入真相源，Fixture 只对照，不能复制 Fixture 补文件。`check:examples` 运行 helper 负例、G0-G4 及独立 G4 四例、页面输出，保留高级 Fixture Specification/Reader/API 和类型片段回归。安装验证需使用仓库外消费者和独立冻结的期望版本，不以实际读取的版本自证。

维护最小 Provider 或进阶 Fixture 时，在仓库根构建主包，分别验证两组材料，再执行页面同源验证：

```sh
npm run build
node test/fixtures/website/minimal-provider/discover.mjs
node test/fixtures/website/advanced-provider/discover.mjs
cd website
npm run check:examples
```

这些命令属于源码贡献者验证，不应放回公开教程的 npm 使用主路径。

新增被称为可运行的代码时，将其加入 `scripts/validation/website/check-doc-code.mjs` 或真实示例测试；不要只增一个状态标签。验证消费者及生成材料放在仓库外，清理时核对创建归属。Seed 的真实性另由根 `npm test` 和 `examples/seed-mcp` 的 `npm test` 验证。

最终验收在 `website` 按 build → check:build → test:site → check:build/check:package 执行，记录最终 doc_build 全部文件 SHA；浏览器预览不得隐式重建。之后若页面/配置/生成输入或输出变化，必须重建并重验同一制品。Playwright 管理自己的 preview，结束确认端口释放，不复用或杀用户服务。自动检查不替代独立用户走读，未取得真实走读证据时仍为 UNVERIFIED。

MCP 完整 Server/Client 由公开页面还原到仓库同级临时消费者，安装固定 SDK 和本次构建的主包 tarball，保留 Seed 相对路径，标准 stdio 测试核对主入口无首轮泄漏、修订/参数/文档错误和进程退出。Registry 验证另安装已发布包，两种证据分别记录。原十二工具/五能力平坦 Catalog 回归不可替换。新增验证消费者必须同步页面、状态数据、helper、安装链、生成输出和测试，不只改截图断言。

## 仅文档部署

合并并确认后，可在 GitHub Actions 手动运行 `Deploy documentation only`，选择 main；它不会发 npm、创建标签或部署 PR。使用 github-pages 环境的审批/保护规则；这些远端配置需由仓库维护者核对，本地测试不证明部署权限已就绪。

门禁冻结实际文档 SHA 与已发布包标签：manifest 必须等于 npm latest，公开 Core/构建输入须与该标签一致，运行页面还原、Registry 实装、类型、合同、AI/HTML/链接/浏览器/包边界检查后才上传同一制品。部署前再次核对 main 和 Registry，并拒绝覆盖更新或分叉的文档；npm 发布流程也共享并发组与防回退门禁。公开 identity 区分 releaseCommit（包基线）与 documentationCommit/Id（实际文档及制品哈希），本地脏工作区标记为 local，不冒充已提交部署。

网络错误、缺失发布标签、版本漂移或未知部署身份都应停止流程并排查，只有明确 404 才作为首次站点部署处理。此工作流落地不等于已上线；需要独立的公网 verify-public 证据。
