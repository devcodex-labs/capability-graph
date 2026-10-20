# 读取解析结果

解析结果用于回答“选中了什么、为什么带上这些能力、哪些条件还没满足”。Graph 不执行结果里的能力；由应用决定展示说明、补充事实、加载缺失来源或交给实际框架处理。

先运行[第一个图谱](/getting-started/quick-start)，该页保留文件式与内联式的真实完整 JSON。这里解释如何消费，不改变 API 的返回结构。

## 按顺序读结果

| 字段 | 用来判断什么 | 本例与下一步 |
| --- | --- | --- |
| `selected` | 本次显式请求的根 ID，去重并保留顺序 | `acme::route`；不会自动把依赖写进 selected |
| `nodes[].capability` | 完整能力详情，含来源、说明、关系和文档引用 | ID 在 `capability.id`；不是 `nodes[].id` |
| `nodes[].origin` | 为什么进入结果 | `selected` 是根、`dependency` 是依赖、`relation` 是其他关系到达的节点 |
| `nodes[].applicability.status` | 显式 Context 是否满足静态条件 | applicable / inapplicable / unknown；不是执行成功状态 |
| `missingFacts` / `invalidFacts` / `failedConditions` | 条件判断涉及的字段名数组 | 缺失事实应由可信来源补充；不是模型猜测值或错误对象 |
| `edges` | 展开的边，`from/type/to` 保持声明正向 | 即使反向查询，边也不倒转 |
| `unresolved` | 无法展开的关系目标及原因 | `target_unavailable` 不区分未加载与无权访问；检查自己的配置授权 |
| `meta.revision` | 这次结果的静态授权视图标识 | 用于对照两次查询；不代表包版本或正文内容哈希 |
| `meta.completeness` | 请求的关系是否完整展开 | complete / partial；partial 时检查 unresolved 和 warnings |
| `meta.warnings` | 需要调用方关注的诊断 | 空数组不证明具备实际执行能力 |

`capability.relations` 是能力本身声明的关系，`edges` 是本次请求实际展开的边。指定 `relations:[]` 时，节点仍可保留声明的 requires，但不会展开依赖，不能靠节点的关系字段推断本次子图内容。

## 安全读取可选说明

以下片段的 `result` 来自 `await graph.resolve(...)`。将它放在已打开 Graph 的脚本中，不要当独立程序运行：

```js
for (const { capability, origin, applicability } of result.nodes) {
  const instructions = capability.usage?.instructions;
  console.log(`${capability.id} (${origin}, ${applicability.status})`);
  console.log(instructions ?? '该能力没有提供使用说明');
}
```

没有 `usage` 或 `usage.instructions` 是合法声明。可以展示 ID、名称和描述，提示作者补说明；不要直接访问 `capability.usage.instructions`，也不要虚构执行代码。条件为 unknown 时补事实，inapplicable 时重新选择；二者与依赖是否完整是不同维度，见[Context](/guide/context)和[关系](/guide/relations)。

需要展示输入、输出、示例及契约时，可在同一循环中继续读取：

```js
const usage = capability.usage;
console.log('输入：', usage?.input ?? '作者未提供输入说明');
console.log('输出：', usage?.output ?? '作者未提供输出说明');
for (const example of usage?.examples ?? []) console.log('示例：', example);
if (usage?.contract) {
  console.log('已有契约：', usage.contract.format, usage.contract.uri);
}
```

这里的capability仍来自上面循环，不是未定义的全局变量。examples缺省按空数组处理；contract只展示引用，不代表Graph自动获取或执行契约。可校验的完整usage声明见[编写Provider](/guide/providers)。

## 读取目录、详情与知识正文

最小示例没有知识文件。需要列目录、拿说明、按声明 ID 读取长文时，运行独立的 `details.mjs`。

前提：在你的 ESM 项目安装 `@devcodex/capability-graph`，完整复制包内 `examples/`（[复制方法](/examples/index)）。保留下面三份文件的相对位置，命令在项目根目录执行：

```text
examples/minimal/
├── details.mjs
├── details.provider.json
└── knowledge/guide.md
```

`details.provider.json` 在最小两节点声明上增加 `documents`，引用同目录下的 `knowledge/guide.md`；该文件随示例分发。这些是说明性示例，不会注册真实 HTTP 路由。

<!-- example:examples/minimal/details.mjs -->
```js title="details.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./details.provider.json', import.meta.url)) }]
  });
  const catalog = await graph.listCatalog();
  const details = await graph.getCapabilities({ ids: ['acme::route'] });
  const document = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' });
  console.log(JSON.stringify({ catalog, details, document }, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

```sh
node examples/minimal/details.mjs
```

stdout 是一个完整对象 `{catalog, details, document}`，三个值分别为 API 原结果，没有摘要投影。

| 调用 | 参数与用途 | 返回什么 |
| --- | --- | --- |
| `listCatalog()` | 本例无参数，列出授权来源的精简目录 | `catalog.items` 的完整 ID、名称、描述等；不附知识正文 |
| `getCapabilities({ids})` | `ids:['acme::route']`，读取选定能力详情 | `details.items[].capability` 含 usage、四关系与文档引用；另有 applicability |
| `readDocument({capabilityId,documentId})` | `acme::route` + `guide`，必须是已声明的 ID | `document.text`、原始字节长度 `byteLength`、`contentHash`、来源与 meta |

本例应返回两项目录、一项详情及 `guide` 正文。`file` 来源自动以声明文件所在目录为文档根；无需为文件式另设 `documentRoot`。缺文件在真正读取时失败，URL 引用不会自动联网；完整根目录、安全边界、编码与哈希语义见[关联知识文件](/guide/documents)。

## 继续处理模型结果

`match()` 的 `graph` 也是同一种 `ResolveResult`；外层还有模型选择状态 `status` 和 `selection`。先区分模型业务状态、节点适用性和关系完整度，不能把 `matched` 直接等同可以执行。见[匹配与结果处理](/models/match)。
