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

该片段中的 graph 来自[完整快速开始](/getting-started/quick-start)。text 为 UTF-8，去首 BOM、保留 CRLF；byteLength 与 contentHash 依据同一次稳定读取的原始字节。默认 1 MiB，超限显式失败。

绝对路径、父级越界、设备/驱动器/UNC 等危险形式拒绝。合法根内 symlink 可读，逃逸 symlink 拒绝；正文检查文件身份与稳定性。部署必须控制可信根与祖先目录，完整信任前提见[安全页](/resources/security)。

URL 仅作引用，readDocument 报 CG_DOCUMENT_REFERENCE_ONLY，不自动抓取。文件存在性与正文合法性在读取阶段校验；不存在、非法 UTF-8、超限等各有错误。修改正文不改变静态 Graph Revision。
