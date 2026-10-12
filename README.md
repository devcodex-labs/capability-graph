# Capability Graph

Capability Graph 是一个相对简单的静态能力图谱：从 JSON 文件加载 Provider 和能力定义，在内存中查询能力、关系及必要上下文，并按需读取关联文档。接入方可以通过自己的 Node.js API 或 MCP 将这些查询提供给使用者或 Agent。

## 当前版本与安装

本文对应 **2.0.0** 的源码接口。使用发布包前先确认确切版本可用；`E404` 时按[安装页](https://devcodex-labs.github.io/capability-graph/getting-started/installation)固定文档提交构建源码。网络、认证或镜像失败不能证明版本不存在。源码修改不会自动发布 npm 或部署站点。

```sh
npm view @devcodex/capability-graph@2.0.0 version
npm install @devcodex/capability-graph@2.0.0
```

Node.js：`^20.19.0 || >=22.12.0`。主包只有 ESM 根入口，包含 TypeScript 类型；固定依赖仅为 BCP 47 解析器与语言注册表。2.0 移除了数据库权威来源、能力召回、知识检索和 Runtime，升级前查看[2.0 迁移清单](https://github.com/devcodex-labs/capability-graph/blob/main/changelogs/2.0.0.md)。已发布的 1.1.0 与其 tag 保留原有接口。

## 最小接入

在接入项目准备以下目录；Provider 目录是数据，不需要单独安装依赖：

```text
providers/
└── acme-http/
    ├── provider.json
    ├── capabilities/
    │   └── route.json
    └── knowledge/
        └── routing.md
```

`provider.json`：

```json
{ "providerId": "acme.http", "name": "Acme HTTP", "version": "1" }
```

`capabilities/route.json`：

```json
{
  "capabilityId": "route",
  "name": "HTTP routing",
  "description": "Declare HTTP routes.",
  "whenToUse": "An application needs an HTTP endpoint.",
  "knowledge": [{
    "kind": "document", "knowledgeId": "routing-guide", "role": "guide",
    "locator": { "type": "relative-file", "path": "knowledge/routing.md" }
  }]
}
```

将实际路由说明保存到 `knowledge/routing.md`，再运行 ESM 脚本：

```js
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';

const graph = await CapabilityGraph.open({
  hostAllowedProviders: ['acme.http'],
  integrationEnabledProviders: ['acme.http'],
  providers: [{ providerId: 'acme.http', authority: {
    kind: 'file', definitionLayout: 'directory', rootDir: path.resolve('providers/acme-http')
  } }]
});
try {
  const provider = graph.forProvider('acme.http');
  const catalog = await provider.listCatalog({ limit: 20 });
  const selection = await provider.resolveSelection({ selected: ['route'] });
  const document = await provider.readDocumentPage({ capabilityId: 'route', knowledgeId: 'routing-guide' });
  console.log({ catalog, selection, document });
} finally { await graph.close(); }
```

完整首次接入见[最小 Provider](https://devcodex-labs.github.io/capability-graph/getting-started/first-provider)，逐步添加关系、文档与规范见[进阶教程](https://devcodex-labs.github.io/capability-graph/guides/progressive-discovery)。

## 能做什么

| 操作 | 用途 |
|---|---|
| `listProviders` / `getProvider` / `listSpecificationDocuments` | Provider 与规范文档元数据 |
| `listCatalog` / `getCapabilities` | 分页发现、结构化过滤与有界详情 |
| `getNeighbors` / `resolveSelection` | 八种正反向关系；沿 `requires` 展开必要上下文 |
| `listKnowledgeMembers` | Collection 文档成员发现 |
| `readDocuments` / `readSpecification` | 显式读取完整文档，逐项检查 `ok` |
| `readDocumentPage` / `readSpecificationPage` | 原始 UTF-8 字节分页，调用方决定范围及是否续读 |
| `reload` / `close` | 显式更新定义、保留 current/previous、释放图谱资源 |

完整身份是 `{ providerId, capabilityId }`，显示形式为 `acme.http::route`。`parents`、`specializes`、`requires` 分别无环；`related` 有方向。关系端点必须在同一 Provider 内；联合目录保留各自身份与修订。选择由调用方决定，Core 仅沿 `requires` 补齐上下文。

文件根在 `open` 时固定。新目录启用 `directory`；缺省 `legacy` 继续读取 `*.capability.json`。定义最多 262144 UTF-8 字节，文档总大小没有准入上限。全文默认每篇返回 32 KiB、每次最多 8 篇；较大正文改用默认 32 KiB 的分页读取，保留全文身份与游标。正文变化会拒绝旧游标，分页拼接保留 BOM、CRLF 和原始 UTF-8。

文档支持 Provider 内目录、显式获准的外部目录、真实 `node_modules` 包根，以及通过宿主 `KnowledgeReader` 读取的 URL。`knowledgeRoots` 配置来源别名，locator 的 `root` 只引用该 Provider 的别名；私有根不会进入公共结果。URL Reader 的访问策略、连接和关闭由宿主管理。

每个启用 Provider 必须恰有一个文件来源；scope 只能缩小。检查 `meta.completeness`、`warnings`、逐项 `ok` 和续页游标。`reload` 完整校验新定义后才替换视图，失败保留旧视图并标记 `refreshFailed`；更旧的修订明确失败。

## 职责边界

能力图谱负责声明与查询。能力执行、Agent 意图判断、业务项目状态、RAG 的分块索引/Embedding/数据库/排名以及回答生成由宿主或独立模块负责。这里的文档分页是原文访问，不是知识检索。未来 RAG 可以使用公开能力身份、文档引用和分页接口，自行管理索引；主包不预留空检索框架。

MCP 工具名称、认证与协议属于接入项目；主包没有 MCP 子入口。自定义 Reader 是进程内受信任代码，Provider scope 不是执行沙箱。

## 示例、验证与维护

- [Seed API](https://github.com/devcodex-labs/capability-graph/tree/main/examples/seed-api)：图谱发现、选择、文档与规范的完整链路。
- [Seed MCP](https://github.com/devcodex-labs/capability-graph/tree/main/examples/seed-mcp)：独立私有包，11 个查询工具及规范 Resource。
- [HTTP Reader](https://github.com/devcodex-labs/capability-graph/tree/main/examples/http-reader)：真实 HTTP、原字节分页、ETag、取消和资源清理。
- [VextJS](https://github.com/devcodex-labs/capability-graph/tree/main/examples/vextjs)：固定来源的官方文档主题、安装包及 URL 读取；验证说明与实际执行范围一致。

```sh
npm ci
npm test
npm run test:package
npm run evaluate
npm run demo:http
npm run evaluate:capacity
```

容量验证默认 1 万文件节点、2 个 Provider、10 并发，核对完整目录、关系、Selection、reload、已 pin 查询与 close。读取使用明确标注的受控 Reader，真实网络由 HTTP/VextJS 验证覆盖；本机延迟与采样内存不代表生产容量承诺。

正式站点测试位于 `test/website`，验证工具位于 `scripts/validation/website`，`website` 保存文档、主题、资源与站点配置。临时消费者、日志、报告和生成产物放在项目同级专用目录，通过 `CG_ARTIFACTS_DIR` 指定；普通构建输出为 `dist/` 和 `dist-test/`，云端验证在仓库外副本执行。

更多入口：[贡献指南](https://github.com/devcodex-labs/capability-graph/blob/main/CONTRIBUTING.md)、[测试说明](https://github.com/devcodex-labs/capability-graph/blob/main/test/README.md)、[未发布改动](https://github.com/devcodex-labs/capability-graph/blob/main/changelogs/unreleased.md)、[文档站点](https://devcodex-labs.github.io/capability-graph/)。站点 `release.json` 记录实际包版本及文档提交。

## 许可证

[Apache-2.0](LICENSE)
