# 第一个图谱

在你的应用里解析一个“带请求校验的 HTTP 接口”：它显式依赖请求 Schema。Graph 返回声明和依赖，应用负责真正注册路由。

先按[安装说明](/getting-started/installation)安装 `@devcodex/capability-graph`。以下命令在你的 `graph-demo/` 项目根目录执行，Node.js ≥22.12.0；无需模型、凭据或知识文件。首次使用推荐文件式，声明可单独维护；已有程序对象时可选后面的内联式。

## 1. 创建两项能力的声明

在项目根目录保存 `provider.json`：

<!-- example:examples/minimal/provider.json -->
```json title="provider.json"
{
  "providerId": "acme",
  "name": "Acme HTTP",
  "version": "1.0.0",
  "capabilities": [
    {
      "id": "route",
      "name": "Validated HTTP endpoint",
      "description": "Create an HTTP endpoint with request validation.",
      "whenToUse": "The application needs an HTTP endpoint with validated input.",
      "usage": { "instructions": "Declare the request schema, then register the endpoint." },
      "relations": { "requires": ["schema"] }
    },
    { "id": "schema", "name": "Request schema", "description": "Declare a schema to validate request input." }
  ]
}
```

`providerId` 标识来源，`version` 是作者声明的来源版本；`capabilities` 列出已有能力。能力必填 `id/name/description`。同一来源的依赖写局部 ID `schema`，对外查询则写完整 ID `acme::route`。`requires` 是本例作者的业务选择，不表示所有 HTTP 路由都需要校验。

`whenToUse` 说明适合的任务，`usage.instructions` 告诉使用者怎么用；它们均可省略。这里特意不给 `schema` 写 `usage`，后面会解释如何处理。`documents`、`appliesTo` 均非首次运行的前置条件；所有字段见 [Provider 声明](/guide/providers)。

## 2. 运行文件式解析

在同一目录保存 `static.mjs`。脚本从自己的位置读取 `provider.json`，因此以后从其他目录启动也能定位声明。成功时 stdout 只输出一个完整 JSON；已知 `GraphError` 写 stderr 并返回非零退出码，最后释放 Graph。

<!-- example:examples/minimal/static.mjs -->
```js title="static.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }]
  });
  const result = await graph.resolve({ ids: ['acme::route'] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

```sh
node static.mjs
```

| 参数或步骤 | 本例设置与含义 | 省略或替换时 |
| --- | --- | --- |
| `open.providers` | 一个文件来源；数组必填 | 可为 `[]`，此时没有能力可查 |
| `providers[].file` | `provider.json` 的绝对文件路径 | 与 `definition` 二选一；SDK 相对路径基于调用 `open` 时的 cwd |
| `allowedProviders` | 本例省略 | 允许全部已加载来源；`[]` 表示零授权 |
| `resolve.ids` | `['acme::route']`，用户选中的根能力 | 必填非空完整 ID 数组；不接受 `route` 这样的局部 ID |
| `resolve.relations` | 本例省略 | 默认 `['requires']`，展开依赖闭包；`[]` 只保留选中根 |
| `resolve.context` | 本例省略 | 无事实；本例无 `appliesTo`，节点判为 applicable |
| `model` | 未配置 | 静态解析无需模型；不会调用付费服务 |
| `close()` | `finally` 中调用 | 用完即关闭，关闭后不要继续查询 |

<details>
<summary>查看完整解析结果</summary>

以下为随包文件式示例的实际完整 stdout，未投影、未删字段。该稳定声明与内联版本输出相同；修改声明或授权后 Revision 可能改变，不要把这个哈希写死到业务代码。

```json
{
  "selected": [
    "acme::route"
  ],
  "nodes": [
    {
      "capability": {
        "id": "acme::route",
        "providerId": "acme",
        "name": "Validated HTTP endpoint",
        "description": "Create an HTTP endpoint with request validation.",
        "whenToUse": "The application needs an HTTP endpoint with validated input.",
        "usage": {
          "instructions": "Declare the request schema, then register the endpoint."
        },
        "relations": {
          "parents": [],
          "specializes": [],
          "related": [],
          "requires": [
            "acme::schema"
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
        "id": "acme::schema",
        "providerId": "acme",
        "name": "Request schema",
        "description": "Declare a schema to validate request input.",
        "relations": {
          "parents": [],
          "specializes": [],
          "related": [],
          "requires": []
        },
        "documents": []
      },
      "origin": "dependency",
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
      "from": "acme::route",
      "type": "requires",
      "to": "acme::schema"
    }
  ],
  "unresolved": [],
  "meta": {
    "revision": "sha256:be714d7dc37a706d72862ee2d485c7c127a9f684d8124796f4fc65e786a5285a",
    "completeness": "complete",
    "warnings": []
  }
}
```

`selected` 只有你请求的根，`nodes` 同时包含根及依赖。真正的能力 ID 在 `nodes[].capability.id`；`origin` 解释节点为何进入结果。`edges` 保留原始方向，`unresolved:[]` 表示没有未展开的目标，`meta.completeness` 为 `complete`。完整不等于已经执行或已具备运行条件；本例没有声明附加静态条件。

</details>

## 3. 使用结果，处理缺省说明

下面是结果消费片段：放在上面脚本取得 `result` 之后、`finally` 之前。它不是另一个独立脚本，且会增加 stdout 的人读信息。

```js
for (const { capability, origin, applicability } of result.nodes) {
  console.log(`${capability.id} (${origin}, ${applicability.status})`);
  console.log(capability.usage?.instructions ?? '该能力没有提供使用说明');
}
```

`schema` 没有 `usage`，可选链避免读取异常。不要把摘要对象当成原始 `ResolveResult`。进一步了解 [结果字段与下一步判断](/guide/results)，需要目录、详情或长文时再看[独立详情示例](/guide/results#读取目录详情与知识正文)。

## 4. 可选：将声明直接放进程序

已有内存对象时，在项目根目录保存 `inline.mjs` 并运行 `node inline.mjs`。它不读取 `provider.json` 或任何知识文件，直接将纯 JSON 对象交给 `definition`。下面是完整可运行脚本；调用和结果结构与文件式相同，选择其中一种即可。

<!-- example:examples/minimal/inline.mjs -->
```js title="inline.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';

const definition = {
  providerId: 'acme',
  name: 'Acme HTTP',
  version: '1.0.0',
  capabilities: [
    {
      id: 'route',
      name: 'Validated HTTP endpoint',
      description: 'Create an HTTP endpoint with request validation.',
      whenToUse: 'The application needs an HTTP endpoint with validated input.',
      usage: { instructions: 'Declare the request schema, then register the endpoint.' },
      relations: { requires: ['schema'] }
    },
    { id: 'schema', name: 'Request schema', description: 'Declare a schema to validate request input.' }
  ]
};

let graph;
try {
  graph = await CapabilityGraph.open({ providers: [{ definition }] });
  const result = await graph.resolve({ ids: ['acme::route'] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

文件与内联互斥，不能在同一个来源同时填写 `file` 和 `definition`。内联对象按值加载；后续改变原对象不会直接改变已发布快照，见[生命周期](/guide/lifecycle)。

## 5. 可选：用 CLI 检查同一份声明

在 `graph-demo/` 保存以下 `graph.config.json`。SDK 直接接收代码里的 options；CLI 读取这份独立 JSON 配置，相对文件路径以配置所在目录为准。

<!-- example:examples/minimal/graph.config.json -->
```json title="graph.config.json"
{
  "schemaVersion": 1,
  "providers": [{ "file": "./provider.json" }],
  "allowedProviders": ["acme"]
}
```

```sh
npx --no-install capability-graph validate --file provider.json
npx --no-install capability-graph doctor --config graph.config.json
```

`validate` 检查声明，`doctor` 检查配置和工具可用条件，均不调用模型。`schemaVersion:1` 是配置格式版本；`allowedProviders:['acme']` 显式授权该来源，不会执行其中能力。

如果出现 `CG_DEFINITION_INVALID`，检查声明字段、必填值、文件名与目录；`CG_CAPABILITY_NOT_FOUND` 时检查完整 ID。详细错误与下一步见[错误与恢复](/reference/errors)。

接下来按任务选择：[写自己的 Provider](/guide/providers)、[多个 Provider](/guide/relations)、[Codex 当前模型](/integrations/codex)，或[应用主动 match](/models/match)。
