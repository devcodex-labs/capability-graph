import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyGeneratedContracts } from './lib/public-contracts.mjs';
import { verifyReferenceContracts } from './lib/reference-contracts.mjs';
import { verifyReaderContracts } from './lib/reader-contracts.mjs';
import { artifactsRoot, createTemporaryDirectory } from '../../lib/artifact-paths.mjs';
import { generatedRoot, websiteRoot } from '../../lib/website-paths.mjs';

const docs = path.join(websiteRoot, 'docs');
const contracts = JSON.parse(await readFile(path.join(generatedRoot, 'contracts/public-api.json'), 'utf8'));
const coverage = JSON.parse(await readFile(path.join(websiteRoot, 'data/reference-coverage.json'), 'utf8'));
for (const mutate of [
  (item) => item.fields.shift(),
  (item) => { item.fields[0].optional = true; },
  (item) => { item.fields[0].type = 'number'; }
]) {
  const bad = structuredClone(contracts);
  mutate(bad.symbols.find((item) => item.name === 'KnowledgeReadContext'));
  await assert.rejects(verifyGeneratedContracts(bad, coverage, docs), /fields, types or optionality drifted/);
}
for (const from of [
  '| `providerId` | `string` | 是 |',
  '"document"',
  'static open(config: OpenConfig): Promise<CapabilityGraph>;'
]) {
  let changed = false;
  await assert.rejects(verifyGeneratedContracts(contracts, coverage, docs, async (file) => {
    const source = await readFile(file, 'utf8');
    if (source.includes(from)) { changed = true; return source.replaceAll(from, ''); }
    return source;
  }));
  assert(changed, `negative fixture did not target ${from}`);
}
// A shared generator mistake changes both JSON and MDX. Neither agreement
// between generated outputs nor self-compilation proves the public contract.
const signatureMutations = [
  ['isId', (value) => value.replace('value: string', 'value: number')],
  ['CapabilityGraph', (value) => value.replace('static open(config: OpenConfig): Promise<CapabilityGraph>;', 'static open(config: OpenConfig): CapabilityGraph;')],
  ['AuthoritySpec', () => 'export type AuthoritySpec = string;'],
  ['KnowledgeReadContext', (value) => value.replace('readonly providerId: string;', 'readonly providerId: number;')],
  ['CapabilityGraph', (value) => value.replace('config: OpenConfig', 'config?: OpenConfig')],
  ['ID_PATTERN', (value) => value.replace('RegExp', 'string')],
  ['BatchResult', (value) => value.replace('BatchResult<T>', 'BatchResult<T extends string>')]
];
for (const [name, mutate] of signatureMutations) {
  const bad = structuredClone(contracts);
  const symbol = bad.symbols.find((item) => item.name === name);
  const previous = symbol.signature;
  symbol.signature = mutate(previous);
  assert.notEqual(symbol.signature, previous, `negative fixture did not mutate ${name}`);
  await assert.rejects(verifyGeneratedContracts(bad, coverage, docs, async (file) =>
    (await readFile(file, 'utf8')).replace(previous, symbol.signature)), /signature drifted from public declaration/);
}
const scratch = await createTemporaryDirectory('cg-contract-negatives-');
try {
  await mkdir(path.join(scratch, 'reference'));
  for (const name of ['provider-definition', 'knowledge', 'result-meta']) {
    const source = await readFile(path.join(docs, `reference/${name}.mdx`), 'utf8');
    await writeFile(path.join(scratch, `reference/${name}.mdx`), name === 'result-meta'
      ? source.replace('| `read.maxPageBytes` | 32768 |', '| `read.maxPageBytes` | 32769 |') : source, 'utf8');
  }
  await assert.rejects(verifyReferenceContracts(scratch), /every budget field and default/);
  await mkdir(path.join(scratch, 'integrations'));
  await mkdir(path.join(scratch, 'troubleshooting'));
  const adapterPages = ['reference/reader.mdx', 'integrations/knowledge-reader.mdx', 'troubleshooting/knowledge-read.mdx'];
  const originals = new Map(await Promise.all(adapterPages.map(async (page) => [page, await readFile(path.join(docs, page), 'utf8')])));
  for (const [page, source] of originals) await writeFile(path.join(scratch, page), source.replace('.slice(0, 16)', '.slice(0, 64)'), 'utf8');
  await assert.rejects(verifyReaderContracts(scratch), /documented Reader algorithm rejected by Core/);
  for (const [page, source] of originals) await writeFile(path.join(scratch, page), source, 'utf8');
  const readerPage = originals.get('integrations/knowledge-reader.mdx');
  const missingEmptyChunk = readerPage.replace(/      if \(!emitted\) yield \{[^\n]+\};\n/, '');
  assert.notEqual(missingEmptyChunk, readerPage, 'negative control must remove the empty-stream metadata chunk');
  await writeFile(path.join(scratch, 'integrations/knowledge-reader.mdx'), missingEmptyChunk);
  await assert.rejects(verifyReaderContracts(scratch), /documented Reader factory failed to page 0 bytes/);
} finally {
  assert.equal(path.dirname(scratch), artifactsRoot);
  assert(path.basename(scratch).startsWith('cg-contract-negatives-'));
  await rm(scratch, { recursive: true, force: true });
}
console.log(`contract negative controls passed: removed fields/signatures/enums, wrong type/optionality/default, ${signatureMutations.length} shared signature mutations, wrong Reader hash, missing empty-stream metadata`);
