# SDK 方法与结果

根入口导出 `CapabilityGraph`、`GraphError` 和公开类型。完整字段见随包 `.d.ts`；未知 JSON 字段被拒绝，不隐式修正定义。

```ts
const graph = await CapabilityGraph.open({
  providers: [
    { file: './provider.json' },
    { definition: { providerId: 'extra', name: 'Extra', version: '1', capabilities: [] } }
  ],
  allowedProviders: ['acme', 'extra']
});
```

`providers` 必填，可为 `[]`。每项只能是 file 或 definition；file 文档根固定为 JSON 文件目录，不再接受 documentRoot。内联定义按值加载，只有声明本地文档时才需要显式可信根。SDK 相对路径按 open 当时 cwd 固定，CLI 相对路径按配置文件目录固定。授权缺省为全部已加载 Provider；显式 `[]` 不授权任何 Provider。查询只能缩小授权，不能扩大。

具体声明与语义按用户任务查阅：[编写Provider](/guide/providers)、[关系与授权](/guide/relations)、[Context](/guide/context)、[文档根与正文](/guide/documents)、[快照与更新](/guide/lifecycle)、[匹配状态](/models/match)。参考页不重复整条教程；以下固定参数、返回和错误契约。

普通查询的显式ids必须非空完整ID，按首次出现去重；任一根错误或越权整次reject。providers可选范围不能扩权。结果是独立JSON副本，完整目录不带搜索、分页或静默截断。预算与省略/null/[]差异在[配置参考](/reference/configuration#省略undefinednull与空数组)。

普通SDK方法返回Promise并可能reject GraphError（code/phase/message/可选nextAction），不要按message分支。reload候选失败通常resolve为ok:false，须检查顶层ok；close取消活动match的错误为CG_GRAPH_CLOSED/lifecycle。


## open 与每个方法的使用约定

以下方法都是异步。open 加载失败不产生可用实例；普通查询 reject GraphError。reload 的候选失败以 ok:false 及旧 revision 返回，不能只靠 Promise 成功判断发布成功。close 幂等。

| 方法 | 参数默认值、结果字段与特殊情况 |
| --- | --- |
| CapabilityGraph.open(options) | providers 必填，可为空；allowedProviders 省略为已加载全部，[] 为零授权；model 省略不影响静态查询；limits 覆盖默认预算。返回 Graph |
| listProviders(query?) | query 省略为全部授权 Provider；query.providers 仅缩小集合。返回 items/meta；每项 providerId/name/version/可选 description/capabilityCount |
| listCatalog(query?) | query 同上；返回完整精简 items/meta。项为 id/providerId/name/description/可选 whenToUse/appliesTo，没有 usage、关系或文档正文 |
| getCapabilities({ids,context?}) | ids 非空，完整 ID；返回 items[{capability,applicability}]/meta。详情包括归一化四类正向关系与 documents；不自动读正文 |
| resolve({ids,context?,relations?}) | 默认 requires 传递闭包，[] 仅根。返回 selected/nodes/edges/unresolved/meta；origin、applicability 和 completeness 分别表达不同事实 |
| readDocument({capabilityId,documentId}) | 两个必填 ID；返回 capabilityId/documentId/source/text/byteLength/contentHash/meta；URL 引用不抓取 |
| match(query,options?) | input 必填；context/providers 可选；options 为 signal/timeoutMs。返回 status/selection/graph；详情见模型页 |
| reload({providerId?}?) | 省略则重读全部配置来源；指定已有 Provider 只重读该项但整体校验后一次发布；返回 ok/revision/providers/可选 error |
| close() | 返回 void；拒绝新操作，取消活动 match；不关闭调用方借用的 executor |

## 返回对象字段

| 对象 | 字段含义 |
| --- | --- |
| ResultMeta | revision 是授权静态视图哈希；completeness 为 complete/partial；warnings 是 code/message 数组 |
| CapabilityDetail | Catalog 字段 + usage + 完整 relations + documents。id 已是完整 ID，documents 仍为引用 |
| ApplicabilityResult | status 为 applicable/inapplicable/unknown；missingFacts/invalidFacts/failedConditions均为去重排序的事实字段名数组；不删除节点 |
| ResolveResult | selected 保留根输入顺序；nodes 为完整节点；edges 保留正向边；unresolved 为未展开引用；meta 表达完整性与 Revision |
| ResolvedNode | capability 是详情；applicability 为确定性条件结果；origin 为 selected/dependency/relation |
| RelationEdge | from/to 为完整 ID，type 为四类正向关系；反向遍历的输出仍保留原始边方向 |
| UnresolvedEdge | RelationEdge 加 reason:'target_unavailable'；不区分目标未加载与无权限 |
| MatchResult | status 四类业务状态；selection.ids/reason?/missingInformation；graph 是同一固定快照解析结果，根与 selection.ids 一致 |
| ReloadResult | ok 表示是否全部发布；revision 为发布后或保留的授权 Revision；providers 每项 providerId/status/error?；error 为安全顶层失败摘要 |
| DocumentReadResult | source 为已声明 file；text 去 BOM、保留换行；byteLength 为原始字节，contentHash 为原始字节 sha256；meta 不以文档正文作静态 Revision |
| GraphErrorShape | code/phase/message/可选 nextAction；不要从自然语言 message 判断分支 |

完整类型与联合类型见[公开类型](/reference/types)，各错误见[错误参考](/reference/errors)。

## 按方法定位

下面每个签名均为异步；短例中的graph来自open，并应在外层finally关闭。readDocument例子需要[带文档的来源](/guide/results#读取目录详情与知识正文)，不能直接用于无文档的最小声明。参数类型的完整定义见[公开类型](/reference/types)，具体错误见[错误与恢复](/reference/errors)。

### open

```ts
static open(options: OpenOptions): Promise<CapabilityGraph>
```

providers必填，可空；file/definition二选一，路径基于open当时cwd。allowedProviders省略授权全部已加载，[]零授权；model可省略。

加载/配置错误异步reject；成功才得到实例。

```js
const graph = await CapabilityGraph.open({ providers: [{ file: './provider.json' }] });
```

### listProviders

```ts
listProviders(query?: { providers?: string[] }): Promise<ProviderListResult>
```

query/providers省略为全部授权来源，[]返回完整空列表。

items含来源摘要与capabilityCount，meta为当前授权视图；越权范围整次失败。

```js
const result = await graph.listProviders({ providers: ['acme'] });
```

### listCatalog

```ts
listCatalog(query?: { providers?: string[] }): Promise<CatalogResult>
```

范围同listProviders，按完整ID稳定排序，不支持搜索或隐式分页。

items只有CatalogEntry字段，超maxCatalogBytes或maxResultBytes明确reject；不提前读usage/正文。

```js
const result = await graph.listCatalog();
```

### getCapabilities

```ts
getCapabilities(query: { ids: string[]; context?: MatchContext }): Promise<CapabilityDetailResult>
```

ids非空完整ID数组，去重保序；context省略为空事实。

items[{capability,applicability}]/meta；返回详情和引用，保留unknown/inapplicable，显式根不存在/越权整次reject。

```js
const result = await graph.getCapabilities({ ids: ['acme::route'] });
```

### resolve

```ts
resolve(query: { ids: string[]; context?: MatchContext; relations?: RelationKind[] }): Promise<ResolveResult>
```

ids规则同上；relations省略/undefined默认为['requires']，[]仅根，null非法。

selected/nodes/edges/unresolved/meta；完整示例及消费见结果指南；partial是正常结果，不是抛错。

```js
const result = await graph.resolve({ ids: ['acme::route'], relations: [] });
```

### readDocument

```ts
readDocument(query: { capabilityId: string; documentId: string }): Promise<DocumentReadResult>
```

两个声明ID必填，不接收任意路径。

source/text/byteLength/contentHash/meta及两ID；URL只引用，缺根/文件/编码/预算在对应阶段reject。

```js
const result = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' });
```

### match

```ts
match(query: MatchQuery, options?: MatchOptions): Promise<MatchResult>
```

input非空；context/providers可选；timeoutMs默认60000、整数1～600000毫秒，signal为AbortSignal。

status/selection/graph；配置executor后才可调用，空候选不调用select；业务状态与技术错误分开。

```js
const result = await graph.match({ input: '创建接口' }, { timeoutMs: 60000 });
```

### reload

```ts
reload(query?: { providerId?: string }): Promise<ReloadResult>
```

省略重读所有已配置来源，指定已有providerId只重读该项但整体校验。

ok/revision/providers/error?；候选错误正常返回ok:false，旧快照保留。非法参数/关闭实例仍可能reject。

```js
const update = await graph.reload();
if (!update.ok) console.error(update.error, update.providers);
```

### close

```ts
close(): Promise<void>
```

无参数，幂等。

拒绝新工作，取消活动match；不销毁借用executor。应用先关服务/连接，再关Graph。

```js
await graph.close();
```
