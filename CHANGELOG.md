# Capability Graph

## 2.0.0

Capability Graph 以静态 JSON 声明为基础，提供供应用和 AI 宿主使用的能力目录、详情、适用条件与依赖图。

- 严格校验多个 Provider，提供不可变快照、四类固定关系、反向查询与跨 Provider 依赖解析。
- 提供结构化 Context、Graph Revision、原子 reload、close 和受路径边界约束的本地文档读取。
- 可选 OpenAI Responses、独立只读 Codex CLI 或自定义 ModelExecutor，通过 match 返回选择与解析结果。
- 提供通用 Agent Tool Adapter、MCP stdio / Streamable HTTP、CLI、官方 Skill 和 Plugin。
- 提供显式 Codex setup、doctor、repair、clean；stdio 支持 MCP 2026-07-28 / 2025-06-18，HTTP 使用 2026-07-28。
- 提供 JavaScript/TypeScript 示例、VextJS 2.0.0 案例和使用手册。运行环境要求 Node.js >=22.12.0、ESM。

能力使用与执行由调用方负责。独立 Codex 匹配要求 Linux、bubblewrap 与原生 CLI 0.163.0；Codex Plugin 使用 HTTP，stdio 接入使用 setup。模型、远程 HTTPS 与认证条件见使用手册。
