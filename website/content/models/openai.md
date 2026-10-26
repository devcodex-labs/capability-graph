# OpenAI 与兼容网关

适用于应用主动 match，不是普通 Codex 宿主使用 MCP 的前置条件。Node 20.19+（20.x）另装 openai@6.49.0；Node 22.12+ / 24 可用6.49.0或7.39.0。Node20路线从本库v2.1.0开始，先核对[安装版本条件](/getting-started/installation)，再配置有效 API Key 与有权限且支持 strict Structured Outputs 的模型。CLI 网页登录不能代替 API 凭据。

| createOpenAIExecutor 字段 | 必填 / 默认 | 说明 |
| --- | --- | --- |
| apiKey | 是 | 显式非空凭据，不自动读某个固定环境变量 |
| model | 是 | 显式非空模型 ID |
| baseURL | 否 / SDK 官方地址 | 绝对 HTTPS API 根地址，兼容 Responses + strict 输出的网关需单独验证 |
| maxOutputBytes | 否 / 65536 | 正安全整数，限制候选 UTF-8 字节 |
| fetch | 否 / 内置可信传输 | 应用可提供受信任传输，不由模型或 MCP 参数设置 |

## 安装与完整调用

在你的应用项目中先按[快速开始](/getting-started/quick-start)保存provider.json；本例不需要知识文件。Node 20.19+（20.x）安装v2.1.0起的本库版本和兼容SDK：

```sh
npm install @devcodex/capability-graph openai@6.49.0
```

Node 22.12+ / 24 可继续使用SDK 7；两种组合使用下面同一调用代码和参数：

```sh
npm install @devcodex/capability-graph openai@7.39.0
```

环境变量名由下面的应用脚本读取，不是Graph约定的自动配置项。apiKey/model必填；CG_MODEL_BASE_URL可省略，填写时必须是支持Responses及strict输出的HTTPS API根地址。

Bash：

```bash
export CG_MODEL_API_KEY='你的API凭据'
export CG_MODEL_NAME='你有权限的模型ID'
# 仅自有兼容网关需要：export CG_MODEL_BASE_URL='https://gateway.example.com/v1'
node openai.mjs
```

PowerShell：

```powershell
$env:CG_MODEL_API_KEY='你的API凭据'
$env:CG_MODEL_NAME='你有权限的模型ID'
# 仅自有兼容网关需要：$env:CG_MODEL_BASE_URL='https://gateway.example.com/v1'
node openai.mjs
```

在provider.json旁保存openai.mjs。上面的运行命令会实际调用你的模型并可能产生费用；本地文档校验或受控传输不等于真实账号验证。

```js title="openai.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { createOpenAIExecutor } from '@devcodex/capability-graph/adapters/openai';
import { fileURLToPath } from 'node:url';

const apiKey = process.env.CG_MODEL_API_KEY;
const model = process.env.CG_MODEL_NAME;
const baseURL = process.env.CG_MODEL_BASE_URL;
if (!apiKey || !model) throw new Error('Configure CG_MODEL_API_KEY and CG_MODEL_NAME');
let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }],
    model: createOpenAIExecutor({ apiKey, model, ...(baseURL ? { baseURL } : {}) })
  });
  const result = await graph.match({
    input: '创建带请求校验的 Acme HTTP 接口',
    context: { facts: { framework: 'acme' } }
  }, { timeoutMs: 60000 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

成功stdout为完整MatchResult，结构和四种业务状态见[结果处理](/models/match)。GraphError输出code/phase/nextAction；认证、额度、网关协议不兼容等不得当作no_match。未配置的环境变量会在创建Graph前明确报错。

SDK只发送本次input、Context、授权精简Catalog、Revision；Responses请求使用text.format的json_schema/strict、store:false并关闭自动重试，不自动读取知识正文。默认遵循系统CA及代理：依次取第一个非空的 `HTTPS_PROXY`、`https_proxy`、`HTTP_PROXY`、`http_proxy`（空值视为未设置），`NO_PROXY`/`no_proxy` 列出的主机（含子域、可带端口，`*` 表示全部）直连。配置代理后，代理隧道或直连目标的连接失败会立即返回 `CG_MODEL_UNAVAILABLE`，不做隐藏重连。传入自定义 `fetch` 时不使用这些变量。

选择结果只接受顶层 `status:'completed'` 且 `error:null` 的最终响应；兼容网关也必须提供这两个字段。`failed` 返回 `CG_MODEL_UNAVAILABLE`，`cancelled` 返回 `CG_MODEL_CANCELLED`；排队、生成中、不完整、未知或缺失状态，以及完成响应中的异常错误字段，都返回 `CG_MODEL_OUTPUT_INVALID`。即使输出包含合法选择JSON，也不会把这些响应当作成功匹配；适配器不轮询后台任务。

消息内容还会检查元素及文本类型：畸形内容返回 `CG_MODEL_OUTPUT_INVALID`，合法拒绝返回 `CG_MODEL_REFUSED`。按错误的 `nextAction` 调整输入、配置或决定重试，不能仅因HTTP为200就认为生成成功。

CLI JSON 使用 model:{type:'openai',apiKeyEnv:'CG_MODEL_API_KEY',model:'你可用的模型'}；环境变量名称由配置决定，不把明文 Key 写入 JSON。

baseURL 不能把 Chat Completions 自动变成 Responses。内置适配器不提供 Chat Completions、xAI 预设或格式自动降级，可在[自定义执行器](/models/custom)中对接现有调用。

官方[Structured Outputs说明](https://developers.openai.com/api/docs/guides/structured-outputs#structured-outputs-vs-json-mode)区分schema约束输出与只保证JSON语法的JSON mode。你的模型和网关必须满足本适配器所需契约；不能仅凭“兼容OpenAI”判断可用。

首次接入时，使用有权限的模型运行一次 match，确认返回 status、selection 和同 Revision 的 graph。遇到认证、额度、协议或结构化输出错误时，按 [GraphError](/reference/errors) 的 code/phase/nextAction 排查；CLI 登录与 OpenAI API 账号凭据分别配置。
