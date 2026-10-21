# 运行示例

普通图谱示例使用Node20.19+（20.x）或22.12+；Node20使用本库v2.1.0起的版本，见[安装条件](/getting-started/installation)。真实VextJS的TS路由示例另需Node22.12+，不要在Node20传入strip-types标志。

示例随 npm 包的 examples/ 目录一起分发。在你的 ESM 项目中安装并复制：

```sh
npm install @devcodex/capability-graph
cp -R node_modules/@devcodex/capability-graph/examples ./examples
```

以下命令均在你的项目根目录运行。已有 examples 目录时，将示例复制到其他目录并相应调整命令路径。

| 示例 | 命令 | 条件与可观察结果 |
| --- | --- | --- |
| 文件式最小图谱 | node examples/minimal/static.mjs | 无模型/无知识文件；读取 provider.json，输出完整 ResolveResult |
| 内联式最小图谱 | node examples/minimal/inline.mjs | 无外部文件；同一声明与文件式产生相同完整结果 |
| 目录、详情与知识正文 | node examples/minimal/details.mjs | 使用 details.provider.json 及随附 knowledge/guide.md；输出完整 catalog/details/document |
| 本地文档与 URL 引用 | node examples/documents/read.mjs | 读取 knowledge/route.md，取得 URL 引用，并展示 URL 正文读取被拒绝 |
| 多 Provider | node examples/multi-provider/main.mjs | 无模型；acme::route requires shared::schema，完整两节点子图 |
| 已有 MCP Server | MCP 客户端启动 node examples/mcp/server.mjs | 另装官方 server SDK；ping、资源、Prompt 保留，Graph 工具可调用 |
| 自定义模型 | node examples/custom-executor.mjs | 应用已有 HTTPS 模型及环境变量；真实端点由调用方验证 |
| VextJS 图谱 | node examples/vextjs/resolve.mjs | 仅静态声明解析，不启动 VextJS |
| VextJS 真实框架 | node --experimental-strip-types examples/vextjs/verify.mjs | Node22.12+，另装 vextjs@2.0.0；剥离类型后验证真实处理链/内存请求 |

静态示例无需模型凭据。自定义模型示例会调用你配置的端点，运行前请确认模型权限、认证和费用；各示例页列出所需依赖。

## PowerShell复制方式

在项目根目录执行：

```powershell
Copy-Item -LiteralPath node_modules/@devcodex/capability-graph/examples -Destination ./examples -Recurse
```

上面的cp适用于Bash，这里的Copy-Item适用于PowerShell；两个目标都应是尚未存在的示例目录，已有同名目录时先选择别的位置。示例用import.meta.url定位随附声明；无需链接源码仓库的node_modules。

## 无模型的语义对照

下列程序包含断言，成功时stdout保留各次API完整结果；失败时以非零退出码指出差异，不能把断言失败当通过。受控executor只验证状态/时序，不调用真实AI。

| 目的 | 项目根命令 | 输入与可观察结果 |
| --- | --- | --- |
| 关系、授权和候选范围 | node examples/scenarios/relations.mjs | 内联a/b、四正反向、闭包/多根/共享、隐藏来源与非法环；完整结果和错误code |
| Context分支 | node examples/scenarios/context.mjs | eq/in/稳定版本，缺失/非法标量/已知失败；三个字段名数组 |
| 四种模型状态 | node examples/scenarios/match.mjs | 固定合法选择，完整matched/no_match/ambiguous/needs_context及组合；不是生产matcher |
| 文件根、正文与字节 | node examples/scenarios/documents.mjs | 自建系统临时文件，文件式/内联读取、缺根/缺文件/URL、BOM/CRLF/hash；finally清理 |
| 快照和资源终止 | node examples/scenarios/lifecycle.mjs | 临时来源、受控等待与reload、失败保留旧图、close/abort/timeout；finally清理 |

每个脚本的目的、输入和结果说明分别在[关系](/guide/relations)、[Context](/guide/context)、[匹配](/models/match)、[文档](/guide/documents)和[生命周期](/guide/lifecycle)。开始先运行最小图谱，再按遇到的问题选择这些对照，不需要一次跑完才可使用。
