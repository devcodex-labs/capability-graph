# 关联知识文件

Provider JSON 只放引用；长篇指南、规范和示例按需读取。

```json
{"id":"route","name":"Route","description":"Validated route","documents":[{"id":"guide","title":"使用指南","source":{"type":"file","path":"knowledge/route.md"}},{"id":"upstream","source":{"type":"url","url":"https://example.com/guide"}}]}
```

file 来源的文档根固定为 Provider JSON 所在目录；内联 definition 有本地文档时必须提供 documentRoot。documentId 在所属能力内唯一，可用中文。readDocument 只能传 capabilityId/documentId，不能传任意路径。

```js
const doc = await graph.readDocument({capabilityId:'acme::route', documentId:'guide'});
console.log(doc.text, doc.byteLength, doc.contentHash);
```

该片段需要先加载含 guide 声明和实际文件的 Provider，见[独立详情示例](/guide/results#读取目录详情与知识正文)；最小快速开始没有知识文件，不能直接向其 Graph 请求 guide。text 为 UTF-8，去首 BOM、保留 CRLF；byteLength 与 contentHash 依据同一次稳定读取的原始字节。默认 1 MiB，超限显式失败。

绝对路径、父级越界、设备/驱动器/UNC 等危险形式拒绝。合法根内 symlink 可读，逃逸 symlink 拒绝；正文检查文件身份与稳定性。部署必须控制可信根与祖先目录，完整信任前提见[安全页](/resources/security)。

URL 仅作引用，readDocument 报 CG_DOCUMENT_REFERENCE_ONLY，不自动抓取。文件存在性与正文合法性在读取阶段校验；不存在、非法 UTF-8、超限等各有错误。修改正文不改变静态 Graph Revision。

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
