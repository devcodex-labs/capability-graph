# 站点文档整改与收敛记录

日期：2026-10-09。基线提交：`3bd3ec7ad8a6605ea0feadf14497b5b2397b8e8b`。支持的包版本：`1.0.1`。

本文是提交前的本地验收快照；用户随后已授权提交和推送，实际提交/推送状态以 Git 记录为准。下列 local/dirty 制品身份与未部署说明仍对应本次验收构建。

用户确认接受 D01–D16 及 C01–C04 推荐方案，随后授权修复独立复审发现的 D18–D26。当前 D01–D26 已在工作区完成修复并通过相应本地验收。上一轮仅覆盖 D01–D17 的检查有漏项，本记录以本轮新增边界及完整回归为准。此结论限定于已发现问题和已执行检查，不代表已提交、已部署、完整 WCAG 合规或真实用户验收。

## 问题关闭清单

| 编号 | 状态 | 实施与验收依据 |
|---|---|---|
| D01 搜索 Enter 越界 | 已验证（本地） | 主题覆盖将 Enter/箭头限制在搜索输入内，检查有效候选与 IME；关闭、空查询、清空、零结果及 debounce 清空均有回归。[搜索实现](theme/SearchPanel.tsx)、[回归](tests/search.spec.ts) |
| D02 批量槽位冲突 | 已验证（本地） | 区分 getCapabilities 原始输入槽位与文档展开后槽位；按成功项身份关联。[概念](docs/concepts/provider-scope.mdx)、[参考](docs/reference/result-meta.mdx)、[行为门禁](scripts/lib/reference-contracts.mjs) |
| D03 隔离承诺过宽 | 已验证（本地） | 点读保留成功项，不承诺联合目录部分成功；真实故障测试与指南、概念、示例一致。[指南](docs/guides/multiple-providers.mdx)、[原始隔离回归](../test/provider-isolation.test.ts) |
| D04 公共合同不完整 | 已验证（本地） | 八个参考页渲染 95 个完整签名、366 个字段/方法；补绑定差异、默认值、限制、预算与失败方式。[生成器](scripts/generate-contract-reference.mjs)、[声明对照](scripts/lib/public-contracts.mjs) |
| D05 升级缺少迁移入口 | 已验证（本地） | 安装页补 1.0.0 → 1.0.1 警告、前后配置、迁移步骤与 changelog；旧配置拒绝、新配置读取规范通过。[安装与迁移](docs/getting-started/installation.mdx) |
| D06 搜索焦点约束 | 已验证（本地） | Tab/Shift+Tab 循环、背景 inert、Escape 和焦点恢复；320px 与桌面快捷键入口通过。[焦点管理](theme/modal-focus.ts)、[可访问性回归](tests/accessibility.spec.ts) |
| D07 折叠混入跳转 | 已验证（本地） | 标题链接与折叠按钮分离；点击、Enter、Space 折叠不改 URL。[侧栏](theme/Sidebar.tsx) |
| D08 折叠与当前位置语义 | 已验证（本地） | hidden 内容退出焦点顺序；aria-expanded/controls/current 与交互状态一致。[可访问性回归](tests/accessibility.spec.ts) |
| D09 手机导航无法取消 | 已验证（本地） | 明确关闭按钮、Escape、焦点约束与恢复；320/375/390px 关闭而不选择文章通过，遮罩关闭保留。[主题桥接](theme/AccessibleThemeBridge.tsx) |
| D10 状态标签对比度 | 已验证（本地） | 调整 info 标签浅/深色文字；实际合成背景下对比度均 ≥ 4.5:1，截图走查通过。[样式](theme/index.css)、[回归](tests/accessibility.spec.ts) |
| D11 分区入口选择价值 | 已验证（本地） | 七个入口按目标、前置、状态、结果选择下一步，不以篇幅填充重复内容。[导航内容门禁](scripts/check-content.mjs) |
| D12 生命周期缺少恢复示范 | 已验证（本地） | 页面完整脚本演示有效更新、新 hash、previous 读取、无效更新及旧 current 保留；本地与 Registry 消费者执行相同页面材料。[指南](docs/guides/lifecycle-and-reload.mdx)、[执行器](scripts/lib/lifecycle.mjs) |
| D13 Node 24 测试输出假设 | 已验证（本地） | 同时接受 TAP/spec 的计数格式，仍验证实际测试与陈旧输出清理；Node 20.19/22.12/24.19 各 171/171。[修复](../test/build.test.ts)、[CI 矩阵](../.github/workflows/ci.yml) |
| D14 贡献者说明混入用户文档 | 已验证（本地） | Seed/VextJS 保留使用状态和替代路径，夹具组织与 Runnable 升级条件移入 [CONTRIBUTING](CONTRIBUTING.md)。 |
| D15 浏览器负向门禁 | 已验证（本地） | 保留原正向场景，新增搜索/键盘/折叠/320px 回归；统一捕获 pageerror 与关键请求失败。[公共测试夹具](tests/fixtures.ts) |
| D16 覆盖检查只数符号 | 已验证（本地） | 独立字段/完整签名声明对照、签名编译、34 个预算默认值和行为用例；共同生成错误的补充验收见 D23。[负向门禁](scripts/check-contract-negatives.mjs) |
| D17 宽表格超出正文 | 已验证（本地） | 复审在 768px 错误参考页及 1280px API 设计页复现；全视口使用表格自身横向滚动，不裁掉合同内容。修复后 45 页 × 3 视口通过。[全页回归](tests/content-audit.spec.ts)、[样式](theme/index.css) |
| D18 搜索失败不能恢复 | 已验证（本地） | 显式重试或失败后重开会重建失败搜索器及 fetch 缓存；重试保留输入，成功实例继续复用。503 → 恢复后结果、Enter 跳转、Escape、焦点恢复通过。[实现](theme/SearchPanel.tsx)、[回归](tests/search.spec.ts) |
| D19 导航断点与锁定不一致 | 已验证（本地） | 导航触发器/关闭按钮/模态隔离统一到 ≤768px；跨断点使用原生遮罩关闭 React 状态并释放滚动锁。769/1024/1280px 往返、768px 遮罩、搜索叠加关闭顺序通过；多模态隔离按所有者释放。[桥接](theme/AccessibleThemeBridge.tsx)、[焦点管理](theme/modal-focus.ts)、[回归](tests/accessibility.spec.ts) |
| D20 本页目录缺少 Escape | 已验证（本地） | 目录按非模态展开区处理，补 aria-controls、Escape 关闭及触发器焦点恢复；320/768/1024px 关闭不导航、放大至桌面重置通过。[回归](tests/accessibility.spec.ts) |
| D21 Reader 哈希算法不完整 | 已验证（本地） | 参考明确 k: + 原始 bytes 的 SHA-256 小写十六进制前 16 位；精确表达式与集成骨架一致。公开 API 验证文档算法可用、完整哈希被逐文档拒绝；共同改错为 64 位的负例会失败。[参考](docs/reference/runtime-adapter.mdx)、[行为检查](scripts/lib/adapter-contracts.mjs) |
| D22 知识检索错误分类失配 | 已验证（本地） | 参考/排错/集成及全局错误指导统一 Static Revision、索引证据、返回页和单项 warning/partial 层级；补无 targets 不调用后端的边界。真实零命中、8 类查询错误、混合命中及过滤为空通过，共同改错错误码的负例会失败。[行为检查](scripts/lib/adapter-contracts.mjs) |
| D23 签名独立门禁有盲区 | 已验证（本地） | 从公开声明独立比较规范化 AST，覆盖函数参数/返回值、类静态方法、类型别名定义、接口泛型与展开字段。7 类 JSON/MDX 共同改错负例均被拒绝。[声明对照](scripts/lib/public-contracts.mjs)、[负例](scripts/check-contract-negatives.mjs) |
| D24 搜索快捷键提示对比度 | 已验证（本地） | 使用优先级高于依赖默认样式的本地主题规则；浅/深色模式下状态标签及 CtrlK 提示实际合成对比度均 ≥4.5:1。[样式](theme/index.css)、[回归](tests/accessibility.spec.ts) |
| D25 迟到拒绝责任过宽 | 已验证（本地） | 参考/排错区分 Core 接收的 query Promise 与 Adapter 独立后台任务；明确取消和清理仍归实现方。公共 API 超时后迟到拒绝未产生 unhandledRejection。[行为检查](scripts/lib/adapter-contracts.mjs) |
| D26 G2 被称为入门 Fixture | 已验证（本地） | 知识概念页链接 G2 完整材料，明确 G0 只有 route 且没有知识，与进阶/排错说明一致。[知识模型](docs/concepts/knowledge.mdx) |

## 已采纳的结构与发布方案

| 编号 | 结果 |
|---|---|
| C01 | 保留 URL；“设计 Provider API”入口归入集成；区分“Node.js 中使用 Core”；概念标题体现规范；合同集成标“仅合同”。 |
| C02 | 仅将重复的产品边界合并到概念首页，删除原独立源码页；旧 URL 及产品边界/责任链/当前边界三个书签继续重定向。原内容可由 Git 恢复。多 Provider 页明确为隔离测试，不宣称真实数据库后端。 |
| C03 | 保留全局默认展开；分区跳转与侧栏共享同一导航真相源，修正折叠交互。 |
| C04 | 新增手动、仅 main 的 [文档部署流程](../.github/workflows/docs-deploy.yml)。门禁约束 npm latest/发布标签/Core 基线、冻结实际文档 SHA、Registry 页面实装、同一最终制品及防回退；共用生产并发组和 github-pages 环境。没有触发该流程。 |

## 最终验证

| 检查 | 本地结果 |
|---|---|
| 内容、导航与标题 | 45 个正式页面、45 个唯一标题；每页恰好一个全局导航入口 |
| 公共合同 | 95 个签名 AST/声明对照、366 个字段/方法、字面量枚举、声明编译、34 个预算默认值、24 个定义用例、13 个字段边界通过；新增 14 个 Reader/检索/Runtime 行为场景，7 类共同签名改错及 Reader 算法/错误码负例通过 |
| 教程与示例 | 页面还原 G0–G4、4 个独立 G4 用例、12 个类型示例、生命周期变更/恢复；12 个状态条目通过 |
| Registry 实装 | 上一轮仓库外无版本安装取得 1.0.1，教程及生命周期通过；本轮未重跑 Registry 安装，包版本与 Core 未改 |
| 根回归 | 上一轮 Node 20.19.0、22.12.0、24.19.0 各 171/171，包含真实 HTTP Runtime 和多 Provider 故障；本轮未重跑整套根回归 |
| MCP | 上一轮 8/8，stdio 链、真实 HTTP 调用和错误保留通过；本轮 MCP 页面和 Core 未改，未重跑整套 MCP |
| 浏览器 | 本轮系统 Chromium 151，70/70，0 跳过/重试/偶发失败；包含 45 页 × 320/768/1280px 的 135 次走查和新增恢复/断点/键盘场景。仅故意注入的索引 503 被定向豁免，其他异常及关键请求仍自动判错 |
| 链接与 SEO | 45 个 canonical/sitemap URL、30 条兼容重定向、内部目标及锚点、description/og:url 通过 |
| AI 文档 | Markdown、llms.txt、llms-full.txt 与 HTML 来自同一最终 AI-enabled 构建；公开合同包含在生成结果中 |
| 包边界 | 73 个打包文件；网站未进入主包；净源码打包、陈旧输出清理、隔离消费者运行与声明检查通过 |
| 类型及工作流 | 主题 TypeScript、四个工作流 YAML/结构、部署基线/漂移/防回退/网络失败合同，以及发布顺序 5 正例/5 反例通过；未运行远端 Actions |
| 最终制品 | 本轮 212 个文件在最终浏览器验收前后 SHA-256 完全一致；preview 4173/4174 端口释放；没有停止用户已有开发服务 |

本轮最终制品 SHA-256：`2fb5b32b87d3b91c2e43686783d6bade43f9f878dc448abf6de8847ae456ca0e`。

文档制品身份：`capability-graph-docs-1.0.1-3bd3ec7ad8a6605ea0feadf14497b5b2397b8e8b-f98f598a4afc`。`documentationDirty: true`、`deploymentKind: local` 明确表示尚未提交的本地构建，不把基线 HEAD 当成包含本轮修复的线上提交。

本轮本地证据保存在忽略的 output 目录：[最终逐文件哈希](output/round4-build-sha256.json)、[70 项浏览器结果](output/round4-playwright-results.json)、[1024px 导航截图](output/round4-navigation-1024.png)、[搜索恢复截图](output/round4-search-recovered.png)、[整改前独立复审清单](output/site-audit-2026-10-09-round3.md)。上一轮哈希保留在 final-build-sha256.json，不覆盖历史验收证据。这些链接在当前工作区有效，未纳入公开站点。

## 验证边界与后续

- U01：未取得公网 Pages 的新部署与身份核对证据。先前访问被代理拒绝，不能判定站点宕机；本轮未部署，公网不会自动展示这些本地改动。
- U02：远端 CI、github-pages 审批/权限、外部 GitHub 链接及其他地域/镜像的 Registry 可达性仍待维护者核验。本地 YAML 与合同测试不能替代真实 Actions 运行；只读 Git 检查已确认 main 等于当前 HEAD、v1.0.1 发布提交至 HEAD 的 Core 输入未改，但没有执行真实部署基线流程。
- U03：没有真实用户走读、屏幕阅读器实测、Firefox/WebKit 或公网 Core Web Vitals 证据。定向键盘、对比度与本地视口测试不等于完整 WCAG 或性能认证。

合并后可显式手动运行仅文档部署流程，再执行公网身份核对。没有新增后端、改变公开 Core 实现或 npm 版本策略；验收时未提交、推送、创建标签、发布包或部署。

复现完整本地门禁见 [CONTRIBUTING](CONTRIBUTING.md)。此云环境使用 `/usr/bin/chromium` 的本地 Playwright 配置及工作区 npm cache，避免受限的浏览器下载和不可写的默认 npm cache；这只是验证环境差异，不改变生产配置。
