# Context 与适用条件

同一项能力可能只适用于特定框架、运行时或版本。用 `appliesTo` 声明条件，再把已知环境放进查询的 `context.facts`，即可判断适用、不适用或信息不足。

Context 由调用方提供，不授予访问权限，也不会触发仓库扫描。

## 提供环境事实

```json
{"facts":{"framework":"vextjs","framework.version":"2.0.0","production":true},"notes":"Only the supplied facts are known."}
```

facts 是平面映射，值只能是 string、有限 number 或 boolean。点号是键名的一部分，不访问嵌套对象；null、数组、对象等不合法。notes 仅给模型参考，不进入确定性适用判断。

```json
{"appliesTo":{"all":[{"field":"framework","op":"eq","value":"vextjs"},{"field":"framework.version","op":"semverRange","range":">=2.0.0 <3.0.0"}]}}
```

| 条件 | 定义与边界 |
| --- | --- |
| eq | 严格同类型等值，不把 1 与 '1' 等同 |
| in | values 为标量数组；空数组合法，对已提供的事实均不匹配 |
| semverRange | 稳定 major.minor.patch，支持精确版本或空格 AND 连接的 =/>/>=/</<=；不支持 ^/~/*/或、预发布、build metadata、前导零 |

无 appliesTo 或 all:[] 为 applicable。已知条件不满足时为 inapplicable，优先于同时存在的缺失信息；否则缺失/非法版本事实为 unknown。返回 missingFacts/invalidFacts/failedConditions。

getCapabilities 与 resolve 都保留不适用或未知节点。match.status、节点 applicability 与 graph.meta.completeness 分开看：matched 可以同时 unknown 或 partial，不能直接等同可执行。

## 运行输入与输出对照

按[运行示例](/examples/index)安装并复制示例，在你的项目根运行 `node examples/scenarios/context.mjs`。它使用内联声明，无模型或文件前置；全部断言通过才输出一个完整JSON对象，各键保留输入和API原结果。它刻意重复一个framework条件，验证字段名仍去重。

同一项能力要求 `framework === 'acme'`、`runtime` 在node/bun内、字面键 `framework.version` 位于 `>=2.0.0 <3.0.0`：

| 输入 facts | status | missingFacts | invalidFacts | failedConditions |
| --- | --- | --- | --- | --- |
| acme / node / 2.1.0 | applicable | [] | [] | [] |
| 只有framework:acme | unknown | [framework.version, runtime] | [] | [] |
| acme / node / 版本数字2 | unknown | [] | [framework.version] | [] |
| framework:1，其余缺失 | inapplicable | [framework.version, runtime] | [] | [framework] |
| framework:other，其余缺失 | inapplicable | [framework.version, runtime] | [] | [framework] |

以上三个数组都是**去重并稳定排序的字段名**，不是失败规则、条件对象或规则ID。已知失败优先：即使还有缺失字段，仍为inapplicable；没有已知失败才因缺失/非法版本值变unknown。

例如 `invalid-version` 的结果为 `unknown`，非法事实字段为 `framework.version`。完整返回保留输入条件与诊断：

<details>
<summary>查看 invalid-version 的完整 getCapabilities 返回</summary>

```json
{
  "items": [
    {
      "capability": {
        "id": "conditions::route",
        "providerId": "conditions",
        "name": "Route",
        "description": "An Acme route on Node or Bun, version 2.",
        "appliesTo": {
          "all": [
            {
              "field": "framework",
              "op": "eq",
              "value": "acme"
            },
            {
              "field": "framework",
              "op": "eq",
              "value": "acme"
            },
            {
              "field": "runtime",
              "op": "in",
              "values": [
                "node",
                "bun"
              ]
            },
            {
              "field": "framework.version",
              "op": "semverRange",
              "range": ">=2.0.0 <3.0.0"
            }
          ]
        },
        "relations": {
          "parents": [],
          "specializes": [],
          "related": [],
          "requires": []
        },
        "documents": []
      },
      "applicability": {
        "status": "unknown",
        "missingFacts": [],
        "invalidFacts": [
          "framework.version"
        ],
        "failedConditions": []
      }
    }
  ],
  "meta": {
    "revision": "sha256:d8bd949e4dbbd2c9552df7a9edc81aaf6a0caa10537da703aded21459598e81b",
    "completeness": "complete",
    "warnings": []
  }
}
```

</details>

## 处理信息不足与错误输入

`2` 是合法 Context 数字，不因结构报错；它不是版本比较需要的稳定版本字符串，因此记录在 `invalidFacts`。反之，`{facts:{framework:{name:'acme'}}}` 是非法嵌套结构，整次拒绝为 `CG_CONTEXT_INVALID/query`，不会返回 `unknown`。

`in:[]` 定义合法，但已提供的任何事实都不在空集合中，返回inapplicable；该事实缺失时仍是unknown。`range:'^2.0.0'` 等当前不支持的范围在声明加载时为 `CG_DEFINITION_INVALID/load`；不要套用npm版本范围的全部语法。

<details>
<summary>查看完整Context验证脚本</summary>

<!-- example:examples/scenarios/context.mjs -->
```js title="context.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import assert from 'node:assert/strict';

const definition = {
  providerId: 'conditions', name: 'Condition examples', version: '1',
  capabilities: [
    { id: 'route', name: 'Route', description: 'An Acme route on Node or Bun, version 2.', appliesTo: { all: [
      { field: 'framework', op: 'eq', value: 'acme' },
      { field: 'framework', op: 'eq', value: 'acme' },
      { field: 'runtime', op: 'in', values: ['node', 'bun'] },
      { field: 'framework.version', op: 'semverRange', range: '>=2.0.0 <3.0.0' }
    ] } },
    { id: 'empty', name: 'Empty set', description: 'No supplied environment belongs to this empty set.', appliesTo: { all: [
      { field: 'environment', op: 'in', values: [] }
    ] } }
  ]
};
const cases = [
  { name: 'applicable', facts: { framework: 'acme', runtime: 'node', 'framework.version': '2.1.0' }, status: 'applicable' },
  { name: 'missing', facts: { framework: 'acme' }, status: 'unknown' },
  { name: 'invalid-version', facts: { framework: 'acme', runtime: 'node', 'framework.version': 2 }, status: 'unknown' },
  { name: 'wrong-type-and-missing', facts: { framework: 1 }, status: 'inapplicable' },
  { name: 'known-failure-first', facts: { framework: 'other' }, status: 'inapplicable' }
];
let graph;
try {
  graph = await CapabilityGraph.open({ providers: [{ definition }] });
  const results = {};
  for (const item of cases) {
    const result = await graph.getCapabilities({ ids: ['conditions::route'], context: { facts: item.facts } });
    assert.equal(result.items[0].applicability.status, item.status);
    results[item.name] = { input: { facts: item.facts }, result };
  }
  assert.deepEqual(results.missing.result.items[0].applicability.missingFacts, ['framework.version', 'runtime']);
  assert.deepEqual(results['invalid-version'].result.items[0].applicability.invalidFacts, ['framework.version']);
  assert.deepEqual(results['known-failure-first'].result.items[0].applicability.failedConditions, ['framework']);
  results['empty-in'] = await graph.getCapabilities({ ids: ['conditions::empty'], context: { facts: { environment: 'production' } } });
  assert.equal(results['empty-in'].items[0].applicability.status, 'inapplicable');
  try {
    await graph.resolve({ ids: ['conditions::route'], context: { facts: { framework: { name: 'acme' } } } });
    assert.fail('Nested facts must reject');
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    assert.equal(error.code, 'CG_CONTEXT_INVALID');
    results['illegal-structure'] = { code: error.code, phase: error.phase };
  }
  const invalidDefinition=structuredClone(definition);
  invalidDefinition.capabilities[0].appliesTo.all=[{field:'framework.version',op:'semverRange',range:'^2.0.0'}];
  await assert.rejects(CapabilityGraph.open({providers:[{definition:invalidDefinition}]}),error=>{
    assert(error instanceof GraphError);results['illegal-range']={code:error.code,phase:error.phase};return error.code==='CG_DEFINITION_INVALID';
  });
  console.log(JSON.stringify(results, null, 2));
} finally {
  await graph?.close();
}
```

</details>

下一步将可信事实传给resolve或match，不要由加载某Provider推测用户已使用该框架。`notes` 是模型参考文本，不能替代facts或扩大授权。
