# OpenAI 与兼容网关

适用于应用主动 match，不是普通 Codex 宿主使用 MCP 的前置条件。另装 openai@7.39.0；配置有效 API Key 与有权限且支持 strict Structured Outputs 的模型。CLI 网页登录不能代替 API 凭据。

| createOpenAIExecutor 字段 | 必填 / 默认 | 说明 |
| --- | --- | --- |
| apiKey | 是 | 显式非空凭据，不自动读某个固定环境变量 |
| model | 是 | 显式非空模型 ID |
| baseURL | 否 / SDK 官方地址 | 绝对 HTTPS API 根地址，兼容 Responses + strict 输出的网关需单独验证 |
| maxOutputBytes | 否 / 65536 | 正安全整数，限制候选 UTF-8 字节 |
| fetch | 否 / 内置可信传输 | 应用可提供受信任传输，不由模型或 MCP 参数设置 |

完整 open/match/错误处理/close 代码见[match](/models/match)。SDK 只发送本次 input、Context、授权 Catalog、Revision；Responses API 设置 store:false，关闭自动重试。默认遵循系统 CA 与代理。

CLI JSON 使用 model:{type:'openai',apiKeyEnv:'CG_MODEL_API_KEY',model:'你可用的模型'}；环境变量名称由配置决定，不把明文 Key 写入 JSON。

baseURL 不能把 Chat Completions 自动变成 Responses。内置适配器不提供 Chat Completions、xAI 预设或格式自动降级，可在[自定义执行器](/models/custom)中对接现有调用。

首次接入时，使用有权限的模型运行一次 match，确认返回 status、selection 和同 Revision 的 graph。遇到认证、额度、协议或结构化输出错误时，按 [GraphError](/reference/errors) 的 code/phase/nextAction 排查；CLI 登录与 OpenAI API 账号凭据分别配置。
