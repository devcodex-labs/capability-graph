# 第一个图谱

先按[安装说明](/getting-started/installation)将 `@devcodex/capability-graph@2.0.0` 安装到你的项目。以下文件均在该项目创建，使用 Node.js ESM 运行，无需模型和凭据。

## 创建声明与知识文件

保存 provider.json：

```json
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
      "relations": { "requires": ["schema"] },
      "documents": [{ "id": "guide", "source": { "type": "file", "path": "knowledge/guide.md" } }]
    },
    { "id": "schema", "name": "Request schema", "description": "Declare a schema to validate request input." }
  ]
}
```

创建 knowledge/guide.md，写入你自己的使用指南。本例的 requires 是作者为“带请求校验的接口”声明的依赖，不表示所有 HTTP 路由都必须校验。

## 调用与释放

保存 static.mjs。使用 import.meta.url 定位文件，因此更换启动目录也能运行。

<!-- example:examples/minimal/static.mjs -->
```js
import {CapabilityGraph} from '@devcodex/capability-graph';
import {fileURLToPath} from 'node:url';
const graph=await CapabilityGraph.open({providers:[{file:fileURLToPath(new URL('./provider.json',import.meta.url))}]});
try {
  const catalog=await graph.listCatalog();
  const detail=await graph.getCapabilities({ids:['acme::route']});
  const resolved=await graph.resolve({ids:['acme::route']});
  const document=await graph.readDocument({capabilityId:'acme::route',documentId:'guide'});
  console.log(JSON.stringify({catalog:catalog.items.map(c=>c.id),usage:detail.items[0].capability.usage.instructions,selected:resolved.selected,nodes:resolved.nodes.map(n=>({id:n.capability.id,origin:n.origin,applicability:n.applicability.status})),completeness:resolved.meta.completeness,documentId:document.documentId},null,2));
} finally {await graph.close();}
```

```sh
node static.mjs
```

输出的 catalog 为 acme::route、acme::schema；selected 为 acme::route；nodes 有 selected 根与 dependency schema，applicability 为 applicable；completeness 为 complete；documentId 为 guide。没有 appliesTo 只表示无附加静态条件，不证明项目实际已经具备执行能力。

## 从 CLI 验证并接入宿主

保存 graph.config.json：

```json
{"providers":[{"file":"./provider.json"}],"allowedProviders":["acme"]}
```

```sh
npx --no-install capability-graph validate --file provider.json
npx --no-install capability-graph doctor --config graph.config.json
```

doctor 不调用模型。下一步选择[Codex](/integrations/codex)、[主动 match](/models/match)或[多 Provider](/guide/relations)。
