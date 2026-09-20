import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph } from '../../dist/index.js';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const statuses = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'example-status.json'), 'utf8'));
const allowedStatuses = new Set(['Runnable', 'Contract-only', 'Conceptual']);
const ids = new Set();
for (const entry of statuses) {
  assert(!ids.has(entry.id), `duplicate example status: ${entry.id}`);
  ids.add(entry.id);
  assert(allowedStatuses.has(entry.status), `invalid example status for ${entry.id}`);
  if (entry.status === 'Conceptual') {
    assert(entry.source === null && entry.verify === null, `${entry.id} must not claim a runnable source`);
    continue;
  }
  assert(typeof entry.source === 'string' && typeof entry.verify === 'string', `${entry.id} must declare source and verification`);
  const source = entry.source.startsWith('fixtures/')
    ? path.join(websiteRoot, entry.source)
    : path.resolve(websiteRoot, entry.source);
  await access(source);
  assert((await stat(source)).isFile() || (await stat(source)).isDirectory(), `${entry.id} source is not readable`);
}
const vextjs = statuses.find(({ id }) => id === 'vextjs-integration');
assert(vextjs?.status === 'Conceptual', 'VextJS must remain Conceptual in V1');

const fixtureRoot = path.join(websiteRoot, 'fixtures', 'first-provider');
const fixtureFiles = ['provider.json', 'route.capability.json', 'route-http.capability.json'];
const fixture = Object.fromEntries(await Promise.all(fixtureFiles.map(async (file) => [
  file,
  JSON.parse(await readFile(path.join(fixtureRoot, file), 'utf8'))
])));
const snapshot = JSON.parse(await readFile(path.join(websiteRoot, 'generated', 'snippets', 'first-provider.json'), 'utf8'));
assert(JSON.stringify(snapshot) === JSON.stringify(fixture), 'generated First Provider snapshot drifted from fixtures');

const tutorial = await readFile(path.join(websiteRoot, 'docs', 'getting-started', 'first-provider.mdx'), 'utf8');
const documented = new Map();
for (const match of tutorial.matchAll(/```json title="([^"]+)"\r?\n([\s\S]*?)\r?\n```/g)) {
  documented.set(match[1], JSON.parse(match[2]));
}
for (const file of fixtureFiles) {
  assert(documented.has(file), `First Provider tutorial is missing ${file}`);
  assert(JSON.stringify(documented.get(file)) === JSON.stringify(fixture[file]), `${file} documentation drifted from fixture`);
}

const graph = await CapabilityGraph.open({
  hostAllowedProviders: ['acme.http'],
  integrationEnabledProviders: ['acme.http'],
  providers: [{ providerId: 'acme.http', authority: { kind: 'file', rootDir: fixtureRoot } }]
});
try {
  const provider = graph.forProvider('acme.http');
  const catalog = await provider.listCatalog({ limit: 20 });
  assert(catalog.items.length === 2, `expected 2 catalog entries, received ${catalog.items.length}`);
  assert(catalog.items.map(({ id }) => id.capabilityId).join(',') === 'route,route.http', 'catalog order or identities changed');
  assert(catalog.meta.completeness === 'complete' && !catalog.nextCursor, 'First Provider catalog must be complete');

  const revision = catalog.meta.staticRevision;
  assert(typeof revision === 'string' && revision.length > 0, 'single-provider catalog must expose staticRevision');
  const details = await provider.getCapabilities(['route.http'], { requiredStaticRevision: revision });
  assert(details.results.length === 1 && details.results[0].ok, 'route.http detail must resolve');
  assert(details.results[0].value.id.capabilityId === 'route.http', 'detail returned the wrong capability');

  const neighbors = await provider.getNeighbors('route.http', { requiredStaticRevision: revision });
  assert(neighbors.groups.parents.items.length === 1, 'route.http must expose one direct parent');
  assert(neighbors.groups.parents.items[0].id.capabilityId === 'route', 'route.http parent must be route');
  assert(neighbors.groups.children.items.length === 0, 'route.http must not invent children');
} finally {
  await graph.close();
}

await access(path.join(repositoryRoot, 'dist', 'index.d.ts'));
console.log(`example check passed: ${statuses.length} status entries and runnable First Provider flow`);
