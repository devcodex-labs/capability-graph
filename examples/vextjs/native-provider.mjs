import { createHash } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nativeKinds = new Set(['capability', 'rule', 'recipe', 'knowledge', 'workflow']);
export const capabilityIdFor = (id) => `native.${id.toLowerCase()}`;
export function decodeNative(result) {
  if (result.isError) throw new Error('Native MCP operation failed');
  const data = result.structuredContent ?? JSON.parse(result.content?.find((item) => item.type === 'text')?.text ?? '{}');
  if (data.status !== 'ok' || data.schemaVersion !== 2) throw new Error('Unsupported native MCP response');
  return data;
}

/** Native schema 2 has no paged knowledge enumeration resource. The pinned snapshot supplies identities;
 * every body is read back from native MCP, with the same catalog digest. No hand-authored second catalog. */
export async function readNativeCatalog(client, expected) {
  if (!expected?.digest || !Array.isArray(expected.items)) throw new Error('Pinned catalog snapshot required');
  const items = []; const seen = new Set();
  for (const kind of ['capability', 'rule', 'recipe', 'workflow']) {
    const result = await client.request('resources/read', { uri: `vext://catalog/${kind === 'capability' ? 'capabilities' : kind + 's'}` });
    const resource = JSON.parse(result.contents?.[0]?.text ?? '{}');
    if (resource.status !== 'ok' || resource.schemaVersion !== 2 || resource.catalogDigest !== expected.digest || !Array.isArray(resource.items)) throw new Error('Native catalog drift');
    items.push(...resource.items);
  }
  const ids = expected.items.filter((item) => item.kind === 'knowledge').map((item) => item.id);
  for (let offset = 0; offset < ids.length; offset += 10) {
    const response = decodeNative(await client.request('tools/call', { name: 'vext_knowledge_search', arguments: { ids: ids.slice(offset, offset + 10), limit: 10 } }));
    if (response.catalogDigest !== expected.digest || response.unknownIds.length) throw new Error('Native knowledge drift');
    items.push(...response.matches.map(({ score, ...item }) => item));
  }
  for (const item of items) {
    if (!nativeKinds.has(item.kind) || !/^[A-Za-z][A-Za-z0-9._-]{0,120}$/.test(item.id) || seen.has(item.id)) throw new Error('Invalid native identity');
    seen.add(item.id);
  }
  if (seen.size !== expected.items.length || expected.items.some((item) => !seen.has(item.id))) throw new Error('Native catalog incomplete');
  // Readback must preserve the bundled semantic fields. Applicability is project-specific evidence, not static knowledge.
  const normalize = (item) => { const { score, ...copy } = item; if (copy.dependency) { const { applicability, ...dependency } = copy.dependency; copy.dependency = dependency; } return copy; };
  for (const item of items) {
    const original = expected.items.find((entry) => entry.id === item.id);
    const copy = normalize(item); const source = normalize(original);
    // Native resource bodies may omit computed domains; preserve the snapshot's computed domains.
    copy.domains = source.domains;
    if (JSON.stringify(copy) !== JSON.stringify(source)) {
      // Object key order is not a semantic difference.
      const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
      if (JSON.stringify(canonical(copy)) !== JSON.stringify(canonical(source))) throw new Error(`Native body mismatch: ${item.id}`);
    }
  }
  return { schemaVersion: 2, digest: expected.digest, items: expected.items.map(normalize) };
}

/** Generate file-authority records and real document bodies into a NEW external directory. */
export async function exportVextProvider({ catalog, providerId = 'vextjs', version, source, outputDir, repositoryRoot }) {
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(providerId) || !version || !source?.identity || !catalog?.digest || !Array.isArray(catalog.items)) throw new Error('Explicit source identity and catalog required');
  const mapped = new Set();
  for (const item of catalog.items) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,120}$/.test(item.id) || !nativeKinds.has(item.kind) || mapped.has(capabilityIdFor(item.id)) ||
        ![item.title, item.summary, item.body, item.status].every((value) => typeof value === 'string' && value.length)) throw new Error('Invalid native catalog');
    mapped.add(capabilityIdFor(item.id));
  }
  const parent = await realpath(path.dirname(outputDir)); const repository = await realpath(repositoryRoot);
  const output = path.join(parent, path.basename(outputDir));
  const below = path.relative(repository, output); const above = path.relative(output, repository);
  if ((!below.startsWith('..' + path.sep) && !path.isAbsolute(below)) || (!above.startsWith('..' + path.sep) && !path.isAbsolute(above))) throw new Error('Generated Provider must be outside the repository');
  await mkdir(output); await mkdir(path.join(output, 'knowledge'));
  const ids = new Set(catalog.items.map((item) => item.id));
  const manifest = { schemaVersion: 1, providerId, version, source, nativeCatalogDigest: catalog.digest,
    mappingDigest: hash(catalog.items), kinds: [...nativeKinds], note: 'Native statuses and dependency applicability are evidence, not execution support. relatedIds are optional context; no necessary dependencies are inferred.' };
  await writeFile(path.join(output, 'knowledge/catalog.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(output, 'provider.json'), JSON.stringify({ providerId, name: 'VextJS native MCP knowledge', version,
    specification: { specificationId: 'native-catalog', version, documents: [{ kind: 'document', knowledgeId: 'SPEC-native', role: 'specification', locator: { type: 'relative-file', path: 'knowledge/catalog.json' } }] } }, null, 2) + '\n');
  for (const item of catalog.items) {
    const capabilityId = capabilityIdFor(item.id); const bodyPath = `knowledge/${item.id}.json`;
    await writeFile(path.join(output, bodyPath), JSON.stringify({ source, catalogDigest: catalog.digest, ...item }, null, 2) + '\n');
    await writeFile(path.join(output, `${capabilityId}.capability.json`), JSON.stringify({ capabilityId, name: `${item.title} (${item.id})`,
      description: `${item.kind}; ${item.status}. ${item.summary}`,
      whenToUse: `Consult native ${item.kind} guidance for ${item.domains?.join(', ') || 'VextJS'}; status=${item.status}; verify project prerequisites before execution.`,
      related: (item.relatedIds ?? []).filter((id) => ids.has(id)).map(capabilityIdFor),
      knowledge: [{ kind: 'document', knowledgeId: item.id, role: item.kind, title: item.title, summary: item.summary,
        locator: { type: 'relative-file', path: bodyPath } }] }, null, 2) + '\n');
  }
  return { rootDir: output, manifest, count: catalog.items.length };
}
