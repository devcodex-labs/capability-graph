import assert from "node:assert/strict";
import { runSeedTask } from "../dist-test/examples/seed-api/main.js";

const samples = [];
for (let i = 0; i < 5; i++) {
  const started = performance.now();
  const result = await runSeedTask();
  const durationMs = performance.now() - started;
  const documents = result.documents.results.flatMap((entry) => entry.ok ? [entry.value.knowledgeId] : []);
  assert.deepEqual(documents, ["D-02", "D-03"]);
  assert.deepEqual(result.selected, ["route.validation", "schema.request"]);
  assert.equal(result.catalog.items.length, 5);
  const bytes = Object.fromEntries(["providers", "catalog", "detail", "neighbors", "documents"].map((name) =>
    [name, Buffer.byteLength(JSON.stringify(result[name]), "utf8")]));
  assert.ok(bytes.catalog <= 24576);
  samples.push({ durationMs: Number(durationMs.toFixed(3)), responseBytes: bytes, queryCalls: 5,
    expectedDocuments: 2, returnedDocuments: documents.length, missingDocuments: 0, unexpectedDocuments: 0 });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, provider: "seed.http", providerVersion: "0.1.0",
  task: "Explicitly select validation and schema knowledge", acceptance: "Exact expected IDs and zero omissions; configured budgets respected",
  conditions: "5 sequential local runs; duration includes open and close; deterministic selection, not an LLM evaluation",
  retrievalComparison: "N/A: no real retriever configured", modelCalls: 0, monetaryCost: "N/A: no paid service invoked",
  samples }, null, 2));
