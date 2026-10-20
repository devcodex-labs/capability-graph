# 通用 Agent Tool Adapter

已有 Agent 不必经 MCP 或启动 HTTP 服务。应用创建 Graph 后，导入 @devcodex/capability-graph/tools 的 createGraphTools，将 definitions 转为宿主工具格式，将调用转发给 call。

```js
import {createGraphTools} from '@devcodex/capability-graph/tools';
const tools = createGraphTools(graph);
const result = await tools.call('capability_graph_resolve', {ids:['acme::route']});
if (result.ok) console.log(result.data);
else console.error(result.error.code, result.error.phase);
```

graph 的完整创建/释放流程见[快速开始](/getting-started/quick-start)。每个定义含 name/description/inputSchema/outputSchema，自包含 Draft2020 Schema。definitions 只读，调用返回 {ok:true,data} 或 {ok:false,error}，复用 SDK 语义。

call(name,args?,options?) 默认 args 为 {}；options.signal/timeoutMs 控制 match。未知/禁用工具明确报错。默认五工具；createGraphTools(graph,{enableMatch:true}) 要求 Graph 已配置模型，才增加第六个 match。

宿主当前模型读 Catalog、选择 ID、Resolve；不需要二次模型调用。Adapter 借用 Graph，不关闭它，不动态注册 Provider 中所谓执行工具。接入特定 Agent 的工具格式由调用方转换。

## 把定义映射到宿主工具格式

以下是放在已创建graph的应用中的接入片段。宿主字段因框架而异，这里以常见的function工具形状展示映射，最终以你的宿主公开接口为准，不虚构统一Agent注册API。

```js
const tools = createGraphTools(graph);
const hostDefinitions = tools.definitions.map(definition => ({
  type: 'function',
  function: {
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema
  }
}));
console.log(hostDefinitions);

// 收到宿主工具调用后，以它提供的name和解析后的arguments转发。
const name = 'capability_graph_resolve';
const arguments_ = { ids: ['acme::route'] };
const outcome = await tools.call(name, arguments_);
if (outcome.ok) console.log(JSON.stringify(outcome.data, null, 2));
else console.error(JSON.stringify(outcome.error));
```

这里的name/arguments_是本例一次调用，不是自动执行能力。实际Agent应将已校验的工具名和参数传给call，并把outcome按宿主要求回送。outputSchema由需要它的宿主另行采用，不能把GraphTools的{ok,data/error}外壳说成原始ResolveResult。

未知/禁用工具会得到 `ok:false,error.code:'CG_INPUT_INVALID'`；创建时enableMatch:true却无executor会同步抛CG_MODEL_NOT_CONFIGURED/config。definitions不是Provider能力列表，模型从Catalog选择能力后仍调用同一个resolve工具。
