# SDK 与 JSON 声明

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

Provider 必填 `providerId/name/version/capabilities`，可选 `schemaVersion:1`、`description`。Capability 必填局部 `id/name/description`，可选 `whenToUse/usage/appliesTo/relations/documents`。Provider 和局部 Capability ID 满足 `^[a-z][a-z0-9._-]{0,127}$`，公开查询用完整 `providerId::capabilityId`。version 是声明版本，与逻辑 ID 和 Graph Revision 独立。

`usage` 可含 instructions/input/output 字符串、examples 字符串数组、`contract:{format,uri}`；format 为 openapi/mcp-tool/json-schema/other，URI 为绝对 HTTPS 或 URN。它们是使用说明，不是可执行回调。内联输入只接受纯 JSON：拒绝 Proxy、getter、toJSON、循环、非有限数、稀疏数组和特殊原型，不执行这些输入上的用户函数。

关系只允许四类正向声明：parents、specializes、related、requires，每项为 ID 数组。根入口导出 `CapabilityRelations = Partial<Record<ForwardRelationKind, string[]>>` 类型。同 Provider 可用局部 ID，跨 Provider 必须完整 ID。每类 parents/specializes/requires 图单独禁止环，related 可以有环。已加载目标不存在会加载失败；未加载外部目标允许保留引用。反向 children/specializedBy/relatedBy/requiredBy 由索引产生，不写入 Provider。

| 调用 | 输入与结果 |
| --- | --- |
| `listProviders({providers?}?)` | 完整授权 Provider 摘要，包括 capabilityCount；`items/meta` |
| `listCatalog({providers?}?)` | 完整精简目录；仅 id/providerId/name/description/whenToUse/appliesTo |
| `getCapabilities({ids,context?})` | `items:[{capability,applicability}]`，完整 usage、四类关系和文档引用 |
| `resolve({ids,context?,relations?})` | `selected/nodes/edges/unresolved/meta` |
| `readDocument({capabilityId,documentId})` | 声明的本地 UTF-8 内容及原始字节数/哈希 |
| `match({input,context?,providers?},{signal?,timeoutMs?}?)` | 一次模型选择和同一快照的 resolve，见[模型匹配](/models/match) |
| `reload({providerId?}?)` | `{ok,revision,providers,error?}`，全局原子发布 |
| `close()` | 幂等；拒绝新工作，取消活动 match，借用的 executor 不会关闭 |

普通查询 ids 非空，重复按首次出现去重；任一显式根错误或越权整次失败。显式 `providers:[]` 返回完整空目录。结果为独立 JSON 值，修改输入或结果不会影响私有 Snapshot。完整目录没有搜索、排序选项、隐式分页或截断。

resolve 默认 relations 为 `['requires']`，只展开根节点的 requires 传递闭包。显式 `[]` 只返回根。其余关系从根一跳，不自动展开所到关联节点的依赖。selected 保留输入次序，nodes/edges/unresolved 稳定排序去重，节点 origin 优先级 selected > dependency > relation。所有边保留原始正向方向。不可展开的外部正向目标进入 unresolved，reason 为通用 target_unavailable，completeness 为 partial。隐藏未授权反向来源不会引入计数、告警或 partial。

relations 缺省只指省略或 undefined，显式 null/非数组报 CG_INPUT_INVALID。match 的 timeoutMs 同样不接受 null，非法值在调用 executor 前失败。MCP HTTP 配置只对省略项采用默认值，null、错误容器或非法端点/认证/预算报 CG_CONFIG_INVALID。

Context 示例：

```json
{
  "facts": { "framework": "vextjs", "framework.version": "2.0.0", "production": true },
  "notes": "A description for the selecting model"
}
```

facts 是平面映射；键中的点是字面字符，不读取嵌套对象。值只能是有限 number/string/boolean，不接受 null。notes 不参与确定性 applicability。`appliesTo:{all:[...]}` 支持严格同类型 eq、in 和稳定 SemVer 的 semverRange。缺少规则/空 all 为 applicable。条件已知不满足优先于缺失信息；否则缺失或非法事实为 unknown，分别返回 missingFacts/invalidFacts/failedConditions。节点不会因不适用或未知而被删去。

SemVer 只支持稳定 `major.minor.patch`，范围为精确版本或由空格连接的 `=/>/>=/</<=` 比较式，例如 `>=2.0.0 <3.0.0`。不支持 `^/~/*/||`、预发布、build metadata 和前导零。空 in 数组合法，对已提供的事实均不满足。

每个静态结果的 meta 含授权视图的 `sha256:` revision、completeness 和 warnings。Revision 对规范化静态定义计算，不包含文件绝对路径、文档正文、当前 Context、模型状态；有序 examples 不被排序，能力及关系集合稳定规范化。隐藏 Provider 更新不改变授权视图 Revision。它不是跨请求的锁：目录和 resolve 若返回不同 Revision，宿主应刷新重新选择。

reload 串行处理，从新读取文件或既有内联副本构建候选。全部验证通过才发布；任何来源或合并图失败都保留旧 Snapshot。各 Provider 状态为 updated/unchanged/failed/not_applied：独立来源失败标 failed，可读取但没提交的新定义标 not_applied，内容相同保持 unchanged。Provider 身份不能通过 reload 改变。返回只包含授权 Provider 状态。close 后不得提交新快照；已开始的静态操作可按其固定快照完成。

所有默认预算是 UTF-8 字节：Provider/Catalog/Result/ModelCatalog 各 8 MiB，Document 1 MiB，input/ModelOutput 各 64 KiB，Context 128 KiB。可信宿主可通过 `limits` 的 maxProviderBytes/maxCatalogBytes/maxResultBytes/maxDocumentBytes/maxInputBytes/maxContextBytes/maxModelCatalogBytes/maxModelOutputBytes 设置正安全整数。超限显式错误，不删减数据伪装完整。

文档声明示例：`{id:'guide',source:{type:'file',path:'guide.md'}}`，或 source 为 `{type:'url',url:'https://example.com/guide'}`。document ID 在所属能力内唯一，可用中文；只通过 ID 读取，不能传任意路径。URL 仅引用，readDocument 返回 CG_DOCUMENT_REFERENCE_ONLY，不进行网络请求。byteLength/contentHash 基于原始字节，text 去除 UTF-8 BOM，保留 CRLF；正文变化不改变静态 Revision。文件安全前提见[安全边界](/resources/security)。

SDK 抛出 `GraphError`，稳定字段 code/phase/message/可选 nextAction，可用 `toJSON()`。常用 code 包括 CG_CONFIG_INVALID、CG_DEFINITION_INVALID、CG_CONTEXT_INVALID、CG_INPUT_INVALID、CG_ACCESS_DENIED、CG_PROVIDER_NOT_FOUND、CG_CAPABILITY_NOT_FOUND、CG_CATALOG_TOO_LARGE、CG_RESULT_TOO_LARGE、CG_GRAPH_CLOSED 和文档/模型错误。phase 为 config/load/query/match/document/lifecycle；不要通过 message 推断分支或解析原始异常。Tool Adapter 返回相同错误 JSON；MCP 执行错误放 isError 文本内容，只有成功才有符合 outputSchema 的 structuredContent。


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
| ApplicabilityResult | status 为 applicable/inapplicable/unknown；missingFacts/invalidFacts 列事实字段，failedConditions 列失败规则；不删除节点 |
| ResolveResult | selected 保留根输入顺序；nodes 为完整节点；edges 保留正向边；unresolved 为未展开引用；meta 表达完整性与 Revision |
| ResolvedNode | capability 是详情；applicability 为确定性条件结果；origin 为 selected/dependency/relation |
| RelationEdge | from/to 为完整 ID，type 为四类正向关系；反向遍历的输出仍保留原始边方向 |
| UnresolvedEdge | RelationEdge 加 reason:'target_unavailable'；不区分目标未加载与无权限 |
| MatchResult | status 四类业务状态；selection.ids/reason?/missingInformation；graph 是同一固定快照解析结果，根与 selection.ids 一致 |
| ReloadResult | ok 表示是否全部发布；revision 为发布后或保留的授权 Revision；providers 每项 providerId/status/error?；error 为安全顶层失败摘要 |
| DocumentReadResult | source 为已声明 file；text 去 BOM、保留换行；byteLength 为原始字节，contentHash 为原始字节 sha256；meta 不以文档正文作静态 Revision |
| GraphErrorShape | code/phase/message/可选 nextAction；不要从自然语言 message 判断分支 |

完整类型与联合类型见[公开类型](/reference/types)，各错误见[错误参考](/reference/errors)。
