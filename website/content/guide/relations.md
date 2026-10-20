# 关系与多个 Provider

一个 Graph 的 providers 数组可配置多个 file 或 definition；每个 Provider 的关系进入统一索引。授权由 open.allowedProviders 固定，查询只能缩小范围。

| 声明方向 | 反向查询名 | 含义 |
| --- | --- | --- |
| parents | children | `route → http-group`：子能力指向父分类 |
| specializes | specializedBy | `validated-route → base-route`：特化能力指向基础能力 |
| related | relatedBy | `route → logging`：有向相关，不自动对称，也不隐含依赖 |
| requires | requiredBy | `validated-route → schema`：依赖者指向作者声明的前置能力 |

反向关系由索引构建，不能写入 JSON。parents、specializes、requires 各自禁止环；related 可有环。已加载 Provider 内不存在的目标会导致加载失败；未加载外部 Provider 的引用可保留。

## 解析范围

resolve 默认 relations:['requires']，展开根的 requires 传递闭包。显式 [] 只取根；其他正/反向关系从根一跳，不自动展开所到关联节点的依赖。null 不是省略，会报 CG_INPUT_INVALID。

selected 保留根顺序，输出节点/边稳定排序去重。节点 origin 优先级 selected > dependency > relation。边总是原始正向方向。

跨 Provider 目标已加载且授权时正常展开；未加载或无权限统一为 target_unavailable，放入 unresolved，meta.completeness 为 partial。隐藏反向来源不产生可探测计数或 partial。显式查询越权根整次失败。

完整跨 Provider 代码见[多个 Provider 示例](/examples/multi-provider)。关系是作者的声明，不是框架扫描或模型推测的事实。

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

## 可运行的闭包、反向与授权对照

按[运行示例](/examples/index)复制后，在项目根运行 `node examples/scenarios/relations.mjs`。该程序无模型网络请求；其中的固定executor只用于验证候选范围。它输出各次完整ResolveResult/MatchResult，并断言：

- 多根selected去重保序，两个根共享的依赖只出现一次；已经选中的共享节点origin保持selected。
- requires会到达两级依赖；parents/children、specializes/specializedBy、related/relatedBy、requiredBy仅根一跳，不自动展开关联节点的requires。
- 反向查询的edge依然是原始正向；related的相反方向必须另写一条边。
- parents/specializes/requires各自成环时CG_RELATION_CYCLE；related环合法。跨不同类型构成的路径不被当作统一关系环。
- 模型候选仅a时仍展开授权b依赖；未加载/未授权为generic partial；已加载错ID在load拒绝；隐藏更新不改公开revision。

例如对 `a::group` 查询children，实际完整结果为：

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

其中edge是route parents group，没有翻成children边。group自己的requires仍保留在详情里，但本次没有沿它继续展开，这与子图edges是两个层次。

<details>
<summary>查看完整关系与授权验证脚本</summary>

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
