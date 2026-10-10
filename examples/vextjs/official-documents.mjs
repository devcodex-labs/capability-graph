import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './source-provenance.mjs';

/** Authored associations to unmodified upstream chapters, not copies of their text. */
export const officialChapters = {
  C01: ['guide/project-structure.md'], C02: ['guide/project-structure.md'],
  C03: ['guide/routing.md', 'api/route-definition.md', 'examples/hello-world.md'], C04: ['guide/validation.md'],
  C05: ['guide/services.md'], C06: ['guide/middleware.md'], C07: ['guide/plugins.md', 'api/plugin-api.md'],
  C08: ['guide/database.md'], C09: ['frontend/pages-and-rendering.md', 'frontend/layouts-and-components.md'],
  C10: ['frontend/static-assets-and-cdn.md'], C11: ['guide/i18n.md', 'frontend/i18n.md'],
  C12: ['guide/configuration.md', 'api/config.md'], C13: ['guide/openapi.md'], C14: ['guide/testing.md'],
  C15: ['guide/testing.md'], C16: ['guide/build.md'], C17: ['guide/cluster.md'],
  C19: ['guide/cache.md'], C20: ['guide/rate-limit.md'], C21: ['guide/cookies-session.md'],
  C22: ['guide/uploads.md'], C34: ['guide/jobs.md', 'api/jobs.md'],
  K05: ['guide/database.md'], K06: ['guide/cookies-session.md'], K07: ['guide/jobs.md'],
  'RCP-03': ['frontend/pages-and-rendering.md'], 'RCP-08': ['guide/plugins.md'],
};
export async function officialDocumentMappings(sourceRoot, catalog, commit) {
  const documents = new Map(); const mappings = [];
  for (const item of catalog.items) {
    const refs = [];
    for (const chapter of officialChapters[item.id] ?? []) {
      if (!documents.has(chapter)) {
        const originalPath = `website/docs/zh/${chapter}`; const bytes = await readFile(path.join(sourceRoot, originalPath));
        documents.set(chapter, { knowledgeId: `official-${chapter.replace(/[^A-Za-z0-9._-]/g, '-')}`, originalPath, role: 'guide', locale: 'zh',
          sha256: sha256(bytes), bytes: bytes.length, sourceCommit: commit, transformation: 'none; direct original-byte reading',
          url: `https://raw.githubusercontent.com/devcodex-labs/vextjs/${commit}/${originalPath}` });
      }
      const source = documents.get(chapter); refs.push({ kind: 'document', knowledgeId: source.knowledgeId, role: source.role, locale: source.locale,
        title: chapter, canonicalUrl: source.url, locator: { type: 'relative-file', root: 'official', path: source.originalPath } });
    }
    mappings.push({ nativeId: item.id, capabilityId: `native.${item.id.toLowerCase()}`, officialDocuments: refs,
      coverage: refs.length ? 'explicit-official-chapters; scenario evidence recorded separately' : 'native-only; no verified official-chapter association' });
  }
  return { documents: [...documents.values()], mappings, associationOrigin: 'Integration-authored explicit associations; original document bytes remain upstream' };
}
