# Capability Graph

## 2.0.1

- OpenAI Responses 匹配只接受 `status: 'completed'` 且 `error: null` 的最终响应，正确区分失败、取消、非最终状态与畸形消息内容。兼容网关也须提供这两个字段。
- 保留受支持模型错误中合法的 `nextAction`，继续清洗原始错误消息，并为缺失或非法动作提供按错误码选择的默认值；SDK、Tool Adapter 与 MCP 保持一致。
- HTTP 请求与关闭超时限制为 1–2147483647 毫秒，在监听前拒绝会导致 Node 定时器溢出的配置。
- 修复 Windows npm bin 验收对空格及中文目录的处理，CI 持续覆盖该路径。
- 改进英文 README、文档导航、搜索样式、能力文档索引、本地文档与 URL 示例，以及 Codex 宿主接入教程。

## 2.0.0

Capability Graph 以静态 JSON 声明为基础，提供供应用和 AI 宿主使用的能力目录、详情、适用条件与依赖图。

- 严格校验多个 Provider，提供不可变快照、四类固定关系、反向查询与跨 Provider 依赖解析。
- 提供结构化 Context、Graph Revision、原子 reload、close 和受路径边界约束的本地文档读取。
- 可选 OpenAI Responses、独立只读 Codex CLI 或自定义 ModelExecutor，通过 match 返回选择与解析结果。
- 提供通用 Agent Tool Adapter、MCP stdio / Streamable HTTP、CLI、官方 Skill 和 Plugin。
- 提供显式 Codex setup、doctor、repair、clean；stdio 支持 MCP 2026-07-28 / 2025-06-18，HTTP 使用 2026-07-28。
- 提供 JavaScript/TypeScript 示例、VextJS 2.0.0 案例和使用手册。运行环境要求 Node.js >=22.12.0、ESM。

能力使用与执行由调用方负责。独立 Codex 匹配要求 Linux、bubblewrap 与原生 CLI 0.163.0；Codex Plugin 使用 HTTP，stdio 接入使用 setup。模型、远程 HTTPS 与认证条件见使用手册。
