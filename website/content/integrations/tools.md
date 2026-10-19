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
