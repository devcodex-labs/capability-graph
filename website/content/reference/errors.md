# 错误与恢复

SDK 使用 GraphError reject，字段 code/phase/message/可选 nextAction，toJSON 返回安全结构。phase 为 config/load/query/match/document/lifecycle；nextAction 为 fix_input/check_config/refresh/narrow_scope/retry/contact_admin。不要按 message 做逻辑分支。

Tool Adapter 以 ok:false/error 返回；MCP 执行错误 isError:true，文本内容为机器可读 JSON，没有冒充成功的 structuredContent。协议请求错误由 MCP SDK 处理。静态空目录、no_match、unknown、partial 与异常不同。

| 错误码 | 触发与处理 |
| --- | --- |
| CG_CONFIG_INVALID | 来源、预算、认证、CLI 配置或服务条件无效；检查完整路径和类型 |
| CG_DEFINITION_INVALID | Provider JSON/字段/纯 JSON 规则失败；修正声明 |
| CG_RELATION_INVALID / CG_RELATION_CYCLE | 目标或关系不合法/循环；修正显式关系 |
| CG_CONTEXT_INVALID | Context 结构/值不合法；提供平面标量事实 |
| CG_INPUT_INVALID | ID、关系参数、超时等输入无效；不要把 null 当省略 |
| CG_ACCESS_DENIED | 显式根无授权或公开正文未批准；检查可信范围，不从 Context 提权 |
| CG_PROVIDER_NOT_FOUND / CG_CAPABILITY_NOT_FOUND | 显式目标不存在；刷新声明/目录后按真实 ID 调用 |
| CG_CATALOG_TOO_LARGE / CG_RESULT_TOO_LARGE / CG_INPUT_TOO_LARGE | 超出对应预算；缩小授权/输入或由可信宿主调整预算，不静默截断 |
| CG_GRAPH_CLOSED | 实例已关闭；必要时重新 open |
| CG_RELOAD_FAILED | 更新来源失败；检查 reload.ok/error/providers，旧快照保持可用 |
| CG_DOCUMENT_ROOT_REQUIRED | 内联本地文档没有可信 documentRoot；补充根 |
| CG_DOCUMENT_NOT_FOUND | 未声明或文件不存在；检查能力/文档 ID 与相对路径 |
| CG_DOCUMENT_ACCESS_DENIED | 路径越界/逃逸/正文未授权；修正可信来源 |
| CG_DOCUMENT_REFERENCE_ONLY | URL 只作为引用；不要期望自动 HTTP 抓取 |
| CG_DOCUMENT_TOO_LARGE / CG_DOCUMENT_UNREADABLE | 超限/编码/不稳定或不可读文件；修正文档或受信预算 |
| CG_MODEL_NOT_CONFIGURED | 调用 match 却没有 executor；配置后调用，静态查询可继续 |
| CG_MODEL_UNAVAILABLE | 缺可选 SDK、认证/网络/服务不可用；检查模型配置和访问 |
| CG_MODEL_EXECUTOR_UNSAFE | Codex 平台/版本/隔离前提不满足；提供支持环境，不降级 |
| CG_MODEL_CONTEXT_EXCEEDED | 上游上下文不足；缩小授权目录/请求 |
| CG_MODEL_OUTPUT_INVALID / CG_MODEL_INVALID_SELECTION | 候选结构、ID、状态或范围错误；不接受编造/越权选择 |
| CG_MODEL_OUTPUT_TOO_LARGE | 模型候选或传输包超限；缩小请求/输出 |
| CG_MODEL_REFUSED | 模型拒绝；向调用方说明，不当 no_match |
| CG_MODEL_TIMEOUT / CG_MODEL_CANCELLED | deadline/外部取消，phase为match；停止使用迟到结果，按用户意图决定重试 |

reload 失败通常正常返回 ok:false，不伪装新快照已发布；普通查询显式根错误整次失败。维护命令另有 status 和退出码，见[CLI](/integrations/cli)。

close终止活动match是CG_GRAPH_CLOSED/lifecycle，与timeout/cancel不同。模型无匹配是正常no_match；关系不完整是partial；reload失败是ok:false；不能把这四种情况都归为“模型失败”。

## 同样是失败，先找对外壳

下面SDK示例故意查询不存在能力，用于观察GraphError；在已安装本包的ESM项目保存为error.mjs运行，预期exit1，stderr是完整GraphError JSON：

```js title="error.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
let graph;
try {
  graph = await CapabilityGraph.open({ providers: [{ definition: {
    providerId: 'acme', name: 'Error example', version: '1', capabilities: []
  } }] });
  await graph.resolve({ ids: ['acme::missing'] });
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify(error.toJSON()));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

```json
{
  "code": "CG_CAPABILITY_NOT_FOUND",
  "phase": "query",
  "message": "Requested capability does not exist",
  "nextAction": "refresh"
}
```

| 入口 | 如何取错误 | 不要混淆 |
| --- | --- | --- |
| SDK | catch(error)，instanceof GraphError后读code/phase或toJSON() | 不带ok/error外壳 |
| Tool Adapter | outcome.ok:false后读outcome.error.code/phase | call返回结果，不要求捕获普通GraphError |
| MCP工具执行 | result.isError:true，JSON.parse(result.content中的text).code/phase | 与SDK协议层reject分开；无成功structuredContent |
| CLI图谱命令 | 非零退出，解析stderr的error.code/phase | stdout保留成功JSON或MCP协议 |
| CLI维护命令 | --json的stdout读status/checks/warnings并核对退出码 | 不套SDK的GraphError结构 |

Tool Adapter同一类查询失败的外壳形状为：

```json
{
  "ok": false,
  "error": {
    "code": "CG_CAPABILITY_NOT_FOUND",
    "phase": "query",
    "message": "Requested capability does not exist",
    "nextAction": "refresh"
  }
}
```

CLI检查不存在配置文件 `capability-graph doctor --config deliberately-missing-config.json`，实际stderr完整结构如下，exit1：

```json
{
  "ok": false,
  "error": {
    "code": "CG_CONFIG_INVALID",
    "phase": "config",
    "message": "Cannot read a valid bounded JSON configuration file",
    "nextAction": "check_config"
  }
}
```

维护命令的planned/ok/conflict/failed、checks[].status及退出0/1/2/3，见[CLI与维护](/integrations/cli)。协议级坏请求可能由客户端SDK直接reject，不能把它当Graph执行isError或业务no_match。
