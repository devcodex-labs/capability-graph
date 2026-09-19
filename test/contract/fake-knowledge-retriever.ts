import type { KnowledgeRetriever, KnowledgeHit } from "../../src/knowledge/types.js";

/** Contract-only retrieval over Reader bytes, not a production retrieval algorithm or F-18 source. */
export const fakeKnowledgeRetriever: KnowledgeRetriever = {
  id: "fake-knowledge",
  async retrieve(input, access) {
    const documents = []; const hits: KnowledgeHit[] = [];
    for (const target of input.targets) {
      const read = await access.read({ id: target.id, knowledgeId: target.knowledgeId }, { maxBytes: 32768 });
      documents.push({ id: target.id, knowledgeId: target.knowledgeId, sourceContentId: read.contentId, indexedContentId: read.contentId });
      if (hits.length < input.limit && input.text !== "no-match") hits.push({ id: target.id, knowledgeId: target.knowledgeId,
        contentId: read.contentId, source: read.source, snippet: new TextDecoder().decode(read.bytes), startOffset: 0, endOffset: read.bytes.length });
    }
    return { hits, evidence: { staticRevisionByProvider: input.staticRevisionByProvider, mappingRevision: input.mappingRevision,
      observedAt: new Date().toISOString(), freshness: "current", sourceConfigRevision: "fake:1", indexedConfigRevision: "fake:1", documents } };
  },
};
