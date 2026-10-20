# 多个 Provider 示例

按[运行示例](/examples/index)安装 npm 包并复制 examples/，执行 `node examples/multi-provider/main.mjs`。该例用内联 JSON，等价的 file 来源可在配置中分别填写路径。

<!-- example:examples/multi-provider/main.mjs -->
```js
import {CapabilityGraph} from '@devcodex/capability-graph';
const graph=await CapabilityGraph.open({providers:[
  {definition:{providerId:'acme',name:'Acme endpoints',version:'1',capabilities:[{id:'route',name:'Validated endpoint',description:'Create a validated endpoint.',relations:{requires:['shared::schema']}}]}},
  {definition:{providerId:'shared',name:'Shared validation',version:'1',capabilities:[{id:'schema',name:'Schema',description:'Declare request validation.'}]}}
],allowedProviders:['acme','shared']});
try {
  const result=await graph.resolve({ids:['acme::route']});
  console.log(JSON.stringify(result,null,2));
} finally {await graph.close();}
```

脚本输出完整 ResolveResult。selected 为 acme::route，nodes[].capability.id 为 acme::route 与 shared::schema，边为 acme::route requires shared::schema，meta.completeness 为 complete；不是 nodes 字符串数组。[结果指南](/guide/results)解释所有字段。requires 是作者明确声明的依赖，Graph 不自动执行它。

如果只授权 acme，外部 shared 目标不能展开，返回 target_unavailable 与 partial；显式直接查询越权根则整次失败。Context 不能扩大授权。
