import assert from 'node:assert/strict';

const sha = /^[0-9a-f]{40}$/i;
export function assertDocsBaseline({ version, registryVersion, tagVersion, coreChanged, documentationCommit, mainCommit }) {
  assert(/^\d+\.\d+\.\d+$/.test(version), 'documentation must target a stable package');
  assert.equal(registryVersion, version, 'documentation package must equal npm latest');
  assert.equal(tagVersion, version, 'package baseline tag/version mismatch');
  assert(!coreChanged, 'unreleased Core changes cannot be deployed as package documentation');
  assert(sha.test(documentationCommit) && sha.test(mainCommit), 'invalid documentation/main commit');
  assert.equal(documentationCommit, mainCommit, 'stale main snapshot; rerun against current main');
}

export async function readPublishedIdentity(fetcher, url) {
  const response = await fetcher(url);
  if (response.status === 404) return undefined; // first deployment only
  assert(response.ok, `public deployment identity unavailable: HTTP ${response.status}`);
  const published = await response.json();
  assert.equal(published.schemaVersion, 'CapabilityGraphPublicReleaseV1', 'unknown public identity schema');
  assert.equal(published.packageName, '@devcodex/capability-graph', 'unexpected deployed package');
  const commit = published.documentationCommit ?? published.releaseCommit;
  assert(sha.test(commit), 'invalid deployed documentation commit');
  return { ...published, documentationCommit: commit };
}

export function assertPagesAdvance({ candidateCommit, publishedCommit, publishedIsAncestor }) {
  assert(sha.test(candidateCommit), 'invalid candidate documentation commit');
  if (!publishedCommit || candidateCommit === publishedCommit) return;
  assert(sha.test(publishedCommit), 'invalid deployed commit');
  assert(publishedIsAncestor, 'refusing to overwrite newer or divergent documentation');
}
