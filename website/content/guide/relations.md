# 关系与多个 Provider

当一项能力需要另一项能力，或你要查找它的分类、特化和引用者时，用关系把它们连接起来。一个 Graph 可以加载多个 Provider，跨来源的能力也能一起解析。

先声明关系，再调用 `resolve` 取得子图。Graph 返回节点与边，实际如何使用能力仍由你的应用决定。

## 选择关系类型

| 声明方向 | 反向查询名 | 含义 |
| --- | --- | --- |
| `parents` | `children` | `route → http-group`：子能力指向父分类 |
| `specializes` | `specializedBy` | `validated-route → base-route`：特化能力指向基础能力 |
| `related` | `relatedBy` | `route → logging`：有向相关，不自动对称，也不隐含依赖 |
| `requires` | `requiredBy` | `validated-route → schema`：依赖者指向作者声明的前置能力 |

反向关系由索引构建，不能写入 JSON。`parents`、`specializes`、`requires` 各自禁止环；`related` 可有环。已加载 Provider 内不存在的目标会导致加载失败；未加载外部 Provider 的引用可保留。

## 跨 Provider 的最小例子

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

<a id="解析范围"></a>

## 选择展开范围

`resolve` 的 `relations` 决定展开范围：

| 你要取得什么 | 参数 | 展开结果 |
| --- | --- | --- |
| 根能力和全部前置依赖 | 省略，或 `['requires']` | 沿依赖逐层展开，直到没有新依赖 |
| 只查看选中的能力 | `[]` | 只返回根节点 |
| 查分类、特化、相关项或引用者 | 例如 `['children']` | 从根走一跳，不继续展开所到节点的依赖 |

可组合多个关系名；`null` 不是省略，会报 `CG_INPUT_INVALID`。节点详情仍保留原声明，不代表本次子图已展开其中所有关系。

selected 保留根顺序，输出节点/边稳定排序去重。节点 origin 优先级 selected > dependency > relation。边总是原始正向方向。

跨 Provider 目标已加载且授权时正常展开；未加载或无权限统一为 target_unavailable，放入 unresolved，meta.completeness 为 partial。隐藏反向来源不产生可探测计数或 partial。显式查询越权根整次失败。

上面的最小例子展示跨 Provider 依赖；下面的对照进一步验证反向关系和授权。关系是作者的声明，不是框架扫描或模型推测的事实。

## 区分三种范围

| 设置 | 谁负责 | 作用 |
| --- | --- | --- |
| `open.allowedProviders` | 应用可信配置 | 固定授权上限，省略为全部已加载，[]为零授权 |
| `listCatalog({providers})` | 查询调用方 | 从授权集合中挑选要展示的来源；不会修改Graph授权 |
| `match({providers})` | 应用或宿主 | 限制模型能选择的候选根，不是最终子图的硬过滤 |

例如已加载并授权a/b，`a::route requires b::schema`。`match.providers:['a']` 只让模型看到a的候选目录；如果它选择a::route，结果仍展开**已授权**b::schema。Context不能授予权限，查询参数也不能提权。

| 跨来源目标状态 | 实际行为 | 如何处理 |
| --- | --- | --- |
| 已加载、ID存在、已授权 | 正常展开 | 消费完整节点和边 |
| 来源未加载 | 正向引用保留，查询时unresolved/target_unavailable、partial | 检查自己是否漏配来源 |
| 来源已加载，但目标ID不存在 | open/reload校验失败，CG_RELATION_INVALID | 修正已知目标，不等待查询时partial |
| 目标无权访问 | 正向查询同样target_unavailable/partial | 检查可信授权配置，不据此探测隐藏内容 |
| 显式请求越权根 | 整次CG_ACCESS_DENIED | 不当空结果或no_match，联系配置维护者 |

只有隐藏未授权来源指向公开节点时，反向查询不会泄露它的节点、数量、警告或partial；仅更新隐藏声明也不改变公开revision。公开作者主动写下的外部ID只是公开声明，不证明隐藏目标实际存在。

<a id="可运行的闭包反向与授权对照"></a>

## 查找引用者并理解结果

对分类查询 `children`，会返回该分类以及声明它为父分类的能力。例如 `a::route` 声明了 `parents: ['group']`，查询 `a::group` 的子项即可找到它。

按[运行示例](/examples/index)复制后，在项目根运行 `node examples/scenarios/relations.mjs`。它输出所有关系查询的完整结果，无需模型网络请求；固定执行器仅用于验证候选范围。

先看三个字段：`selected` 是传入的根，`origin: 'relation'` 表示通过关系加入，`edges` 始终保留声明的正向方向。`group` 自己的 `requires` 只留在详情里，本次 `children` 查询不会沿它继续展开。

<details>
<summary>查看 a::group 查询 children 的完整返回</summary>

```json
{
  "selected": [
    "a::group"
  ],
  "nodes": [
    {
      "capability": {
        "id": "a::group",
        "providerId": "a",
        "name": "Group",
        "description": "Route category.",
        "relations": {
          "parents": [],
          "specializes": [],
          "related": [],
          "requires": [
            "a::group-dependency"
          ]
        },
        "documents": []
      },
      "origin": "selected",
      "applicability": {
        "status": "applicable",
        "missingFacts": [],
        "invalidFacts": [],
        "failedConditions": []
      }
    },
    {
      "capability": {
        "id": "a::route",
        "providerId": "a",
        "name": "Validated route",
        "description": "Declare an application route.",
        "relations": {
          "parents": [
            "a::group"
          ],
          "specializes": [
            "a::base"
          ],
          "related": [
            "a::peer"
          ],
          "requires": [
            "a::shared",
            "b::schema"
          ]
        },
        "documents": []
      },
      "origin": "relation",
      "applicability": {
        "status": "applicable",
        "missingFacts": [],
        "invalidFacts": [],
        "failedConditions": []
      }
    }
  ],
  "edges": [
    {
      "from": "a::route",
      "type": "parents",
      "to": "a::group"
    }
  ],
  "unresolved": [],
  "meta": {
    "revision": "sha256:2b5f8c70b021e2d7624abf42c614f653616a50dda0202e2cf177b136b55d524c",
    "completeness": "complete",
    "warnings": []
  }
}
```

</details>

## 处理缺失依赖与非法关系

`meta.completeness: 'partial'` 时，先读 `unresolved`，检查来源配置和授权。已加载来源中的错 ID 在加载时拒绝，不会等到查询才报告缺失。

`parents`、`specializes`、`requires` 各自成环报 `CG_RELATION_CYCLE`，需要修正声明；`related` 环合法。不同类型组成的路径不作为统一关系环。见[错误与恢复](/reference/errors)。

## 深入验证排序与授权

首次使用可以先看上面的范围表和结果解释；需要核对精确语义时，再运行以下完整对照。

<details>
<summary>查看验证要点与完整关系脚本</summary>

| 检查项 | 验证的行为 |
| --- | --- |
| 多根与共享依赖 | `selected` 去重保序；共享依赖只有一个节点；根的 `origin` 保持 `selected` |
| 展开深度 | `requires` 传递展开；其余正/反向关系从根一跳 |
| 边方向 | 反向查询仍返回正向边；`related` 反向须另行声明 |
| 候选与授权 | 候选仅 a 时仍可展开已授权 b 的依赖；隐藏更新不改变公开 Revision |
| 错误 | 未加载/未授权目标为 `partial`；已加载错 ID 在加载时拒绝 |

<!-- example:examples/scenarios/relations.mjs -->
```js title="relations.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import assert from 'node:assert/strict';

const a = { providerId: 'a', name: 'Application', version: '1', capabilities: [
  { id: 'route', name: 'Validated route', description: 'Declare an application route.', relations: { parents: ['group'], specializes: ['base'], related: ['peer'], requires: ['shared', 'b::schema'] } },
  { id: 'group', name: 'Group', description: 'Route category.', relations: { requires: ['group-dependency'] } },
  { id: 'base', name: 'Base', description: 'Base behavior.' },
  { id: 'peer', name: 'Peer', description: 'A related capability.', relations: { related: ['route'] } },
  { id: 'shared', name: 'Shared', description: 'Shared dependency.', relations: { requires: ['leaf'] } },
  { id: 'leaf', name: 'Leaf', description: 'A transitive dependency.' },
  { id: 'group-dependency', name: 'Group dependency', description: 'Not expanded by a parents query.' }
] };
const b = { providerId: 'b', name: 'Validation', version: '1', capabilities: [
  { id: 'schema', name: 'Schema', description: 'Declare a schema.', relations: { requires: ['a::shared'] } }
] };
const output = {};
const graph = await CapabilityGraph.open({ providers: [{ definition: a }, { definition: b }], allowedProviders: ['a', 'b'], model: {
  id: 'fixed-candidate-scope-demo', async select(request) {
    assert(request.catalog.every(item => item.providerId === 'a'));
    return { decision: 'selected', ids: ['a::route'] };
  }
} });
try {
  output.closure = await graph.resolve({ ids: ['a::route', 'a::shared', 'a::route'] });
  assert.deepEqual(output.closure.selected, ['a::route', 'a::shared']);
  assert.equal(output.closure.nodes.find(node => node.capability.id === 'a::shared').origin, 'selected');
  assert.equal(output.closure.nodes.filter(node => node.capability.id === 'a::leaf').length, 1);
  output.rootOnly = await graph.resolve({ ids: ['a::route'], relations: [] });assert.equal(output.rootOnly.nodes.length, 1);
  for (const [forward, reverse, target] of [['parents','children','a::group'],['specializes','specializedBy','a::base'],['related','relatedBy','a::peer'],['requires','requiredBy','a::shared']]) {
    output[forward] = await graph.resolve({ ids: ['a::route'], relations: [forward] });
    output[reverse] = await graph.resolve({ ids: [target], relations: [reverse] });
    assert(output[reverse].edges.some(edge => edge.from === 'a::route' && edge.type === forward && edge.to === target));
  }
  assert(!output.parents.nodes.some(node => node.capability.id === 'a::group-dependency'));
  output.candidateScope = await graph.match({ input: 'Scope demonstration only', providers: ['a'] });
  assert(output.candidateScope.graph.nodes.some(node => node.capability.id === 'b::schema'));
} finally { await graph.close(); }
for (const [name, providers] of [['unloaded', [{ definition: a }]], ['unauthorized', [{ definition: a }, { definition: b }]]]) {
  const limited = await CapabilityGraph.open({ providers, allowedProviders: ['a'] });
  try {
    output[name] = await limited.resolve({ ids: ['a::route'] });assert.equal(output[name].meta.completeness, 'partial');
    if(name === 'unauthorized') await assert.rejects(limited.resolve({ ids: ['b::schema'] }), error => error instanceof GraphError && error.code === 'CG_ACCESS_DENIED');
  } finally { await limited.close(); }
}
output.invalidCycles = {};
for (const type of ['parents', 'specializes', 'requires']) {
  const definition = { providerId: 'cycle', name: 'Invalid cycle', version: '1', capabilities: [
    { id: 'x', name: 'X', description: 'X', relations: { [type]: ['y'] } },
    { id: 'y', name: 'Y', description: 'Y', relations: { [type]: ['x'] } }
  ] };
  await assert.rejects(CapabilityGraph.open({ providers: [{ definition }] }), error => {
    assert(error instanceof GraphError);output.invalidCycles[type] = {code:error.code,phase:error.phase};return error.code === 'CG_RELATION_CYCLE';
  });
}
const publicDefinition = { providerId:'public', name:'Public', version:'1', capabilities:[{id:'route',name:'Route',description:'Visible route.'}] };
let publicRevision;
for (const version of ['1','2']) {
  const hidden = {providerId:'hidden',name:'Hidden',version,capabilities:[{id:'secret',name:'Secret',description:'Hidden source.',relations:{requires:['public::route']}}]};
  const view = await CapabilityGraph.open({providers:[{definition:publicDefinition},{definition:hidden}],allowedProviders:['public']});
  try {
    const result = await view.resolve({ids:['public::route'],relations:['requiredBy']});
    assert.equal(result.nodes.length,1);assert.equal(result.meta.completeness,'complete');assert.deepEqual(result.unresolved,[]);
    if(publicRevision) assert.equal(result.meta.revision,publicRevision);publicRevision=result.meta.revision;
    output[`hidden-${version}`]=result;
  } finally {await view.close();}
}
const badTarget = structuredClone(b);badTarget.capabilities[0].id='different';
await assert.rejects(CapabilityGraph.open({providers:[{definition:a},{definition:badTarget}]}),error=>{
  assert(error instanceof GraphError);output.badLoadedTarget={code:error.code,phase:error.phase};return error.code==='CG_RELATION_INVALID';
});
const mixed=await CapabilityGraph.open({providers:[{definition:{providerId:'mixed',name:'Mixed relations',version:'1',capabilities:[
  {id:'x',name:'X',description:'X',relations:{parents:['y']}},
  {id:'y',name:'Y',description:'Y',relations:{requires:['x']}}
]}}]});
try{output.mixedTypes=await mixed.resolve({ids:['mixed::x'],relations:['parents','requires']});}
finally{await mixed.close();}
console.log(JSON.stringify(output, null, 2));
```

</details>

节点稳定排序便于比较，origin优先级selected > dependency > relation只说明进入结果的来源；二者都不是调度顺序、安装顺序或执行授权。
