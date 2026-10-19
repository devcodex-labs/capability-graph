import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CapabilityGraph, GraphError } from '../src/index.js';
import type { ProviderDefinition } from '../src/index.js';

const definition = (id = 'acme'): ProviderDefinition => ({ providerId: id, name: id, version: '1.0.0', capabilities: [{ id: 'route', name: 'Route', description: 'HTTP route', documents: [{ id: 'guide', source: { type: 'file', path: 'guide.md' } }] }] });
const error = (code: string) => (e: unknown) => e instanceof GraphError && e.code === code;
async function workspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const base = path.resolve(process.env.CG_TEST_DIR!); await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'lifecycle-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const save = (file: string, value: unknown) => writeFile(file, JSON.stringify(value));

test('file reload publishes all candidates once and normalized unchanged returns unchanged', async () => workspace(async root => {
  const file = path.join(root, 'provider.json'); const p = definition(); await save(file, p);
  const graph = await CapabilityGraph.open({ providers: [{ file }] }); const first = (await graph.listCatalog()).meta.revision;
  assert.deepEqual((await graph.reload()).providers, [{ providerId: 'acme', status: 'unchanged' }]);
  p.capabilities[0]!.name = 'New route'; await save(file, p);
  const reload = await graph.reload(); assert(reload.ok); assert.notEqual(reload.revision, first); assert.deepEqual(reload.providers, [{ providerId: 'acme', status: 'updated' }]);
  assert.equal((await graph.getCapabilities({ ids: ['acme::route'] })).items[0]!.capability.name, 'New route');
  await graph.close();
}));
test('bad source fails atomically; another valid change is not_applied and old snapshot remains', async () => workspace(async root => {
  const a = definition('a'), b = definition('b'); const af = path.join(root, 'a.json'), bf = path.join(root, 'b.json'); await save(af, a); await save(bf, b);
  const graph = await CapabilityGraph.open({ providers: [{ file: af }, { file: bf }] }); const before = await graph.listCatalog();
  a.version = '2.0.0'; await save(af, a); await writeFile(bf, '{invalid');
  const result = await graph.reload(); assert.equal(result.ok, false); assert.equal(result.revision, before.meta.revision);
  assert.deepEqual(result.providers.map(p => [p.providerId, p.status]), [['a', 'not_applied'], ['b', 'failed']]);
  assert.equal(result.providers[1]!.error!.code, 'CG_DEFINITION_INVALID'); assert.deepEqual(await graph.listCatalog(), before);
  await graph.close();
}));
test('combined cross-Provider cycle reports actual graph error and both changes not_applied', async () => workspace(async root => {
  const a = definition('a'), b = definition('b'); const af = path.join(root, 'a.json'), bf = path.join(root, 'b.json'); await save(af, a); await save(bf, b);
  const graph = await CapabilityGraph.open({ providers: [{ file: af }, { file: bf }] }); const before = await graph.listCatalog();
  a.capabilities[0]!.relations = { requires: ['b::route'] }; b.capabilities[0]!.relations = { requires: ['a::route'] }; await save(af, a); await save(bf, b);
  const result = await graph.reload(); assert.equal(result.ok, false); assert.equal(result.error!.code, 'CG_RELATION_CYCLE'); assert(result.providers.every(p => p.status === 'not_applied')); assert.deepEqual(await graph.listCatalog(), before);
  await graph.close();
}));
test('individually invalid relation is a failed source and changed Provider identities are rejected', async () => workspace(async root => {
  const p = definition(); const file = path.join(root, 'p.json'); await save(file, p); const graph = await CapabilityGraph.open({ providers: [{ file }] });
  p.capabilities[0]!.relations = { requires: ['missing'] }; await save(file, p);
  const invalid = await graph.reload(); assert.equal(invalid.providers[0]!.status, 'failed'); assert.equal(invalid.providers[0]!.error!.code, 'CG_RELATION_INVALID');
  p.capabilities[0]!.relations = {}; p.providerId = 'changed'; await save(file, p);
  const changed = await graph.reload(); assert.equal(changed.providers[0]!.status, 'failed'); assert.equal(changed.providers[0]!.error!.code, 'CG_DEFINITION_INVALID'); await graph.close();
}));
test('single-provider reload leaves other files unread, serializes concurrent refreshes and closes queued work', async () => workspace(async root => {
  const a = definition('a'), b = definition('b'); const af = path.join(root, 'a.json'), bf = path.join(root, 'b.json'); await save(af, a); await save(bf, b);
  const graph = await CapabilityGraph.open({ providers: [{ file: af }, { file: bf }] }); a.name = 'New A'; await save(af, a); await writeFile(bf, '{');
  const [first, second] = await Promise.all([graph.reload({ providerId: 'a' }), graph.reload({ providerId: 'a' })]);
  assert.equal(first.providers[0]!.status, 'updated'); assert.equal(second.providers[0]!.status, 'unchanged'); assert.equal(first.revision, second.revision);
  const pending = graph.reload({ providerId: 'a' }); const rejected = assert.rejects(pending, error('CG_GRAPH_CLOSED')); await graph.close(); await rejected;
  await assert.rejects(graph.reload(), error('CG_GRAPH_CLOSED'));
}));
test('inline definitions are copied once and private-only changes do not affect public revision/status listing', async () => workspace(async root => {
  const p = definition('public'), secret = definition('private'); const file = path.join(root, 'private.json'); await save(file, secret);
  const graph = await CapabilityGraph.open({ providers: [{ definition: p }, { file }], allowedProviders: ['public'] }); const before = await graph.listCatalog();
  p.capabilities = []; secret.version = '2.0.0'; await save(file, secret);
  const result = await graph.reload(); assert(result.ok); assert.equal(result.revision, before.meta.revision); assert.deepEqual(result.providers, [{ providerId: 'public', status: 'unchanged' }]); assert.deepEqual(await graph.listCatalog(), before);
  await graph.close();
}));
test('document text/hash/length are derived from the same original BOM/CRLF/UTF-8 bytes', async () => workspace(async root => {
  const p = definition(); const file = path.join(root, 'p.json'); await save(file, p); const raw = Buffer.from('\ufeff首行\r\nsecond\r\n', 'utf8'); await writeFile(path.join(root, 'guide.md'), raw);
  const graph = await CapabilityGraph.open({ providers: [{ file }] }); const revision = (await graph.listCatalog()).meta.revision;
  const document = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' });
  assert.equal(document.text, '首行\r\nsecond\r\n'); assert.equal(document.byteLength, raw.length); assert.equal(document.contentHash, 'sha256:' + createHash('sha256').update(raw).digest('hex')); assert.equal(document.meta.revision, revision);
  await writeFile(path.join(root, 'guide.md'), 'changed'); const next = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }); assert.notEqual(next.contentHash, document.contentHash); assert.equal(next.meta.revision, revision); await graph.close();
}));
test('inline document roots, missing files/references and URL-reference-only errors are distinct', async () => workspace(async root => {
  const p = definition(); const missingRoot = await CapabilityGraph.open({ providers: [{ definition: p }] }); await assert.rejects(missingRoot.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }), error('CG_DOCUMENT_ROOT_REQUIRED')); await missingRoot.close();
  p.capabilities[0]!.documents!.push({ id: 'url', source: { type: 'url', url: 'https://127.0.0.1:1/unreachable' } });
  const graph = await CapabilityGraph.open({ providers: [{ definition: p, documentRoot: root }] });
  await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }), error('CG_DOCUMENT_NOT_FOUND'));
  await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'absent' }), error('CG_DOCUMENT_NOT_FOUND'));
  await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'url' }), error('CG_DOCUMENT_REFERENCE_ONLY'));
  await writeFile(path.join(root, 'guide.md'), 'valid'); assert.equal((await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' })).text, 'valid'); await graph.close();
}));
test('oversized, invalid UTF-8 and directory bodies fail with safe document errors', async () => workspace(async root => {
  const graph = await CapabilityGraph.open({ providers: [{ definition: definition(), documentRoot: root }], limits: { maxDocumentBytes: 4 } });
  await writeFile(path.join(root, 'guide.md'), '12345'); await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }), error('CG_DOCUMENT_TOO_LARGE'));
  await writeFile(path.join(root, 'guide.md'), Buffer.from([0xc3, 0x28])); await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }), error('CG_DOCUMENT_UNREADABLE'));
  await rm(path.join(root, 'guide.md')); await mkdir(path.join(root, 'guide.md')); await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }), error('CG_DOCUMENT_UNREADABLE')); await graph.close();
}));
test('escaping symlink cannot read an outside synthetic file; inside-root symlink stays within scope', async () => workspace(async root => {
  if (process.platform === 'win32') {
    // Junctions exercise canonical containment without requiring file-symlink privileges.
    const docs = path.join(root, 'docs'), outside = path.join(root, 'outside'), inside = path.join(docs, 'inside');
    await mkdir(inside, { recursive: true }); await mkdir(outside); await writeFile(path.join(outside, 'guide.md'), 'synthetic private'); await writeFile(path.join(inside, 'guide.md'), 'inside');
    const p = definition(); p.capabilities[0]!.documents = [{ id: 'guide', source: { type: 'file', path: 'alias/guide.md' } }];
    await symlink(outside, path.join(docs, 'alias'), 'junction'); const graph = await CapabilityGraph.open({ providers: [{ definition: p, documentRoot: docs }] });
    try { await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }), error('CG_DOCUMENT_ACCESS_DENIED')); await rm(path.join(docs, 'alias')); await symlink(inside, path.join(docs, 'alias'), 'junction'); assert.equal((await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' })).text, 'inside'); }
    finally { await graph.close(); }
    return;
  }
  const privateFile = path.join(root, 'synthetic-private.txt'); await writeFile(privateFile, 'synthetic private'); const docs = path.join(root, 'documents'); await mkdir(docs); await symlink(privateFile, path.join(docs, 'guide.md'));
  const graph = await CapabilityGraph.open({ providers: [{ definition: definition(), documentRoot: docs }] });
  await assert.rejects(graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' }), e => error('CG_DOCUMENT_ACCESS_DENIED')(e) && !(e as Error).message.includes(privateFile));
  await rm(path.join(docs, 'guide.md')); await writeFile(path.join(docs, 'inside.md'), 'inside'); await symlink(path.join(docs, 'inside.md'), path.join(docs, 'guide.md'));
  assert.equal((await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' })).text, 'inside'); await graph.close();
}));
