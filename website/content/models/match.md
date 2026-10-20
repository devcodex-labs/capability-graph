# 匹配状态与结果处理

先决定由谁选择能力：已知ID直接resolve；已有MCP宿主通常使用当前模型选择；只有应用要主动提交自然语言时才配置ModelExecutor并调用match。

在[OpenAI](/models/openai)、[独立Codex CLI](/models/codex)或[自定义执行器](/models/custom)中选择一条配置路线。它们各有完整脚本和前置条件，本页重点处理共同的返回结果。固定状态演示不调用真实模型，不代表语义匹配算法或准确率。

已配置graph时，调用片段如下（graph的创建与关闭见对应接入页）：

```js
const result = await graph.match({
  input: '创建带请求校验的 Acme HTTP 接口',
  context: { facts: { framework: 'acme' } }
}, { timeoutMs: 60000 });
```

`input`是非空用户任务，`context`是显式事实和可选notes；可选`providers`只限制候选根。默认总deadline为60000毫秒，静态方法无需executor。一次match对非空授权候选目录调用一次select，不存在隐式关键词回退；实际token、费用和模型可用性由选定服务决定。


可注入任意符合接口的借用 executor：

```ts
interface ModelExecutor {
  readonly id: string;
  select(request: {
    input: string; context: MatchContext; catalog: readonly CatalogEntry[];
    revision: string; signal: AbortSignal;
  }): Promise<ModelSelection>;
}
```

请求 JSON 部分不可变；executor 不得依赖修改它或执行能力。返回 union：selected 需至少 1 个唯一候选 ID；none 的 ids 为 []；ambiguous 至少 2 个候选且必填 reason；needs_context 必填 reason 和非空 missingInformation，可带候选 IDs。不得返回目录外、重复或未授权 ID。内置适配器的线格式固定四个必填字段 decision/ids/reason（string|null）/missingInformation，再规范化为该公开 union。

match 返回 status 为 matched/no_match/ambiguous/needs_context，selection 含 ids/可选 reason/missingInformation；graph 按同一固定 Snapshot 执行默认 requires 解析，selection.ids 与 graph.selected 一致。多项都需要时是 matched，多项互斥选择才是 ambiguous。模型判断与节点 applicability 分别呈现，unknown 不被自动转成 needs_context。

默认 60000ms，允许 1–600000 的 timeoutMs，涵盖整次匹配。外部 signal、deadline、close 由首先观察到的终止决定；迟到成功被丢弃。不合作的外部 executor 也不会让 Graph 永久等待，但资源清理仍是该 executor 的责任。借用的 executor 不被 Graph.close 关闭。空候选在配置 executor 后直接 no_match，不调用模型；没有配置时仍报 CG_MODEL_NOT_CONFIGURED。

错误包括 CG_MODEL_NOT_CONFIGURED/UNAVAILABLE/EXECUTOR_UNSAFE/CONTEXT_EXCEEDED/OUTPUT_INVALID/OUTPUT_TOO_LARGE/REFUSED/TIMEOUT/CANCELLED。OpenAI API 凭据与 Codex CLI 网页授权分别配置，运行条件见[版本与兼容](/resources/compatibility)。


## 先处理四种业务状态

| status | 意义 | 应用接下来做什么 |
| --- | --- | --- |
| matched | 模型认为这些能力共同符合任务 | 再检查节点适用性和依赖完整度，展示说明 |
| no_match | 目录里没有合适选择 | 改述任务或补正确来源；不当网络/认证故障 |
| ambiguous | 多个互斥候选缺乏选择依据 | 展示候选和reason，让用户决定；graph.selected是待决候选根 |
| needs_context | 需要补充任务材料 | 展示missingInformation，取得可信信息后重新match |

多根可以共同需要，因此selected有多个ID不自动等于ambiguous。认证、超时、拒绝、非法输出或越权ID是错误，不伪装no_match。

下面是取得result后的消费片段，结果显示在控制台，业务执行仍由你的应用单独决定：

```js
switch (result.status) {
  case 'matched': {
    const unknown = result.graph.nodes.filter(node => node.applicability.status === 'unknown');
    const inapplicable = result.graph.nodes.filter(node => node.applicability.status === 'inapplicable');
    console.log('选中：', result.selection.ids);
    if (unknown.length) console.log('待补事实：', unknown.map(node => node.applicability));
    if (inapplicable.length) console.log('当前条件不满足：', inapplicable.map(node => node.capability.id));
    if (result.graph.meta.completeness === 'partial') console.log('待查依赖：', result.graph.unresolved);
    console.log('完整图谱：', result.graph);
    break;
  }
  case 'no_match':
    console.log('没有合适能力，请检查任务描述与已配置来源');
    break;
  case 'ambiguous':
    console.log('请先选择方案：', result.selection.ids, result.selection.reason);
    break;
  case 'needs_context':
    console.log('请补充材料：', result.selection.missingInformation, result.selection.reason);
    break;
}
```

## 三个维度可以组合

| 例子 | 模型status | 静态节点 | 关系完整度 | 处理建议 |
| --- | --- | --- | --- | --- |
| 模型选中，但缺framework事实 | matched | unknown | complete | 补可信facts；模型状态不会自动改为needs_context |
| 模型选中，但framework明确不符 | matched | inapplicable | complete | 向用户说明冲突，修正输入或改选能力 |
| 模型选中，必要来源未加载或无权访问 | matched | 可为applicable/unknown | partial | 检查unresolved及自己掌握的配置，不执行缺失前置 |

complete/applicable仍不证明软件已安装、运行成功、具备执行授权或应该按节点排序执行。Graph只检验声明、授权和显式条件，不能保证模型语义选择正确。

## 四状态完整结果与可运行演示

按[运行示例](/examples/index)安装并复制后运行 `node examples/scenarios/match.mjs`。这个受控executor固定返回四种合法ModelSelection，只用于可复现的结果教学；不联网、不消耗模型额度，也不能用作生产匹配器。

脚本stdout为各用例完整结果。下面四个值为实际原结果，没有删掉graph或伪造哈希；其他键还会验证三个组合、空目录与未配置差异。

<details>
<summary>展开四种匹配状态的完整JSON</summary>

```json
{
  "matched": {
    "status": "matched",
    "selection": {
      "ids": [
        "a::route"
      ],
      "missingInformation": []
    },
    "graph": {
      "selected": [
        "a::route"
      ],
      "nodes": [
        {
          "capability": {
            "id": "a::route",
            "providerId": "a",
            "name": "Route",
            "description": "An Acme route.",
            "appliesTo": {
              "all": [
                {
                  "field": "framework",
                  "op": "eq",
                  "value": "acme"
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
          "origin": "selected",
          "applicability": {
            "status": "applicable",
            "missingFacts": [],
            "invalidFacts": [],
            "failedConditions": []
          }
        }
      ],
      "edges": [],
      "unresolved": [],
      "meta": {
        "revision": "sha256:0f31334e14a841bc8366c520ef94d8853507b65dac11919963d2f7316c229f9d",
        "completeness": "complete",
        "warnings": []
      }
    }
  },
  "no_match": {
    "status": "no_match",
    "selection": {
      "ids": [],
      "reason": "No declared capability fits.",
      "missingInformation": []
    },
    "graph": {
      "selected": [],
      "nodes": [],
      "edges": [],
      "unresolved": [],
      "meta": {
        "revision": "sha256:0f31334e14a841bc8366c520ef94d8853507b65dac11919963d2f7316c229f9d",
        "completeness": "complete",
        "warnings": []
      }
    }
  },
  "ambiguous": {
    "status": "ambiguous",
    "selection": {
      "ids": [
        "a::route",
        "a::alternative"
      ],
      "reason": "Choose one implementation.",
      "missingInformation": []
    },
    "graph": {
      "selected": [
        "a::route",
        "a::alternative"
      ],
      "nodes": [
        {
          "capability": {
            "id": "a::alternative",
            "providerId": "a",
            "name": "Alternative",
            "description": "A different implementation.",
            "relations": {
              "parents": [],
              "specializes": [],
              "related": [],
              "requires": []
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
            "name": "Route",
            "description": "An Acme route.",
            "appliesTo": {
              "all": [
                {
                  "field": "framework",
                  "op": "eq",
                  "value": "acme"
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
          "origin": "selected",
          "applicability": {
            "status": "applicable",
            "missingFacts": [],
            "invalidFacts": [],
            "failedConditions": []
          }
        }
      ],
      "edges": [],
      "unresolved": [],
      "meta": {
        "revision": "sha256:0f31334e14a841bc8366c520ef94d8853507b65dac11919963d2f7316c229f9d",
        "completeness": "complete",
        "warnings": []
      }
    }
  },
  "needs_context": {
    "status": "needs_context",
    "selection": {
      "ids": [
        "a::route"
      ],
      "reason": "Confirm the framework.",
      "missingInformation": [
        "framework"
      ]
    },
    "graph": {
      "selected": [
        "a::route"
      ],
      "nodes": [
        {
          "capability": {
            "id": "a::route",
            "providerId": "a",
            "name": "Route",
            "description": "An Acme route.",
            "appliesTo": {
              "all": [
                {
                  "field": "framework",
                  "op": "eq",
                  "value": "acme"
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
          "origin": "selected",
          "applicability": {
            "status": "applicable",
            "missingFacts": [],
            "invalidFacts": [],
            "failedConditions": []
          }
        }
      ],
      "edges": [],
      "unresolved": [],
      "meta": {
        "revision": "sha256:0f31334e14a841bc8366c520ef94d8853507b65dac11919963d2f7316c229f9d",
        "completeness": "complete",
        "warnings": []
      }
    }
  }
}
```

</details>

<details>
<summary>查看完整受控演示脚本与断言</summary>

<!-- example:examples/scenarios/match.mjs -->
```js title="match.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import assert from 'node:assert/strict';

// Fixed selections demonstrate result handling only; this is not an AI matcher.
const definition = {
  providerId: 'a', name: 'State demonstration', version: '1', capabilities: [
    { id: 'route', name: 'Route', description: 'An Acme route.', appliesTo: { all: [{ field: 'framework', op: 'eq', value: 'acme' }] } },
    { id: 'alternative', name: 'Alternative', description: 'A different implementation.' }
  ]
};
const selections = {
  matched: { decision: 'selected', ids: ['a::route'] },
  no_match: { decision: 'none', ids: [], reason: 'No declared capability fits.' },
  ambiguous: { decision: 'ambiguous', ids: ['a::route', 'a::alternative'], reason: 'Choose one implementation.' },
  needs_context: { decision: 'needs_context', ids: ['a::route'], reason: 'Confirm the framework.', missingInformation: ['framework'] }
};
const output = {};
for (const [status, selection] of Object.entries(selections)) {
  const model = { id: 'fixed-state-demo', async select() { return selection; } };
  const graph = await CapabilityGraph.open({ providers: [{ definition }], model });
  try {
    output[status] = await graph.match({ input: 'Demonstrate this state', context: { facts: { framework: 'acme' } } });
    assert.equal(output[status].status, status);
  } finally { await graph.close(); }
}
for (const [name, context] of [['unknown', {}], ['inapplicable', { facts: { framework: 'other' } }]]) {
  const graph = await CapabilityGraph.open({ providers: [{ definition }], model: { id: 'fixed-state-demo', async select() { return selections.matched; } } });
  try {
    const result = await graph.match({ input: 'Demonstrate independent dimensions', context });
    assert.equal(result.status, 'matched');assert.equal(result.graph.nodes[0].applicability.status, name);
    output[`matched-${name}`] = result;
  } finally { await graph.close(); }
}
const partialDefinition = structuredClone(definition);
partialDefinition.capabilities[0].relations = { requires: ['unloaded::schema'] };
const partial = await CapabilityGraph.open({ providers: [{ definition: partialDefinition }], model: { id: 'fixed-state-demo', async select() { return selections.matched; } } });
try {
  output['matched-partial'] = await partial.match({ input: 'Demonstrate an unavailable dependency' });
  assert.equal(output['matched-partial'].status, 'matched');assert.equal(output['matched-partial'].graph.meta.completeness, 'partial');
} finally { await partial.close(); }
let calls = 0;
const empty = await CapabilityGraph.open({ providers: [], model: { id: 'must-not-run', async select() { calls++;throw new Error('Empty catalog must skip selection'); } } });
try { output.empty = await empty.match({ input: 'No candidates' });assert.equal(output.empty.status, 'no_match');assert.equal(calls, 0); }
finally { await empty.close(); }
const unconfigured = await CapabilityGraph.open({ providers: [] });
try {
  await assert.rejects(unconfigured.match({ input: 'No executor configured' }), error => {
    assert(error instanceof GraphError);assert.equal(error.code, 'CG_MODEL_NOT_CONFIGURED');
    output.unconfigured = { code: error.code, phase: error.phase };return true;
  });
} finally { await unconfigured.close(); }
console.log(JSON.stringify(output, null, 2));
```

</details>

## 区分空目录和未配置

- 有executor而授权候选目录为空：直接no_match，select不被调用，避免无用模型请求。
- 没有executor：即使目录为空仍为CG_MODEL_NOT_CONFIGURED/match，配置正确模型后再主动匹配。
- 模型技术失败：按GraphError.code/phase处理，不能替换成空结果。

超时、取消和close是独立终止路径，详见[生命周期](/guide/lifecycle)。模型只收到input、Context、授权精简Catalog和revision，不自动读取本地知识正文。
