# 故障排查

| 现象 | 检查与恢复 |
| --- | --- |
| 找不到 capability-graph 命令 | 本地项目用 npx --no-install，GUI 宿主使用已安装 bin 的绝对路径；跨项目执行 npm install --global @devcodex/capability-graph@2.0.0 |
| 换启动目录后 Provider 丢失 | SDK 按 open 时 cwd；CLI 按配置文件目录。示例使用 import.meta.url 定位文件 |
| 定义看似正确仍被拒绝 | 未知字段、纯空白文本、完整/局部 ID、循环关系、非 JSON 值均会失败；检查错误 code/phase |
| 目录为空 | providers 或授权为空是否有意配置；不要从空结果编造 ID |
| match 报未配置 | 静态 Graph 不隐式调用模型；明确配置 executor 或使用宿主模型路线 |
| 有登录却 OpenAI 不可用 | Codex 登录不提供 API Key；确认 API 权限、模型和 Responses 协议 |
| Codex adapter 不安全 | 本页不是正常宿主 MCP；检查 Linux/bubblewrap/原生固定版本与可信路径 |
| Codex 看不到工具 | host doctor 检查登记与实际工具发现；重载新会话；stdio 2025-06-18 与 HTTP 2026-07-28 分开核对 |
| Plugin 工具不可用 | Plugin 使用 HTTP，服务必须显式运行；核对 URL 和协议开关。Codex stdio 请用 setup 登记 |
| 只有 Skill 没工具 | Skill 不建立 MCP 连接；先接通服务 |
| reload 返回旧 Revision | 检查 ok 和每个 Provider 状态；候选失败会保留旧快照，不是静默更新 |
| 文档读取失败 | 检查声明 ID、根、相对路径、UTF-8、大小及 symlink；URL 正文不抓取 |
| partial 或 unknown | 查看 unresolved 与缺失/非法事实；不能把它们等同技术失败或可执行 |
| 远程 HTTP 失败 | 实际 HTTPS 可达、Host/Origin、认证、协议与代理路径；localhost 不能代表 ChatGPT 可达 |

详细稳定错误码见[参考](/reference/errors)。提交问题时提供包/Node/宿主版本、最小声明、调用与 code/phase，先移除密钥和无关私有材料。
