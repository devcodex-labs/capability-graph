# 文档站点维护入口

`website` 是独立的私有 Rspress 文档站点包。公开站点：https://devcodex-labs.github.io/capability-graph/ 。

先在仓库根运行 `npm ci`，再运行 `npm --prefix website ci`。站点命令在 `website` 执行：

```sh
npm run dev       # 生成参考材料并启动开发服务
npm run build     # 生成、验证、一次构建 HTML 和 AI 文档
npm run preview   # 预览已构建的制品
npm run check     # 完整站点验收
```

正式测试由根目录管理：`npm run test:docs`、`npm run test:site`；Firefox/WebKit 代表性检查为 `npm run test:site:cross`。浏览器检查前在根目录安装所需引擎，例如 `PLAYWRIGHT_BROWSERS_PATH=../capability-graph-artifacts/browser-binaries npx playwright install chromium firefox webkit`，运行测试时使用相同变量；已有系统 Chromium 时可设置 `DOCS_CHROMIUM_EXECUTABLE`。

| 位置 | 职责 |
|---|---|
| `website/docs/` | 页面、导航和公开静态资源 |
| `website/theme/` | 主题、侧栏、搜索和无障碍交互 |
| `website/data/` | 页面生成及内容规则的持久数据 |
| `website/scripts/` | 必要的生成、构建及站点制品写入入口 |
| `test/website/` | 正式单元测试、浏览器测试及其配置 |
| `test/fixtures/website/` | 固定测试材料，不能补充公开教程缺失的输入 |
| `scripts/validation/website/` | 内容、合同、示例、包边界和发布验证工具 |
| `scripts/lib/artifact-paths.mjs` | 通用仓库路径、仓库外产物边界及临时目录分配 |
| `scripts/lib/website-paths.mjs` | 站点路径及生成目录清理 |

站点产物默认位于仓库同级 `../capability-graph-artifacts/`：`website/generated/` 存放生成材料，`website/doc_build/` 存放站点制品，`website/playwright/` 存放浏览器结果。

可通过 `CG_ARTIFACTS_DIR` 指定另一个仓库外目录，目录边界及清理规则见[贡献指南](../CONTRIBUTING.md#源码与目录约定)。本地页面验证安装本次构建的 tarball；Registry 验证另安装已发布包。

`build:site`、`build:ai` 是 `build` 的兼容别名；新克隆无需预先生成材料。preview 和浏览器测试复用同一构建。写作、示例真实性及发布约定统一见根目录 [CONTRIBUTING.md](../CONTRIBUTING.md)。
