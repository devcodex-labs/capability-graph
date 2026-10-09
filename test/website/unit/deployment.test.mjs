import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { assertDocsBaseline, assertPagesAdvance, readPublishedIdentity } from '../../../scripts/validation/website/lib/deployment-contract.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40);
const valid = { version: '1.0.1', registryVersion: '1.0.1', tagVersion: '1.0.1', coreChanged: false,
  documentationCommit: a, mainCommit: a };
assertDocsBaseline(valid);
for (const mutation of [{ registryVersion: '1.0.2' }, { tagVersion: '1.0.0' }, { coreChanged: true },
  { documentationCommit: 'invalid' }, { mainCommit: b }, { version: '1.0.1-rc.1' }]) {
  assert.throws(() => assertDocsBaseline({ ...valid, ...mutation }));
}
assertPagesAdvance({ candidateCommit: a });
assertPagesAdvance({ candidateCommit: b, publishedCommit: a, publishedIsAncestor: true });
assert.throws(() => assertPagesAdvance({ candidateCommit: a, publishedCommit: b, publishedIsAncestor: false }));
assert.throws(() => assertPagesAdvance({ candidateCommit: 'HEAD' }));
const response = (status, body) => async () => ({ status, ok: status === 200, json: async () => body });
assert.equal(await readPublishedIdentity(response(404), 'test'), undefined);
for (const status of [403, 500]) await assert.rejects(readPublishedIdentity(response(status), 'test'));
const identity = { schemaVersion: 'CapabilityGraphPublicReleaseV1', packageName: '@devcodex/capability-graph', releaseCommit: a };
assert.equal((await readPublishedIdentity(response(200, identity), 'test')).documentationCommit, a);
await assert.rejects(readPublishedIdentity(response(200, { ...identity, documentationCommit: 'invalid' }), 'test'));
const workflow = await readFile(new URL('../../../.github/workflows/docs-deploy.yml', import.meta.url), 'utf8');
for (const file of ['ci', 'docs-ci', 'docs-deploy', 'release']) {
  const parsed = parseDocument(await readFile(new URL(`../../../.github/workflows/${file}.yml`, import.meta.url), 'utf8'));
  assert.deepEqual(parsed.errors, [], `${file}: invalid YAML`);
  const value = parsed.toJSON();
  assert(value.on && value.jobs && value.permissions, `${file}: missing workflow controls`);
  for (const [name, job] of Object.entries(value.jobs)) {
    assert(job['runs-on'] && Array.isArray(job.steps), `${file}.${name}: incomplete job`);
    const needs = job.needs === undefined ? [] : [].concat(job.needs);
    assert(needs.every((dependency) => dependency in value.jobs), `${file}.${name}: unknown dependency`);
    for (const step of job.steps) assert(Boolean(step.run) !== Boolean(step.uses), `${file}.${name}: ambiguous step`);
  }
  if (file === 'docs-deploy') {
    assert.deepEqual(Object.keys(value.on), ['workflow_dispatch']);
    assert.equal(value.jobs.build.if, "github.ref == 'refs/heads/main'");
    assert.equal(value.jobs.deploy.environment.name, 'github-pages');
    assert.equal(value.jobs.deploy.permissions.pages, 'write');
    assert.equal(value.jobs.deploy.permissions.contents, 'read');
    assert(!value.jobs.build.permissions?.['id-token'], 'no publishing authority in the build job');
  }
}
assert(!/npm publish|NPM_TOKEN|pull_request:/.test(workflow), 'documentation deploy must not publish packages or consume PR authority');
assert(workflow.includes('workflow_dispatch:') && workflow.includes('capability-graph-production') && workflow.includes('name: github-pages'));
for (const gate of ['check-docs-deployment.mjs', 'check-pages-advance.mjs', 'check-registry-install.mjs', 'npm run build', 'test:site', 'check:build']) {
  assert(workflow.includes(gate), `documentation workflow omitted ${gate}`);
}
console.log('deployment contracts passed: baseline/staleness/rollback/network failures and manual protected workflow');
