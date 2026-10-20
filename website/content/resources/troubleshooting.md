# 故障排查

详细稳定错误码见[参考](/reference/errors)。提交问题时提供包/Node/宿主版本、最小声明、调用与 code/phase，先移除密钥和无关私有材料。

## 按现象找到下一条动作

| 现象 | 诊断命令或检查位置 | 应观察什么 | 恢复 |
| --- | --- | --- | --- |
| 文档方法与安装不一致 | node --version；npm ls @devcodex/capability-graph | Node>=22.12，实际安装版本匹配手册 | 站点可能先于npm发布，核对版本后选择手册 |
| 找不到命令 | 本地项目执行 npx --no-install capability-graph；GUI 宿主核对 bin 绝对路径 | 已安装包和正确路径 | 跨项目需要 CLI 时再全局安装 |
| 换目录后来源丢失 | SDK 的 open cwd；CLI 的配置文件目录 | 实际解析的声明路径 | 脚本使用 import.meta.url，配置路径按其目录填写 |
| 文档读取失败 | capabilityId/documentId、文档根与 source | 本地存在且合法 UTF-8；URL 仅引用 | 修正声明/正文；URL 从详情取得，不用 readDocument 抓取 |
| 只有 Skill 没工具 | 宿主 MCP 连接与工具列表 | Skill 本身不建立连接 | 先完成 MCP 或 setup 接入 |
| 独立 Codex adapter 报不安全 | Linux、bubblewrap、固定原生 CLI 与挂载权限 | CG_MODEL_EXECUTOR_UNSAFE 的具体前提 | 满足隔离条件后重试；普通宿主用当前模型 MCP |
| Provider加载失败 | npx --no-install capability-graph validate --file provider.json | stdout.ok:true或stderr.error.code/phase | 修正字段/ID/路径，跨来源再做整体doctor |
| 配置或范围异常 | npx --no-install capability-graph doctor --config graph.config.json | ok、items、toolCount、modelVerification:not_run | 核对来源/授权和相对路径，不编造目录项 |
| Codex有登记但无工具 | capability-graph doctor --host codex --json | 顶层status及checks，不等于模型成功 | 修路径/协议，必要时repair预览，再新会话 |
| 已有登录但模型失败 | GraphError.code/phase和模型页前提 | API凭据与CLI登录不同 | 针对认证/额度/协议修配置，不统一盲重试 |
| Plugin装好但目录空 | 外部服务ready URL及plugin/graph.config.json | providers/授权非空，Catalog有真实ID | 替换空模板，先启动匹配的服务 |
| reload未生效 | update.ok/error/providers | failed/not_applied/unchanged及旧revision | 修候选重试；新增来源或授权改变重新open |
| unknown或partial | applicability字段数组和unresolved | 缺事实与缺依赖分别呈现 | 补可信事实/核对已知授权，不当作可执行 |
| HTTPS可打开但握手失败 | 实际协商版本、Host/Origin、认证与代理 | 工具发现和一次Resolve才是闭环 | 修协议/认证/路由；缺前提保留未验证 |

各入口错误外壳不同，字段路径见[错误与恢复](/reference/errors)。普通接入无需先读维护者的OIDC、分支或发版流程。
