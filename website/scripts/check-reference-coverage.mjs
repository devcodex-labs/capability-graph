import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CapabilityGraph } from '../../dist/index.js';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const contracts = await readJson(path.join(websiteRoot, 'generated', 'contracts', 'public-api.json'));
const unions = await readJson(path.join(websiteRoot, 'generated', 'contracts', 'literal-unions.json'));
const coverage = await readJson(path.join(websiteRoot, 'data', 'reference-coverage.json'));
const definitionCases = await readJson(path.join(websiteRoot, 'data', 'definition-cases.json'));
const errorGuidance = await readJson(path.join(websiteRoot, 'data', 'error-guidance.json'));
const docsRoot = path.join(websiteRoot, 'docs');
const allowedStatuses = new Set(['Available', 'Contract-only', 'Conceptual']);
const statusLabels = new Map([
  ['Available', '可用'],
  ['Contract-only', '仅合同'],
  ['Conceptual', '概念示例']
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactMembers(label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  assert(actualSet.size === actual.length, `${label} contains duplicates`);
  const missing = expected.filter((item) => !actualSet.has(item));
  const stale = actual.filter((item) => !expectedSet.has(item));
  assert(!missing.length && !stale.length, `${label} mismatch; missing=${missing.join(',')} stale=${stale.join(',')}`);
}

const publicSymbols = contracts.symbols.map(({ name }) => name);
assertExactMembers('reference coverage', coverage.entries.map(({ symbol }) => symbol), publicSymbols);
for (const entry of coverage.entries) {
  assert(allowedStatuses.has(entry.status), `invalid status for ${entry.symbol}: ${entry.status}`);
  const pagePath = path.join(docsRoot, entry.page);
  const page = await readFile(pagePath, 'utf8');
  const statusLabel = statusLabels.get(entry.status);
  assert(page.includes(`>${statusLabel}<`), `${entry.page} must display ${statusLabel} for ${entry.symbol}`);
}

for (const name of ['ErrorCode', 'NextAction', 'KnowledgeKind', 'NeighborKind', 'RuntimeCompatibility']) {
  assert(Array.isArray(unions[name]) && unions[name].length > 0, `${name} literal union was not extracted`);
  assert(new Set(unions[name]).size === unions[name].length, `${name} contains duplicate literals`);
}
assertExactMembers('error guidance', errorGuidance.map(({ code }) => code), unions.ErrorCode);
for (const entry of errorGuidance) {
  assert(typeof entry.meaning === 'string' && entry.meaning.length > 0, `${entry.code} needs a meaning`);
  assert(typeof entry.trigger === 'string' && entry.trigger.length > 0, `${entry.code} needs a trigger`);
  assert(unions.NextAction.includes(entry.action), `${entry.code} has invalid action ${entry.action}`);
  assert(typeof entry.handling === 'string' && entry.handling.length > 0, `${entry.code} needs caller handling`);
}
const capabilityGraphPage = await readFile(path.join(docsRoot, 'reference', 'capability-graph.mdx'), 'utf8');
const errorsPage = await readFile(path.join(docsRoot, 'reference', 'errors.mdx'), 'utf8');
assert(capabilityGraphPage.includes("generated/snippets/public-api.mdx"), 'CapabilityGraph reference must render generated symbols');
assert(errorsPage.includes("generated/snippets/errors.mdx"), 'Errors reference must render generated unions');

const baseProvider = { providerId: 'acme.http', name: 'Acme HTTP', version: '0.1.0' };
const baseCapability = {
  capabilityId: 'route',
  name: 'Routing',
  description: 'Define how requests reach handlers.',
  whenToUse: 'Use before changing an entrypoint.'
};

function mutationFor(testCase) {
  const provider = structuredClone(baseProvider);
  const capability = structuredClone(baseCapability);
  const capabilities = [capability];
  let configProviderId = provider.providerId;
  switch (testCase.mutation) {
    case 'provider-valid-minimal': break;
    case 'provider-missing-id': delete provider.providerId; break;
    case 'provider-invalid-id': provider.providerId = 'Acme HTTP'; configProviderId = 'acme.http'; break;
    case 'provider-empty-name': provider.name = ' '; break;
    case 'provider-empty-version': provider.version = ''; break;
    case 'provider-invalid-specification': provider.specification = { version: '1' }; break;
    case 'provider-config-mismatch': provider.providerId = 'acme.other'; break;
    case 'provider-valid-specification': provider.specification = {
      specificationId: 'acme.http.conventions', version: '1',
      documents: [{ kind: 'document', knowledgeId: 'SPEC-01', role: 'specification',
        locator: { type: 'relative-file', path: 'PROVIDER.md' } }]
    }; break;
    case 'capability-valid-minimal': break;
    case 'capability-missing-id': delete capability.capabilityId; break;
    case 'capability-invalid-id': capability.capabilityId = 'Route HTTP'; break;
    case 'capability-duplicate-id': capabilities.push(structuredClone(capability)); break;
    case 'capability-missing-name': delete capability.name; break;
    case 'capability-missing-description': delete capability.description; break;
    case 'capability-missing-when': delete capability.whenToUse; break;
    case 'capability-defaults': break;
    case 'capability-missing-endpoint': capability.parents = ['missing']; break;
    case 'capability-parent-cycle': capability.parents = ['route']; break;
    case 'capability-specializes-cycle': capability.specializes = ['route']; break;
    case 'capability-cross-provider': capability.related = ['other::route']; break;
    case 'capability-invalid-knowledge': capability.knowledge = [{ kind: 'document', knowledgeId: 'guide' }]; break;
    case 'capability-duplicate-knowledge': capability.knowledge = [
      { kind: 'document', knowledgeId: 'guide', role: 'guide', locator: { type: 'http', url: 'https://example.com/a' } },
      { kind: 'document', knowledgeId: 'guide', role: 'guide', locator: { type: 'http', url: 'https://example.com/b' } }
    ]; break;
    case 'capability-path-traversal': capability.knowledge = [{
      kind: 'document', knowledgeId: 'guide', role: 'guide', locator: { type: 'relative-file', path: '../outside.md' }
    }]; break;
    case 'capability-oversized': capability.description = 'x'.repeat(262_145); break;
    default: throw new Error(`unimplemented definition mutation: ${testCase.mutation}`);
  }
  return { provider, capabilities, configProviderId };
}

async function executeDefinitionCase(testCase) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'capability-graph-definition-'));
  try {
    const setup = mutationFor(testCase);
    await writeFile(path.join(root, 'provider.json'), `${JSON.stringify(setup.provider, null, 2)}\n`, 'utf8');
    await writeFile(path.join(root, 'PROVIDER.md'), '# Acme HTTP\n', 'utf8');
    for (const [index, capability] of setup.capabilities.entries()) {
      await writeFile(path.join(root, `${index}.capability.json`), `${JSON.stringify(capability, null, 2)}\n`, 'utf8');
    }
    let graph;
    try {
      graph = await CapabilityGraph.open({
        hostAllowedProviders: [setup.configProviderId],
        integrationEnabledProviders: [setup.configProviderId],
        providers: [{ providerId: setup.configProviderId, authority: { kind: 'file', rootDir: root } }]
      });
      assert(testCase.expect === 'success', `${testCase.id} expected ${testCase.expect} but succeeded`);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : error?.constructor?.name;
      assert(code === testCase.expect, `${testCase.id} expected ${testCase.expect} but received ${String(code)}`);
    } finally {
      await graph?.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

assertExactMembers(
  'definition cases',
  definitionCases.cases.map(({ id }) => id),
  [
    ...Array.from({ length: 8 }, (_, index) => `DEF-PROVIDER-${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 16 }, (_, index) => `DEF-CAP-${String(index + 1).padStart(2, '0')}`)
  ]
);
const providerPage = await readFile(path.join(docsRoot, 'reference', 'provider-definition.mdx'), 'utf8');
const capabilityPage = providerPage;
for (const testCase of definitionCases.cases) {
  const page = testCase.target === 'provider' ? providerPage : capabilityPage;
  assert(page.includes(`\`${testCase.id}\``), `${testCase.id} is not documented`);
  await executeDefinitionCase(testCase);
}

console.log(`reference check passed: ${publicSymbols.length} symbols, ${definitionCases.cases.length} definition cases`);
