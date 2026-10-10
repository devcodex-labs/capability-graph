import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProviderOutput } from './provider-output.mjs';
import { officialDocumentMappings, capabilityFileFor } from './official-documents.mjs';
import { isVerifiedSource, sha256 } from './source-provenance.mjs';

/** Human-facing task Provider: exact official chapters, semantic identities, provenance outside knowledge/. */
export async function exportVextProvider({ catalog, providerId = 'vextjs', version, source, sourceRoot, outputDir, repositoryRoot }) {
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(providerId) || !version || !source?.identity) throw new Error('Explicit source identity required');
  const official = await officialDocumentMappings(sourceRoot, catalog, source.commit);
  const output = await createProviderOutput(outputDir, repositoryRoot);
  const documents = [];
  for (const document of official.documents) {
    const bytes = await readFile(path.join(sourceRoot, document.originalPath));
    if (sha256(bytes) !== document.sha256) throw new Error(`Official source changed during export: ${document.chapter}`);
    const exportedPath = `knowledge/${document.chapter}`;
    await mkdir(path.dirname(path.join(output, exportedPath)), { recursive: true });
    await writeFile(path.join(output, exportedPath), bytes);
    documents.push({ ...document, exportedPath, exportedSha256: sha256(bytes), transformation: 'none; byte-exact upstream copy',
      verification: { sourceBytes: 'byte-exact-export', frameworkBehavior: 'not-established-by-document-reading' } });
  }
  const reference = (document) => ({ kind: 'document', knowledgeId: document.knowledgeId, role: document.role,
    locale: document.locale, title: document.title, canonicalUrl: document.url,
    locator: { type: 'relative-file', path: document.exportedPath } });
  for (const topic of official.topics) {
    const attached = topic.chapters.map((chapter) => documents.find((item) => item.chapter === chapter));
    const record = { capabilityId: topic.capabilityId, name: topic.name,
      description: `VextJS 官方文档主题：${attached.map((item) => item.title).join('；')}。文档关联不代表功能已执行验证。`,
      whenToUse: topic.whenToUse, knowledge: attached.map(reference) };
    const file = path.join(output, capabilityFileFor(topic.capabilityId));
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(record, null, 2) + '\n');
  }
  await writeFile(path.join(output, 'provider.json'), JSON.stringify({ providerId, name: 'VextJS 官方文档能力', version,
    specification: { specificationId: 'development-specifications', version,
      documents: documents.filter((document) => document.role === 'specification').map(reference) } }, null, 2) + '\n');
  const manifest = { schemaVersion: 2, providerId, version, source,
    sourceVerification: isVerifiedSource(source) ? 'verified-fixed-source-build' : 'caller-declared; contract fixture only',
    associationOrigin: official.associationOrigin, inventoryPolicy: official.inventoryPolicy,
    documents, capabilities: official.topics.map(({ capabilityId, chapters }) => ({ capabilityId, definitionPath: capabilityFileFor(capabilityId), chapters })) };
  await writeFile(path.join(output, 'metadata/source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(output, 'metadata/native-id-map.json'), JSON.stringify({ schemaVersion: 1, catalogDigest: catalog?.digest ?? null,
    note: 'Native identities are provenance associations, not public capability IDs or inferred requires. Unmapped records remain in the independent native audit.', mappings: official.mappings }, null, 2) + '\n');
  return { rootDir: output, manifest, count: official.topics.length, documentCount: documents.length };
}
