import { createTemporaryDirectory } from '../../../lib/artifact-paths.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CapabilityGraph } from '../../../../dist/index.js';

/** Execute the page's factory, including an upstream stream that emits no chunks. */
export async function verifyDocumentedReaderFactory(createHttpReader, Graph = CapabilityGraph) {
  const root = await createTemporaryDirectory('cg-reader-factory-');
  const url = 'https://example.invalid/factory';
  let bytes = Buffer.alloc(0);
  let graph;
  try {
    await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'acme.reader', name: 'Reader', version: '1' }));
    await mkdir(path.join(root, 'capabilities'));
    await writeFile(path.join(root, 'capabilities/read.json'), JSON.stringify({
      capabilityId: 'read', name: 'Read', description: 'Factory verification', whenToUse: 'Read the source',
      knowledge: [{ kind: 'document', knowledgeId: 'guide', role: 'guide', locator: { type: 'http', url } }]
    }));
    const reader = createHttpReader(async () => bytes, async function* (_url, { chunkBytes }) {
      for (let start = 0; start < bytes.length; start += chunkBytes) yield bytes.subarray(start, start + chunkBytes);
    });
    graph = await Graph.open({ hostAllowedProviders: ['acme.reader'], integrationEnabledProviders: ['acme.reader'],
      providers: [{ providerId: 'acme.reader', authority: { kind: 'file', definitionLayout: 'directory', rootDir: root } }], readers: [reader] });
    const provider = graph.forProvider('acme.reader');
    for (const size of [0, 32768, 32769]) {
      bytes = Buffer.alloc(size, 97);
      const full = (await provider.readDocuments({ selected: ['read'] })).results[0];
      assert(full, 'documented Reader factory returned no result');
      if (size <= 32768) {
        assert(full.ok, 'documented Reader factory rejected a within-budget body');
        assert.equal(full.value.text, bytes.toString());
      } else {
        assert.equal(full.ok, false, 'documented Reader factory must reject an oversized full read');
        assert.equal(full.error.code, 'CG_BUDGET_EXCEEDED', 'documented Reader factory lost the budget error');
        assert.equal(full.error.nextAction, 'page_or_filter');
      }
      let cursor;
      let offset = 0;
      const parts = [];
      do {
        let page;
        try { page = await provider.readDocumentPage({ capabilityId: 'read', knowledgeId: 'guide',
          maxBytes: cursor ? 2048 : 1024, ...(cursor ? { cursor } : {}) }); }
        catch (error) { assert.fail(`documented Reader factory failed to page ${size} bytes: ${error.code}`); }
        assert.equal(page.source, url); assert.equal(page.contentType, 'text/plain; charset=utf-8');
        assert.equal(page.contentId, `k:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`);
        assert.equal(page.startOffset, offset); offset = page.endOffset;
        parts.push(page.text); cursor = page.nextCursor;
        assert.equal(page.hasMore, cursor !== undefined);
      } while (cursor);
      assert.equal(offset, size); assert.equal(parts.join(''), bytes.toString(), 'documented Reader factory changed the body');
    }
  } finally {
    try { await graph?.close(); } finally { await rm(root, { recursive: true }); }
  }
}

function readerAlgorithm(source) {
  const expression = source.match(/createHash\('([^']+)'\)\.update\(bytes\)\.digest\('([^']+)'\)\.slice\(0,\s*(\d+)\)/);
  assert(expression, 'Reader documentation must include the precise bytes-to-contentId expression');
  const [, algorithm, encoding, length] = expression;
  assert.equal(encoding, 'hex');
  return { expression: expression[0].replace(/\s+/g, ''), contentId: (bytes) =>
    `k:${createHash(algorithm).update(bytes).digest(encoding).slice(0, Number(length))}` };
}

/** Read the documented algorithm and exercise exact Reader results through the public API. */
export async function verifyReaderContracts(docsRoot) {
  const adapterPage = await readFile(path.join(docsRoot, 'reference/reader.mdx'), 'utf8');
  const readerPage = await readFile(path.join(docsRoot, 'integrations/knowledge-reader.mdx'), 'utf8');
  const documented = readerAlgorithm(adapterPage);
  assert.equal(documented.expression, readerAlgorithm(readerPage).expression, 'Reader algorithm differs between reference and integration');
  const root = await createTemporaryDirectory('cg-adapter-contracts-');
  const bytes = Buffer.from('审查正文\n', 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const correctId = `k:${digest.slice(0, 16)}`;
  let readerId = documented.contentId(bytes);
  let graph;
  try {
    await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'acme.audit', name: 'Audit', version: '1' }));
    await mkdir(path.join(root, 'capabilities'));
    await writeFile(path.join(root, 'capabilities/route.json'), JSON.stringify({
      capabilityId: 'route', name: 'Route', description: 'Adapter contract', whenToUse: 'Audit',
      knowledge: [{ kind: 'document', knowledgeId: 'guide', role: 'guide', locator: { type: 'http', url: 'https://example.invalid/guide' } }]
    }));
    graph = await CapabilityGraph.open({
      hostAllowedProviders: ['acme.audit'], integrationEnabledProviders: ['acme.audit'],
      providers: [{ providerId: 'acme.audit', authority: { kind: 'file', definitionLayout: 'directory', rootDir: root } }],
      readers: [{ id: 'audit-reader', canRead: () => true, async read(ref) {
        return { bytes, contentType: 'text/plain', source: ref.locator.url, contentId: readerId };
      } }],

    });
    const bound = graph.forProvider('acme.audit');
    const successfulRead = await bound.readDocuments({ selected: ['route'] });
    assert.equal(successfulRead.results[0].ok, true, 'documented Reader algorithm rejected by Core');
    assert.equal(successfulRead.results[0].value.contentId, readerId);
    readerId = `k:${digest}`;
    const rejectedRead = await bound.readDocuments({ selected: ['route'] });
    assert.equal(rejectedRead.results[0].ok, false);
    assert.equal(rejectedRead.results[0].error.code, 'CG_ADAPTER_CONTRACT_INVALID');
    assert.equal(rejectedRead.results[0].error.details.reason, 'reader_content_identity_mismatch');
    readerId = documented.contentId(bytes);
    for (const invalidSource of ['https://wrong.invalid/guide']) {
      const bad = await CapabilityGraph.open({ hostAllowedProviders: ['acme.audit'], integrationEnabledProviders: ['acme.audit'],
        providers: [{ providerId: 'acme.audit', authority: { kind: 'file', definitionLayout: 'directory', rootDir: root } }],
        readers: [{ id: 'wrong-source', canRead: () => true, async read() { return { bytes, contentId: correctId, contentType: 'text/plain', source: invalidSource }; } }] });
      try { const slot = (await bad.forProvider('acme.audit').readDocuments({ selected: ['route'] })).results[0];
        assert.equal(slot.ok, false); assert.equal(slot.error.code, 'CG_ADAPTER_CONTRACT_INVALID');
      } finally { await bad.close(); }
    }
    const factory = readerPage.match(/```ts title="reader-skeleton\.ts"\r?\n([\s\S]*?)\r?\n```/)?.[1];
    assert(factory, 'HTTP Reader implementation fence is missing');
    const module = path.join(root, 'reader-factory.mjs');
    const compiled = ts.transpileModule(factory, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    // These contract checks use this build; the consumer gate separately leaves the public import intact.
    const core = new URL('../../../../dist/index.js', import.meta.url).href;
    await writeFile(module, compiled.replaceAll("'@devcodex/capability-graph'", JSON.stringify(core)));
    await verifyDocumentedReaderFactory((await import(pathToFileURL(module).href)).createHttpReader);
    console.log('Reader contracts passed: Reader identity/source checks and actual page factory empty/boundary/oversized bodies');
  } finally {
    try { await graph?.close(); }
    finally { await rm(root, { recursive: true }); }
  }
}
