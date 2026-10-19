# 运行示例

示例随 npm 包的 examples/ 目录一起分发。在你的 ESM 项目中安装并复制：

```sh
npm install @devcodex/capability-graph@2.0.0
cp -R node_modules/@devcodex/capability-graph/examples ./examples
```

以下命令均在你的项目根目录运行。已有 examples 目录时，将示例复制到其他目录并相应调整命令路径。

| 示例 | 命令 | 条件与可观察结果 |
| --- | --- | --- |
| 最小静态图谱 | node examples/minimal/static.mjs | 无模型；Catalog、Detail、Resolve、已声明文档与 close |
| 多 Provider | node examples/multi-provider/main.mjs | 无模型；acme::route requires shared::schema，完整两节点子图 |
| 已有 MCP Server | MCP 客户端启动 node examples/mcp/server.mjs | 另装官方 server SDK；ping、资源、Prompt 保留，Graph 工具可调用 |
| 自定义模型 | node examples/custom-executor.mjs | 应用已有 HTTPS 模型及环境变量；真实端点由调用方验证 |
| VextJS 图谱 | node examples/vextjs/resolve.mjs | 仅静态声明解析，不启动 VextJS |
| VextJS 真实框架 | node examples/vextjs/verify.mjs | 另装 vextjs@2.0.0；真实注册路由、有效请求及输入校验 |

静态示例无需模型凭据。自定义模型示例会调用你配置的端点，运行前请确认模型权限、认证和费用；各示例页列出所需依赖。
