# Capability Graph

Capability Graph 为 Provider 自有的 API、MCP 等接入提供协议无关的能力发现基础。Core 不执行第三方能力，也不提供统一 MCP Server 产品。

## 目录导航

- [当前状态](#status)
- [定义与接入](#integration)
- [查询与更新](#queries)
- [支持边界](#boundaries)
- [本地开发](#development)
- [未发布变更](changelogs/unreleased.md)
- [许可证](#license)

<a id="status"></a>

## 当前状态

仓库版本为 `0.0.0`，尚未发布 npm 包。主包只有 ESM 根入口，零运行时依赖；MCP 示例为独立私有包，不导出 `./mcp`。

已实现文件权威加载、校验、单 Provider 正式图、跨 Provider 联合目录、范围控制、修订快照、按需知识读取，以及可插拔的数据库、检索和 Runtime 合同。真实 Seed 同时提供普通 API 与 MCP 接入。

<a id="integration"></a>

## 定义与接入

Provider 在独立目录提供 `provider.json`、`*.capability.json` 和可选知识文件。Core 不导入业务源码，不执行能力，不自动推断图关系。可运行样本见 [Seed Provider](examples/seed-provider/PROVIDER.md)。

```json
{
  "capabilityId": "route.validation",
  "name": "Request validation",
  "description": "Validate input before a route handler runs.",
  "whenToUse": "A route needs a declared request contract.",
  "parents": ["route", "request"],
  "specializes": ["route.http"],
  "related": ["schema.request"],
  "knowledge": [{
    "kind": "document", "knowledgeId": "D-02",
    "locator": { "type": "relative-file", "path": "knowledge/route-validation.md" }
  }]
}
```

上述关系端点必须由同一 Provider 定义。`parents` 与 `specializes` 分别无环；`related` 有方向，不自动补正向对称边。能力 ID 不包含 Provider 前缀；完整身份为 `{ providerId, capabilityId }`，可逆显示形式为 `seed.http::route.validation`，不按点号猜边界。概念不兼容时由作者使用新 ID。

```ts
import { CapabilityGraph } from "@devcodex-labs/capability-graph";

const graph = await CapabilityGraph.open({
  hostAllowedProviders: ["seed.http"],
  integrationEnabledProviders: ["seed.http"],
  providers: [{
    providerId: "seed.http",
    authority: { kind: "file", rootDir: "/absolute/path/to/seed-provider" },
  }],
});
try {
  const provider = graph.forProvider("seed.http");
  const catalog = await provider.listCatalog({ limit: 20 });
  const requiredStaticRevision = catalog.meta.staticRevision;
  const detail = await provider.getCapabilities(["route.validation"], { requiredStaticRevision });
  const neighbors = await provider.getNeighbors("route.validation", { requiredStaticRevision });
  // Selection belongs to the caller; relations never select knowledge implicitly.
  const documents = await provider.readDocuments({
    selected: ["route.validation", "schema.request"], requiredStaticRevision,
  });
  console.log({ detail, neighbors, documents });
} finally {
  await graph.close();
}
```

必填范围与 `providers` 不能省略。显式空启用范围配合空 `providers` 是合法空配置；有效启用范围中的每个 Provider 必须恰有一个权威来源，缺少来源报 `CG_CONFIG_INCOMPLETE`，不能当成空目录。请求范围只能缩小宿主与集成配置的交集；各 Provider 独立修订，联合目录不产生跨 Provider 图边。

文件 `rootDir` 在 `open` 时解析为固定绝对根，后续工作目录变化不会重定位 `reload`。数据库 `knowledgeRootDir` 若为相对路径，在 Core 收到该只读视图时立即固定；current/previous 分别保留自己的根。知识 locator 仍是作者声明的相对路径，私有根不出现在公共结果或检索请求中。

文件模式从根目录的 `provider.json` 和递归的 `*.capability.json` 收集定义；任何层级均跳过目录 `.git`、`node_modules`、`dist`、`dist-test`、`coverage`、`.cache`、`.tmp`，按精确名称匹配。正式定义不要放在这些目录内；其他嵌套目录继续支持，不要求迁移到固定 `capabilities/` 布局。每个定义文件最多 262_144 UTF-8 字节，超限会在 JSON 解析前返回 `CG_BUDGET_EXCEEDED`。

<a id="queries"></a>

## 查询与更新

| 原语 | 用途 |
|---|---|
| `listProviders` / `getProvider` | Provider 元数据及其规范入口，不读取规范正文 |
| `listCatalog` | 平坦摘要；按范围、ID 前缀、显式 parent 过滤，支持分页 |
| `getCapabilities` / `getNeighbors` | 有界详情、六种正反向关系，不自动展开整图 |
| `readDocuments` | 仅读取所选能力声明的 Document，逐项返回成功或错误 |
| `retrieveCapabilities` | 显式调用已配置召回后端，Core 校验候选身份与修订 |
| `queryKnowledge` | 对已选知识执行检索，校验证据、内容版本与片段边界 |
| `queryRuntime` | 查询单 Provider、指定项目和环境下的运行实例 |

已知身份可直接查详情或读取，不强制从目录开始。第一轮目录只含能力摘要；后续选择和是否查询子能力由调用者决定。分页必须保留过滤条件及修订；检查 `meta.completeness`、`warnings` 和 `nextCursor`，不能把部分结果当成全集。批量结果保留输入槽位，逐项检查 `ok`。

`getProvider` 保留摘要顶层字段，同时返回 `meta`，默认调用与绑定调用都能查看 `servedFrom` 和 `refreshFailed`。来源只在实际读取时检查；无关 Provider 故障不阻断独立查询。未指定修订的混合详情/文档请求保留正常槽位与各项错误，指定修订失效仍明确失败。

能力召回同样隔离单个离线来源的候选；候选自己的旧修订进入 warning，指定权威视图不可读则整次失败，包括 Retriever 调用期间发生的失效。合法候选保留原始排名，不因其他项失败重排。

邻居默认单项上限 2048 字节、整页 24576 字节，可通过 `budgets.neighbors.maxItemBytes/maxBytes` 覆盖。超大项省略并标记 warning/partial，不截断描述；分页时将仍有 `nextCursor` 的关系组作为下一次 `kinds`，并传回对应 `cursors`，已经完成的组无需重复请求。元数据及所有游标也计入预算，无法取得任何进展时明确报超预算。

公开分页游标最多 32768 个 base64url 字符。Core 在最终编码后检查上限，Adapter 的游标或 Runtime 修订过长时先报 `CG_BUDGET_EXCEEDED`，不返回无法续查的游标；调用方输入超长游标仍报 `CG_INPUT_INVALID`。提高整页预算不放宽此上限。

知识检索的 `staticRevisionByProvider` 只覆盖最终选中并展开的 Knowledge targets 所属 Provider，检索证据必须匹配这个集合；无关 Provider 刷新不使本次知识证据失效。授权 `meta.scope` 不因此改变，能力召回仍以其自身查询范围为准。

作者修改正式定义后显式调用 `graph.reload({ providerId: "seed.http" })`。候选完整校验成功才替换对应视图；失败保留仍可读视图并标记 `refreshFailed`。Core 保留 current/previous，允许指定旧 `requiredStaticRevision`；更旧或不可读视图明确失败。知识正文不属于静态定义哈希，每次读取重新取得内容身份。Core 不监听文件、不定时刷新，不自动建立或更新外部索引；后端须在返回中提供符合当前静态修订及知识映射的证据，过期证据不会静默降级为全文读取。

`CG_REVISION_MISMATCH` 应刷新发现结果后重试；`CG_SCOPE_DENIED` 应修正范围；`CG_BUDGET_EXCEEDED` 应缩小请求或分页；`CG_RETRIEVER_UNCONFIGURED`、`CG_READER_UNCONFIGURED`、`CG_RUNTIME_DISABLED` 应显式配置对应实现，不代表没有知识或没有实例。调用 `close()` 释放权威视图句柄；来源故障不当作合法空结果。

知识选择全部失败时保留一致的原始错误类别；混合错误用 `CG_PARTIAL_ITEM` 和最多 20 条失败摘要说明，不统一改成未找到。句柄回收失败不覆盖业务结果；`close()` 以固定 `CG_LOAD_FAILED` 诊断汇总已知失败。若 close 时仍有查询持有旧视图，后续 close 可读取其延迟回收失败。

<a id="boundaries"></a>

## 支持边界

- 文件定义、本地 Document、普通 API 和私有 MCP 示例可直接运行。
- 数据库、两类检索与远程 Reader 提供公开合同和正负测试，不附真实数据库、向量/RAG 后端或 HTTP Reader；它们是后续迭代项。
- Runtime Core 已实现调度、观察状态与返回校验；[独立 HTTP 参考](examples/seed-runtime/README.md)实际采集应用注册路由，并验证项目环境隔离、实时变化和失败恢复。它不是通用框架扫描器或远程集群监控服务。
- Adapter 在调用进程内运行，属于显式信任代码；scope 不是进程沙箱。相对知识路径受根目录及真实路径约束，远程读取策略归已配置 Reader。
- [API 示例](examples/seed-api/README.md)与 [MCP 示例](examples/seed-mcp/README.md)共享 Core。工具命名、认证、宿主意图判断及规范采用归接入方，不属于主包。

<a id="development"></a>

## 本地开发

Node.js 范围：`^20.19.0 || >=22.12.0`。在仓库目录运行：

```sh
npm ci
npm test
npm run test:package
npm run evaluate
```

`npm test` 先构建和核对独立 TypeScript 消费者，再清理 `dist-test`、重新编译并发现测试；删除或重命名源码后不会继续执行旧测试输出。`test:package` 在无 dist 的源码副本中执行标准打包，并核对旧产物清理、预构建一致性、独立项目离线安装与类型，结束后清理临时文件，不执行发布。

只构建使用 `npm run build`，会清理仓库内 dist 后重新编译；标准 `npm pack` 的 prepack 自动执行同一构建，不能跳过脚本后假定产物仍然有效。构建产物位于 `dist/`，测试编译产物位于 `dist-test/`。CI 配置覆盖 Windows/Linux 与 Node 20.19.0、22.12.0，远端运行结果以实际 CI 为准。

`npm run build:tests` 单独清理并编译测试，`evaluate` 也使用此入口。根包及私有 MCP 示例的构建清理只接受已知、归当前包所有的输出目录，拒绝符号链接或普通文件，不跟随输出链接删除其他目录。

`evaluate` 使用明确期望的 Seed 任务记录正确性、遗漏、UTF-8 返回字节、调用数和本机耗时，不调用模型、不推断真实 Agent 准确率或节省比例。未配置检索后端的质量对照不适用。

### 代码约定

- 对外接口和 Adapter 合同使用 JSDoc，说明作用域、修订、错误、预算单位及资源所有权；不重复 TypeScript 已表达的类型。
- 关键算法注释解释校验顺序、生命周期和边界选择，行为修改时同步注释及回归测试，不按行数或注释比例验收。
- 区分候选失败与查询失败、超时与取消、观察为空与后端不可用。Adapter 错误不能带出内部路径；Core 公开诊断只保留明确投影的字段。
- 外部审查先复现再修复，异步错误包含严格拒绝模式及失败对照；最低 Node 版本、公开声明和实际安装包都需验证。测试 Fixture 不作为真实后端交付证据。

<a id="license"></a>

## 许可证

Apache-2.0
