# 本地文档与 URL 引用

长篇使用指南可放在本地 Markdown 文件，外部资料可登记为 HTTPS URL。它们通过能力的 `documents[].source` 关联；能力定义本身仍写在 Provider 的 `capabilities` 数组中。

## 本地文件与 URL 引用的完整示例

先按[安装](/getting-started/installation)准备 Node.js >=22.12.0 的项目。下面三个文件放在同一目录；也可以按[运行示例](/examples/index)复制后运行 `node examples/documents/read.mjs`，无需模型或网络请求。

```text
documents/
├── provider.json
├── read.mjs
└── knowledge/
    └── route.md
```

`provider.json` 声明同一能力的两个文档：guide 是本地文件，upstream 是外部引用。example.com 是示意资料地址，Graph 不会请求它。

<!-- example:examples/documents/provider.json -->
```json title="provider.json"
{
  "providerId": "acme",
  "name": "Acme documentation",
  "version": "1.0.0",
  "capabilities": [
    {
      "id": "route",
      "name": "Validated HTTP endpoint",
      "description": "Create an HTTP endpoint with request validation.",
      "documents": [
        { "id": "guide", "title": "Local route guide", "source": { "type": "file", "path": "knowledge/route.md" } },
        { "id": "upstream", "title": "External reference", "source": { "type": "url", "url": "https://example.com/guide" } }
      ]
    }
  ]
}
```

保存本地正文 `knowledge/route.md`：

<!-- example:examples/documents/knowledge/route.md -->
```md title="knowledge/route.md"
Declare the request schema, then register the endpoint.
```

保存 `read.mjs`。它先通过详情取得 URL 引用，再按声明 ID 读本地正文，最后展示误读 URL 正文的明确错误。成功时 stdout 是完整的 `{local, upstream, urlReadError}` 组合对象；local 是原始 DocumentResult，upstream 是原始文档声明；其他 Graph 错误写 stderr 并以 1 退出，finally 关闭 Graph。

<!-- example:examples/documents/read.mjs -->
```js title="read.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }]
  });
  const details = await graph.getCapabilities({ ids: ['acme::route'] });
  const upstream = details.items[0].capability.documents.find(doc => doc.id === 'upstream');
  const local = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' });
  let urlReadError;
  try {
    await graph.readDocument({ capabilityId: 'acme::route', documentId: 'upstream' });
    throw new Error('Expected URL reference to reject a body read');
  } catch (error) {
    if (!(error instanceof GraphError) || error.code !== 'CG_DOCUMENT_REFERENCE_ONLY') throw error;
    urlReadError = { code: error.code, phase: error.phase };
  }
  console.log(JSON.stringify({ local, upstream, urlReadError }, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

```sh
node read.mjs
```

| 参数 | 读取位置与含义 |
| --- | --- |
| `providers[].file` | 脚本旁的 provider.json，其所在目录自动成为文档根 |
| `source.type: 'file'` 和 `path` | 根内相对文件路径；本例读取 knowledge/route.md，与运行时 cwd 无关 |
| `source.type: 'url'` 和 `url` | HTTPS 引用，随详情返回；不自动抓取正文 |
| `capabilityId` | 完整能力 ID acme::route |
| `documentId` | 能力内的声明 ID guide/upstream；不是任意文件路径或 URL |

以下是这个随包示例的完整 stdout。local 保留原始文档结果，包括原始字节数/哈希；upstream 保留 URL 声明，未发送网络请求。

<details>
<summary>查看本地读取和 URL 引用的完整结果</summary>

```json
{
  "local": {
    "capabilityId": "acme::route",
    "documentId": "guide",
    "source": {
      "type": "file",
      "path": "knowledge/route.md"
    },
    "text": "Declare the request schema, then register the endpoint.\n",
    "byteLength": 56,
    "contentHash": "sha256:3e69d0f41c038f4daa4e31cf631cbfceda512eda5cda80127170134f55772692",
    "meta": {
      "revision": "sha256:68072b0cf02516d7f652b8db9b9223eaded8a52e12f3bd6022ef309861a6858f",
      "completeness": "complete",
      "warnings": []
    }
  },
  "upstream": {
    "id": "upstream",
    "title": "External reference",
    "source": {
      "type": "url",
      "url": "https://example.com/guide"
    }
  },
  "urlReadError": {
    "code": "CG_DOCUMENT_REFERENCE_ONLY",
    "phase": "document"
  }
}
```

</details>

本地文件不存在、无权限、不是合法 UTF-8 或超预算时，readDocument 抛相应 document 阶段错误；URL 正文读取固定为 CG_DOCUMENT_REFERENCE_ONLY。处理恢复见[错误与恢复](/reference/errors)。

## 本地路径边界

文件式文档根固定为 Provider JSON 所在目录。内联 definition 若要读取本地文档，必须给该来源配置 `documentRoot`，完整对照见下方；它不是给单个 capability 配置的 path。默认正文预算 1 MiB，text 去首 BOM、保留 CRLF，byteLength/contentHash 取自同一次稳定读取的原始字节。

绝对路径、父级越界、设备/驱动器/UNC 等危险形式拒绝。合法根内 symlink 可读，逃逸 symlink 拒绝；部署需控制可信根及祖先目录，见[安全页](/resources/security)。修改正文不改变静态 Graph Revision。

## 选择正确的文档根与读取阶段

| 来源/阶段 | 配置或检查 | 行为 |
| --- | --- | --- |
| file | `providers:[{file:'/absolute/provider.json'}]` | 文档根自动固定到该JSON所在目录，不能另设documentRoot |
| definition | `providers:[{definition,documentRoot:'/trusted/docs'}]` | 本地正文需显式可信根；相对根基于open当时cwd |
| definition缺根 | 可open含文件引用的声明 | 实际readDocument时报CG_DOCUMENT_ROOT_REQUIRED，不虚称加载时保证正文可读 |
| 声明加载 | 文档ID、来源类型、相对路径/HTTPS URL语法 | 非法声明在load拒绝；正文不在此时读取 |
| 正文读取 | 文件存在、权限、UTF-8、字节预算和稳定性 | 按实际原因抛document阶段错误；URL是CG_DOCUMENT_REFERENCE_ONLY |

`usage.contract` 是已有契约引用，接受openapi/mcp-tool/json-schema/other及HTTPS/URN；`documents` 是能力关联的使用材料引用。两者均不自动联网、解析、执行。正文不在Catalog中，也不自动发给匹配模型；宿主在选中后按需读取，再决定是否提供给当前模型。

## 文件式与内联式的完整验证

按[运行示例](/examples/index)复制，在项目根运行 `node examples/scenarios/documents.mjs`。它在系统临时目录创建自己的声明和正文，finally删除该目录，不修改你的业务文件。文件式与内联式各读取同一个guide，程序逐项比对，并检查缺根/缺文件/URL只引用。

以下是该脚本的完整stdout。正文初始带UTF-8 BOM和CRLF；text去首BOM、保留CRLF，byteLength和contentHash仍针对同一次读取的原始字节。修改正文后哈希变而Graph revision保持原值：

```json
{
  "file": {
    "capabilityId": "docs::route",
    "documentId": "guide",
    "source": {
      "type": "file",
      "path": "guide.md"
    },
    "text": "Guide\r\nSecond line\r\n",
    "byteLength": 23,
    "contentHash": "sha256:a5b2098d4a492744b1a6d7df8d013afd3e103207cfc8c4d557000969b3847ec2",
    "meta": {
      "revision": "sha256:904df245deb47cbae4b4a50ff7caa520fe43e76fed2c0586b29e08164de322b7",
      "completeness": "complete",
      "warnings": []
    }
  },
  "inline": {
    "capabilityId": "docs::route",
    "documentId": "guide",
    "source": {
      "type": "file",
      "path": "guide.md"
    },
    "text": "Guide\r\nSecond line\r\n",
    "byteLength": 23,
    "contentHash": "sha256:a5b2098d4a492744b1a6d7df8d013afd3e103207cfc8c4d557000969b3847ec2",
    "meta": {
      "revision": "sha256:904df245deb47cbae4b4a50ff7caa520fe43e76fed2c0586b29e08164de322b7",
      "completeness": "complete",
      "warnings": []
    }
  },
  "changed": {
    "capabilityId": "docs::route",
    "documentId": "guide",
    "source": {
      "type": "file",
      "path": "guide.md"
    },
    "text": "Changed body\r\n",
    "byteLength": 14,
    "contentHash": "sha256:1027115b703d8572ae7610fb23e8dce34e91ffac98614c56a135b195fcba62e8",
    "meta": {
      "revision": "sha256:904df245deb47cbae4b4a50ff7caa520fe43e76fed2c0586b29e08164de322b7",
      "completeness": "complete",
      "warnings": []
    }
  },
  "root-required": {
    "code": "CG_DOCUMENT_ROOT_REQUIRED",
    "phase": "document"
  },
  "missing-file": {
    "code": "CG_DOCUMENT_NOT_FOUND",
    "phase": "document"
  },
  "url-reference": {
    "code": "CG_DOCUMENT_REFERENCE_ONLY",
    "phase": "document"
  }
}
```

<details>
<summary>查看完整文档根与原始字节验证脚本</summary>

<!-- example:examples/scenarios/documents.mjs -->
```js title="documents.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'capability-graph-documents-'));
const definition={providerId:'docs',name:'Document example',version:'1',capabilities:[{
  id:'route',name:'Route',description:'A route with separately read documentation.',
  usage:{instructions:'Read the declared guide.',contract:{format:'other',uri:'urn:docs:route-contract'}},
  documents:[{id:'guide',source:{type:'file',path:'guide.md'}},{id:'missing',source:{type:'file',path:'missing.md'}},{id:'upstream',source:{type:'url',url:'https://example.com/guide'}}]
}]};
let fileGraph,inlineGraph,missingRoot;const output={};
try {
  const bytes=Buffer.from('\uFEFFGuide\r\nSecond line\r\n','utf8');
  await fs.writeFile(path.join(root,'guide.md'),bytes);
  await fs.writeFile(path.join(root,'provider.json'),JSON.stringify(definition));
  fileGraph=await CapabilityGraph.open({providers:[{file:path.join(root,'provider.json')}]});
  inlineGraph=await CapabilityGraph.open({providers:[{definition,documentRoot:root}]});
  const query={capabilityId:'docs::route',documentId:'guide'};
  output.file=await fileGraph.readDocument(query);output.inline=await inlineGraph.readDocument(query);
  assert.deepEqual(output.inline,output.file);
  assert.equal(output.file.text,'Guide\r\nSecond line\r\n');assert.equal(output.file.byteLength,bytes.byteLength);
  assert.equal(output.file.contentHash,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
  const before=(await fileGraph.listCatalog()).meta.revision;
  await fs.writeFile(path.join(root,'guide.md'),'Changed body\r\n');
  output.changed=await fileGraph.readDocument(query);
  assert.notEqual(output.changed.contentHash,output.file.contentHash);assert.equal(output.changed.meta.revision,before);
  // Opening an inline declaration without documentRoot succeeds; reading rejects.
  missingRoot=await CapabilityGraph.open({providers:[{definition}]});
  for(const [name,owner,documentId,expected]of [
    ['root-required',missingRoot,'guide','CG_DOCUMENT_ROOT_REQUIRED'],
    ['missing-file',fileGraph,'missing','CG_DOCUMENT_NOT_FOUND'],
    ['url-reference',fileGraph,'upstream','CG_DOCUMENT_REFERENCE_ONLY']
  ]) {
    await assert.rejects(owner.readDocument({capabilityId:'docs::route',documentId}),error=>{
      assert(error instanceof GraphError);output[name]={code:error.code,phase:error.phase};return error.code===expected;
    });
  }
  console.log(JSON.stringify(output,null,2));
} finally {
  await missingRoot?.close();await inlineGraph?.close();await fileGraph?.close();
  await fs.rm(root,{recursive:true,force:true});
}
```

</details>

不要把Graph revision当作整个文件系统快照：需要校验某次知识内容时使用该次readDocument的contentHash，并由应用管理后续处理的一致性。
