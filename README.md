# Capability Graph

Capability Graph 为 Provider 自有的 API、MCP 等接入提供协议无关的能力发现基础。Core 不执行第三方能力，也不提供统一 MCP Server 产品。

## 目录导航

- [当前状态](#status)
- [定义与接入](#integration)
- [查询与更新](#queries)
- [支持边界](#boundaries)
- [本地开发](#development)
- [贡献与维护](CONTRIBUTING.md)
- [未发布改动](changelogs/unreleased.md)
- [1.0.1 迁移与变更](changelogs/1.0.1.md)
- [1.1.0 待发布变更](changelogs/1.1.0.md)
- [1.0.0 变更](changelogs/1.0.0.md)
- [许可证](#license)

<a id="status"></a>

## 当前状态

Registry 当前已发布 `1.0.1`；仓库为待发布 `1.1.0`。新目录模式、知识根别名及正文分页需使用本仓库构建的安装包；提交源码不会发布 npm 包或部署站点。主包只有 ESM 根入口，固定依赖 BCP 47 解析器与 IANA 注册表数据；MCP 示例为独立私有包，不导出 `./mcp`。文档源码位于 [website](website/)。

```sh
npm install @devcodex/capability-graph@1.0.1
```

上面的 Registry 命令安装已发布 1.0.1。使用下文的目录模式、知识根和分页功能，请先按[当前预览版安装说明](website/docs/getting-started/installation.mdx)构建并安装 1.1.0。本仓库教程与[已部署站点](https://devcodex-labs.github.io/capability-graph/)可能处于不同版本；首次接入按[最小 Provider](website/docs/getting-started/first-provider.mdx)开始，再按[进阶教程](website/docs/guides/progressive-discovery.mdx)增强。

已实现文件权威加载、校验、单 Provider 正式图、跨 Provider 联合目录、范围控制、修订快照、按需知识读取，以及可插拔的数据库、检索和 Runtime 合同。真实 Seed 同时提供普通 API 与 MCP 接入。

<a id="integration"></a>

## 定义与接入

Provider 在独立目录提供 `provider.json`、`capabilities/**/*.json` 和可选知识文件，显式启用 `definitionLayout: "directory"`。旧配置默认 `legacy`，继续递归收集 `*.capability.json`。Core 不导入业务源码，不执行能力，不自动推断图关系。可运行样本见 [Seed Provider](examples/seed-provider/PROVIDER.md)。

```json
{
  "capabilityId": "route.validation",
  "name": "Request validation",
  "description": "Validate input before a route handler runs.",
  "whenToUse": "A route needs a declared request contract.",
  "parents": ["route", "request"],
  "specializes": ["route.http"],
  "related": ["schema.request"],
  "requires": ["schema.request"],
  "knowledge": [{
    "kind": "document", "knowledgeId": "D-02", "role": "guide", "locale": "en",
    "locator": { "type": "relative-file", "path": "knowledge/route-validation.md" }
  }]
}
```

上述关系端点必须由同一 Provider 定义。`parents`、`specializes` 与 `requires` 分别无环；`related` 有方向，不参与依赖闭包。能力 ID 不包含 Provider 前缀；完整身份为 `{ providerId, capabilityId }`，可逆显示形式为 `seed.http::route.validation`，不按点号猜边界。概念不兼容时由作者使用新 ID。

```ts
import { CapabilityGraph } from "@devcodex/capability-graph";

const graph = await CapabilityGraph.open({
  hostAllowedProviders: ["seed.http"],
  integrationEnabledProviders: ["seed.http"],
  providers: [{
    providerId: "seed.http",
    authority: { kind: "file", rootDir: "/absolute/path/to/seed-provider", definitionLayout: "directory" },
  }],
});
try {
  const provider = graph.forProvider("seed.http");
  const catalog = await provider.listCatalog({ limit: 20 });
  const requiredStaticRevision = catalog.meta.staticRevision;
  const detail = await provider.getCapabilities(["route.validation"], { requiredStaticRevision });
  const neighbors = await provider.getNeighbors("route.validation", { requiredStaticRevision });
  const selection = await provider.resolveSelection({ selected: ["route.validation"], requiredStaticRevision });
  const documents = await provider.readDocuments({
    selected: selection.resolved.map(({ capabilityId }) => capabilityId),
    roles: ["guide", "reference"], locales: ["en"], requiredStaticRevision,
  });
  const specification = await provider.readSpecification({ knowledgeIds: ["SPEC-01"], requiredStaticRevision });
  console.log({ detail, neighbors, selection, documents, specification });
} finally {
  await graph.close();
}
```

必填范围与 `providers` 不能省略。显式空启用范围配合空 `providers` 是合法空配置；有效启用范围中的每个 Provider 必须恰有一个权威来源，缺少来源报 `CG_CONFIG_INCOMPLETE`，不能当成空目录。请求范围只能缩小宿主与集成配置的交集；各 Provider 独立修订，联合目录不产生跨 Provider 图边。

文件 `rootDir` 在 `open` 时解析为固定绝对根，后续工作目录变化不会重定位 `reload`。数据库 `knowledgeRootDir` 若为相对路径，在 Core 收到该只读视图时立即固定；current/previous 分别保留自己的根。知识 locator 仍是作者声明的相对路径，私有根不出现在公共结果或检索请求中。

directory 只收集 capabilities/**/*.json，缺少目录、目录外遗留定义、嵌套 Provider、链接定义及大小写文件冲突明确失败；空目录合法。legacy 保持旧递归规则。两模式均跳过 .git、node_modules、dist、dist-test、coverage、.cache、.tmp。每个定义最多 262_144 UTF-8 字节，这是定义 Schema 预算；知识文档总大小不设准入上限。

每个 Provider 可用 knowledgeRoots 显式绑定获准外部目录或实际安装包根；locator 的可选 root 只引用稳定别名。旧相对路径保持原义。真实根与包身份固定，支持中文、空格、scoped 包及 pnpm；拒绝路径逃逸，不执行包入口，私有根不进入输出。URL 使用 http locator 和宿主 Reader，canonicalUrl 只是展示链接。

<a id="queries"></a>

## 查询与更新

| 原语 | 用途 |
|---|---|
| `listProviders` / `getProvider` / `listSpecificationDocuments` | Provider 元数据及有界规范文档发现，不读取正文 |
| `listCatalog` | 平坦摘要；按范围、ID 前缀、显式 parent 过滤，支持分页 |
| `getCapabilities` / `getNeighbors` / `listKnowledgeMembers` | 有界详情、八种关系和 Collection 成员发现 |
| `resolveSelection` | 沿 `requires` 求完整必要上下文闭包，返回边与直接原因 |
| `readDocuments` / `readSpecification` | 按用途/语言显式读取能力文档或 Provider 规范，逐项返回结果 |
| `readDocumentPage` / `readSpecificationPage` | 按 UTF-8 字节分页读取正文，保留全文身份与续读游标 |
| `retrieveCapabilities` | 显式调用已配置召回后端，Core 校验候选身份与修订 |
| `queryKnowledge` | 对已选知识执行检索，校验证据、内容版本与片段边界 |
| `queryRuntime` | 查询单 Provider、指定项目和环境下的运行实例 |

大文档使用 `readDocumentPage` / `readSpecificationPage`，模型决定范围与是否续读。默认 32 KiB 是页大小，文档总大小不设准入门槛；全文与本页哈希分开，内容变化拒绝旧游标。旧全文接口保持完整返回语义，超过单次响应容量时改用分页。

已知身份可直接查详情或读取，不强制从目录开始。第一轮目录只含能力摘要；显式选择由调用者决定，Core 只沿 `requires` 补齐必要上下文。分页必须保留过滤条件及修订；检查 `meta.completeness`、`warnings` 和 `nextCursor`，不能把部分结果当成全集。批量结果逐项检查 `ok`。

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
- 数据库、两类检索与远程 Reader 提供公开合同和正负测试；仓库示例另含真实本机 HTTP Reader 与有限词项索引，主包不附数据库、向量或模型后端。
- Runtime Core 已实现调度、观察状态与返回校验；[独立 HTTP 参考](examples/seed-runtime/README.md)实际采集应用注册路由，并验证项目环境隔离、实时变化和失败恢复。它不是通用框架扫描器或远程集群监控服务。
- Adapter 在调用进程内运行，属于显式信任代码；scope 不是进程沙箱。相对知识路径受根目录及真实路径约束，远程读取策略归已配置 Reader。
- [API 示例](examples/seed-api/README.md)与 [MCP 示例](examples/seed-mcp/README.md)共享 Core。工具命名、认证、宿主意图判断及规范采用归接入方，不属于主包。

官方文档导出、原生 MCP 审计与真实验证入口见 [VextJS 示例](examples/vextjs/README.md)。文档 Provider 的默认入口按官方主题发现；原生目录与运行快照另行审计。

<a id="development"></a>

## 本地开发

目录、代码约定、文档验证及发布规则统一见[贡献指南](CONTRIBUTING.md)；场景与测试入口见 [test/README.md](test/README.md)。

Node.js 范围：`^20.19.0 || >=22.12.0`。在仓库目录运行：

```sh
npm ci
npm test
npm run test:package
npm run evaluate
```

`npm test` 先构建和核对独立 TypeScript 消费者，再清理 `dist-test`、重新编译并发现测试；删除或重命名源码后不会继续执行旧测试输出。`test:package` 在无 dist 的源码副本中离线执行标准打包，并核对旧产物清理、预构建一致性、独立项目的真实安装与类型，结束后清理临时文件，不执行发布。

只构建使用 `npm run build`，会清理仓库内 dist 后重新编译；标准 `npm pack` 的 prepack 自动执行同一构建，不能跳过脚本后假定产物仍然有效。构建产物位于 `dist/`，测试编译产物位于 `dist-test/`。CI 配置覆盖 Windows/Linux 与 Node 20.19.0、22.12.0、24.19.0，远端运行结果以实际 CI 为准。

`npm run demo:http` 运行真实 Node.js HTTP 文档读取、能力词项召回、知识检索、过期拒绝和重建恢复，再请求业务路由。示例不调用模型；数据库与真实框架接入仍需分别实现和验证。

`npm run evaluate:capacity` 执行可复用的真实文件容量验证。默认 1 万节点、2 个 Provider、10 并发：先完整遍历全局 Catalog，核对跨 Provider 的全部身份、无遗漏和重复；再强制每个 Provider 至少两轮 reload，验证旧 previous 退出可查询槽位，同时已 pin 的查询仍能读取原视图。随后混合目录/详情/八类邻居/选择/正文/规范查询，交错定义更新与 reload，最后验证关闭时读取完成和新查询拒绝。报告分别记录 `catalogCoverage`、`retirementChecks`、负载中的 `providerQueries` 与各阶段耗时；全局 Catalog 的负载计数按页面实际出现的 Provider 统计。

扩大验证可运行 `npm run evaluate:capacity -- --nodes 100000 --providers 2 --concurrency 100 --operations 3000 --duration-ms 120000 --reload-every 1000 --reload-rounds 2`。操作数至少为 `7 × Provider 数`；`--reload-rounds` 可增大但不能少于两轮，`--reload-every 0` 只关闭负载期间的交错 reload。持续时间是负载下限，完整遍历、强制 reload 及等待中的读取会增加总耗时。临时来源执行后删除，JSON 报告保留在同级产物目录。延迟和采样内存只说明本机本次运行，不是生产容量承诺。

容量工具每类延迟最多保留 4096 个样本，报告标明分位数来自全量还是抽样；计数和最大值持续累计，内存统计也使用固定大小，避免验证工具自身随运行时长持续增长。

文档站点的正式测试位于根 `test/website`，固定样例位于 `test/fixtures/website`，验证工具位于 `scripts/validation/website`。临时消费者、报告、截图、生成材料与站点制品统一位于仓库同级 `capability-graph-artifacts`；站点配置和使用入口见 [website/README.md](website/README.md)。

`npm run build:tests` 单独清理并编译测试，`evaluate` 也使用此入口。根包及私有 MCP 示例的构建清理只接受已知、归当前包所有的输出目录，拒绝符号链接或普通文件，不跟随输出链接删除其他目录。

`evaluate` 使用明确期望的 Seed 任务记录正确性、遗漏、UTF-8 返回字节、调用数和本机耗时，不调用模型、不推断真实 Agent 准确率或节省比例。未配置检索后端的质量对照不适用。

CI 的 `test:package:built`、`evaluate:built` 和 website `build:built` 先核对源码及全部输出指纹；普通命令仍从当前源构建。共享 dist 的构建必须串行，临时报告、服务数据和浏览器输出在仓库外。

VextJS CI 分别验证固定来源的官方文档、原生 MCP 和 Session；另一个全新安装项目执行业务验收。独立文档入口：`node scripts/validation/vextjs-documentation.mjs <已构建的固定框架目录> <完整 commit>`，先执行根构建与测试编译。

<a id="license"></a>

## 许可证

Apache-2.0
