import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { repositoryRoot } from '../../lib/artifact-paths.mjs';
import { assertPagesAdvance, readPublishedIdentity } from './lib/deployment-contract.mjs';

const candidateCommit = process.env.DOCS_COMMIT;
assert(candidateCommit, 'DOCS_COMMIT must identify the frozen documentation, not just the package tag');
const expectedVersion = process.env.PACKAGE_VERSION;
assert(expectedVersion, 'PACKAGE_VERSION required');
const latest = JSON.parse(execFileSync('npm', ['view', '@devcodex/capability-graph', 'dist-tags.latest', '--json', '--prefer-online'], {
  cwd: repositoryRoot, encoding: 'utf8'
}));
assert.equal(latest, expectedVersion, 'refusing to deploy documentation for a stale npm version');
const published = await readPublishedIdentity((url) => fetch(url, {
  signal: AbortSignal.timeout(15_000), headers: { 'cache-control': 'no-cache' }
}), `https://devcodex-labs.github.io/capability-graph/release.json?revision=${candidateCommit}`);
const relation = published ? spawnSync('git', ['merge-base', '--is-ancestor', published.documentationCommit, candidateCommit], { cwd: repositoryRoot }) : undefined;
if (relation) assert([0, 1].includes(relation.status), 'cannot establish deployed commit ancestry; fetch full history before deploying');
assertPagesAdvance({ candidateCommit, publishedCommit: published?.documentationCommit, publishedIsAncestor: relation?.status === 0 });
console.log('Pages advance gate passed: current npm baseline, no documentation rollback');
