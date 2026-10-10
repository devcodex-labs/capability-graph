import assert from 'node:assert/strict';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory } from '../lib/artifact-paths.mjs';

const defaults = { nodes: 10000, providers: 2, concurrency: 10, operations: 1000, durationMs: 0, reloadEvery: 500, reloadRounds: 2 };
const names = { '--nodes': 'nodes', '--providers': 'providers', '--concurrency': 'concurrency',
  '--operations': 'operations', '--duration-ms': 'durationMs', '--reload-every': 'reloadEvery', '--reload-rounds': 'reloadRounds' };
const kinds = ['catalog', 'filteredCatalog', 'details', 'neighbors', 'selection', 'documents', 'specification'];
const id = (index) => `c${String(index).padStart(6, '0')}`;
const maxLatencySamples = 4096;
const recordLatency = (state, value) => {
  state.count++; state.maxMs = Math.max(state.maxMs, value);
  if (state.values.length < maxLatencySamples) state.values.push(value);
  else {
    // Fixed-seed reservoir sampling bounds the validator's own memory on extended runs.
    state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
    const index = Math.floor(state.seed / 4294967296 * state.count);
    if (index < maxLatencySamples) state.values[index] = value;
  }
};
const summary = (state) => {
  const sorted = [...state.values].sort((a, b) => a - b);
  const percentile = (q) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? null;
  return { count: state.count, sampleCount: sorted.length, percentiles: state.count > maxLatencySamples ? 'reservoir sample' : 'exact',
    p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: state.maxMs };
};

export function normalizeCapacityOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => !(key in defaults))) {
    throw new Error('Unknown capacity option');
  }
  const resolved = { ...defaults, ...options };
  for (const [key, value] of Object.entries(resolved)) {
    const minimum = key === 'durationMs' || key === 'reloadEvery' ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid capacity option: ${key}`);
  }
  if (resolved.nodes < resolved.providers * 2) throw new Error('Each Provider needs a root and a child');
  if (resolved.operations < kinds.length * resolved.providers) throw new Error('Operations must cover every Provider and query kind');
  if (resolved.reloadRounds < 2) throw new Error('At least two reload rounds per Provider are required');
  return resolved;
}

export function parseCapacityOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]];
    if (!key || key in options || !/^\d+$/.test(args[index + 1] ?? '')) throw new Error(`Invalid argument: ${args[index]}`);
    options[key] = Number(args[index + 1]);
  }
  return normalizeCapacityOptions(options);
}

/** Repeatable file-authority load validation. Scratch sources are always outside the checkout. */
export async function runCapacity(options = {}, progress = () => {}) {
  const config = normalizeCapacityOptions(options);
  const root = await createTemporaryDirectory('capacity-source-');
  const manifest = (providerId, version) => ({ providerId, name: providerId, version,
    specification: { specificationId: `${providerId}.conventions`, version: '1', documents: [
      { kind: 'document', knowledgeId: 'SPEC', role: 'specification', locator: { type: 'relative-file', path: 'guide.md' } },
    ] } });
  const sources = Array.from({ length: config.providers }, (_, index) => ({ providerId: `bench.p${index}`,
    root: path.join(root, `p${index}`), nodes: Math.floor(config.nodes / config.providers) + (index < config.nodes % config.providers ? 1 : 0),
    version: '1', reloads: 0 }));
  const latencies = Object.fromEntries(kinds.map((kind) => [kind, { count: 0, values: [], maxMs: 0, seed: 12345 }]));
  const reloads = [];
  const retirementChecks = [];
  const providerQueries = Object.fromEntries(sources.map((source) => [source.providerId,
    Object.fromEntries(kinds.map((kind) => [kind, 0]))]));
  const catalogCoverage = { pages: 0, items: 0, itemsByProvider: Object.fromEntries(sources.map((source) => [source.providerId, 0])) };
  const memory = { samples: 0, sampledPeakHeapBytes: 0, sampledPeakRssBytes: 0, sampledPeakExternalBytes: 0 };
  const sample = () => {
    const usage = process.memoryUsage();
    memory.samples++;
    memory.sampledPeakHeapBytes = Math.max(memory.sampledPeakHeapBytes, usage.heapUsed);
    memory.sampledPeakRssBytes = Math.max(memory.sampledPeakRssBytes, usage.rss);
    memory.sampledPeakExternalBytes = Math.max(memory.sampledPeakExternalBytes, usage.external);
  };
  const begun = performance.now();
  const sampler = setInterval(sample, 250);
  let graph, reloadTask, failure, inFlight = 0, peakInFlight = 0, nextOperation = 0, cursorRestarts = 0;
  let setupMs, openMs, correctnessMs, workloadMs, closeMs, pinnedReadsCompleted = 0, pinBarrier;
  try {
    for (const source of sources) {
      await mkdir(source.root);
      await writeFile(path.join(source.root, 'provider.json'), JSON.stringify(manifest(source.providerId, source.version)));
      await writeFile(path.join(source.root, 'guide.md'), 'Capacity guide 正文\n');
      for (let offset = 0; offset < source.nodes; offset += 100) {
        await Promise.all(Array.from({ length: Math.min(100, source.nodes - offset) }, (_, slot) => {
          const index = offset + slot;
          return writeFile(path.join(source.root, `${id(index)}.capability.json`), JSON.stringify({
            capabilityId: id(index), name: `Capability ${index}`, description: 'Capacity validation', whenToUse: 'Controlled local load',
            ...(index ? { parents: [id(0)], specializes: [id(0)], related: [id(0)], requires: [id(0)] } : {}),
            knowledge: [{ kind: 'document', knowledgeId: 'GUIDE', role: 'guide', locator: { type: 'relative-file', path: 'guide.md' } }],
          }));
        }));
      }
      progress({ phase: 'sources', provider: source.providerId, nodes: source.nodes, directory: source.root });
    }
    setupMs = performance.now() - begun;
    sample();
    const opening = performance.now();
    graph = await CapabilityGraph.open({ hostAllowedProviders: sources.map((source) => source.providerId),
      integrationEnabledProviders: sources.map((source) => source.providerId),
      providers: sources.map((source) => ({ providerId: source.providerId, authority: { kind: 'file', rootDir: source.root } })),
      knowledgeRetriever: { id: 'capacity-pin', retrieve: async (input, access) => {
        assert(pinBarrier, 'only retirement probes use the controlled retriever');
        pinBarrier.entered.resolve();
        await pinBarrier.resume.promise;
        const documents = [];
        for (const target of input.targets) {
          const body = await access.read({ id: target.id, knowledgeId: target.knowledgeId }, { maxBytes: 32768 });
          assert.equal(new TextDecoder().decode(body.bytes), 'Capacity guide 正文\n');
          documents.push({ id: target.id, knowledgeId: target.knowledgeId,
            sourceContentId: body.contentId, indexedContentId: body.contentId });
        }
        return { hits: [], evidence: { staticRevisionByProvider: input.staticRevisionByProvider,
          mappingRevision: input.mappingRevision, observedAt: new Date().toISOString(), freshness: 'current',
          sourceConfigRevision: 'capacity-pin:1', indexedConfigRevision: 'capacity-pin:1', documents } };
      } } });
    openMs = performance.now() - opening;
    sample(); progress({ phase: 'open', openMs });
    const correctnessStart = performance.now();
    // A single uninterrupted walk proves every expected identity exactly once,
    // regardless of how far any individual load worker advances its cursor.
    const orderedSources = [...sources].sort((a, b) => a.providerId < b.providerId ? -1 : 1);
    let catalogCursor, providerIndex = 0, capabilityIndex = 0;
    do {
      const page = await graph.listCatalog({ limit: 100, ...(catalogCursor ? { cursor: catalogCursor } : {}) });
      assert(page.items.length > 0 && page.items.length <= 100, 'Catalog must make progress');
      assert.equal(page.meta.warnings.length, 0);
      assert(Buffer.byteLength(JSON.stringify(page)) <= 24576);
      for (const item of page.items) {
        const source = orderedSources[providerIndex];
        assert(source, 'Catalog returned an unexpected identity');
        assert.deepEqual(item.id, { providerId: source.providerId, capabilityId: id(capabilityIndex) });
        catalogCoverage.itemsByProvider[source.providerId]++;
        catalogCoverage.items++;
        if (++capabilityIndex === source.nodes) { providerIndex++; capabilityIndex = 0; }
      }
      catalogCoverage.pages++;
      catalogCursor = page.nextCursor;
    } while (catalogCursor);
    assert.equal(catalogCoverage.items, config.nodes, 'Catalog omitted expected identities');
    assert.equal(providerIndex, sources.length);
    progress({ phase: 'catalog-coverage', ...catalogCoverage });

    const reloadProvider = async (source, phase) => {
      const before = (await graph.getProvider(source.providerId)).staticRevision;
      const expired = source.previousRevision;
      source.version = String(++source.reloads + 1);
      await writeFile(path.join(source.root, 'provider.json'), JSON.stringify(manifest(source.providerId, source.version)));
      const overlap = inFlight;
      const started = performance.now();
      const result = await graph.reload({ providerId: source.providerId });
      assert(result.ok, 'reload must publish a validated file view');
      const current = await graph.getProvider(source.providerId);
      assert.notEqual(current.staticRevision, before);
      const retained = await graph.getProvider(source.providerId, { requiredStaticRevision: before });
      assert.equal(retained.meta.servedFrom, 'previous');
      if (expired) await assert.rejects(graph.getProvider(source.providerId, { requiredStaticRevision: expired }), { code: 'CG_REVISION_MISMATCH' });
      source.previousRevision = before;
      const event = { providerId: source.providerId, phase, durationMs: performance.now() - started, inFlightAtStart: overlap,
        pinnedQueryActive: Boolean(pinBarrier), revisionChanged: true, previousReadable: true, previousRetired: Boolean(expired) };
      reloads.push(event);
      progress({ ...event, reloadPhase: phase, phase: 'reload' });
    };
    const deferred = () => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject };
    };
    // Force multiple swaps for every Provider while a real public query holds
    // its original view. New queries must lose the oldest slot; the pin survives.
    for (const source of sources) {
      const pinnedRevision = (await graph.getProvider(source.providerId)).staticRevision;
      const barrier = { entered: deferred(), resume: deferred() };
      pinBarrier = barrier;
      const pending = graph.forProvider(source.providerId).queryKnowledge({ selected: [{ capabilityId: id(1) }],
        knowledgeIds: ['GUIDE'], text: 'no-match' });
      pending.then(() => barrier.entered.reject(new Error('Query did not reach the pin barrier')),
        (error) => barrier.entered.reject(error));
      try {
        await barrier.entered.promise;
        for (let round = 0; round < config.reloadRounds; round++) await reloadProvider(source, 'retirement');
        await assert.rejects(graph.getProvider(source.providerId, { requiredStaticRevision: pinnedRevision }), { code: 'CG_REVISION_MISMATCH' });
        barrier.resume.resolve();
        const page = await pending;
        assert.equal(page.meta.staticRevision, pinnedRevision);
        assert.equal(page.meta.completeness, 'complete');
        retirementChecks.push({ providerId: source.providerId, rounds: config.reloadRounds, previousRetired: true, pinnedQueryCompleted: true });
      } finally {
        barrier.resume.resolve();
        await Promise.allSettled([pending]);
        pinBarrier = undefined;
      }
    }
    assert.equal(retirementChecks.length, sources.length);
    correctnessMs = performance.now() - correctnessStart;
    sample(); progress({ phase: 'correctness', correctnessMs, retirementChecks });
    const workloadStart = performance.now();
    const deadline = workloadStart + config.durationMs;
    const maybeReload = (ordinal) => {
      if (!config.reloadEvery || ordinal % config.reloadEvery || reloadTask) return;
      const source = sources[reloads.length % sources.length];
      reloadTask = reloadProvider(source, 'load').catch((error) => { failure = error; }).finally(() => { reloadTask = undefined; });
    };
    const workers = await Promise.allSettled(Array.from({ length: config.concurrency }, (_, worker) => (async () => {
      let cursor;
      try {
        while (nextOperation < config.operations || performance.now() < deadline) {
          if (failure) throw failure;
          const ordinal = nextOperation++;
          const kind = kinds[ordinal % kinds.length];
          const source = sources[Math.floor(ordinal / kinds.length) % sources.length];
          const bound = graph.forProvider(source.providerId);
          const child = id(1 + ((ordinal + worker) % (source.nodes - 1)));
          const start = performance.now();
          inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
          maybeReload(ordinal + 1);
          try {
            if (kind === 'catalog') {
              try {
                const page = await graph.listCatalog({ limit: 100, ...(cursor ? { cursor } : {}) });
                assert(page.items.length > 0 && page.items.length <= 100);
                assert(page.items.every((item) => sources.some((source) => source.providerId === item.id.providerId)));
                assert.equal(page.meta.warnings.length, 0);
                assert(Buffer.byteLength(JSON.stringify(page)) <= 24576);
                for (const providerId of new Set(page.items.map((item) => item.id.providerId))) providerQueries[providerId].catalog++;
                cursor = page.nextCursor;
              } catch (error) {
                if (!cursor || error.code !== 'CG_REVISION_MISMATCH') throw error;
                cursor = undefined; cursorRestarts++;
                // Verify recovery immediately; a rejected stale cursor alone is not a successful query.
                const restarted = await graph.listCatalog({ limit: 100 });
                assert(restarted.items.length > 0); assert.equal(restarted.meta.warnings.length, 0);
                for (const providerId of new Set(restarted.items.map((item) => item.id.providerId))) providerQueries[providerId].catalog++;
                cursor = restarted.nextCursor;
              }
            } else if (kind === 'filteredCatalog') {
              const page = await bound.listCatalog({ parent: { providerId: source.providerId, capabilityId: id(0) }, limit: 30 });
              assert(page.items.length > 0 && page.items.every((item) => item.id.providerId === source.providerId && item.id.capabilityId !== id(0)));
              assert.equal(page.meta.warnings.length, 0);
            } else if (kind === 'details') {
              const page = await bound.getCapabilities([child], { neighborLimitPerKind: 0 });
              assert(page.results[0]?.ok);
              assert.equal(page.results[0].value.id.capabilityId, child);
            } else if (kind === 'neighbors') {
              const page = await bound.getNeighbors(id(0), { limitPerKind: 10 });
              for (const reverse of ['children', 'specializedBy', 'relatedBy', 'requiredBy']) {
                assert(page.groups[reverse].items.length > 0);
                assert(page.groups[reverse].items.every((item) => item.id.providerId === source.providerId && item.id.capabilityId !== id(0)));
              }
              assert.equal(page.meta.warnings.length, 0);
              assert(Buffer.byteLength(JSON.stringify(page)) <= 24576);
            } else if (kind === 'selection') {
              const page = await bound.resolveSelection({ selected: [child] });
              assert.deepEqual(page.resolved.map((item) => item.capabilityId).sort(), [id(0), child].sort());
            } else {
              const page = kind === 'documents' ? await bound.readDocuments({ selected: [child] }) : await bound.readSpecification();
              assert.equal(page.results.length, 1); assert(page.results[0].ok);
              assert.equal(page.results[0].value.text, 'Capacity guide 正文\n');
            }
            if (kind !== 'catalog') providerQueries[source.providerId][kind]++;
            recordLatency(latencies[kind], performance.now() - start);
          } finally { inFlight--; }
          // Let reload I/O, memory sampling and other workers run between CPU-heavy pages.
          await nextTurn();
        }
      } catch (error) { failure ??= error; throw error; }
    })()));
    await reloadTask;
    if (failure) throw failure;
    assert(workers.every((worker) => worker.status === 'fulfilled'));
    workloadMs = performance.now() - workloadStart;
    assert(kinds.every((kind) => latencies[kind].count), 'every query family must execute');
    assert(Object.values(providerQueries).every((counts) => kinds.filter((kind) => kind !== 'catalog').every((kind) => counts[kind] > 0)),
      'every Provider must execute every bound query family');
    assert(peakInFlight <= config.concurrency);
    const closing = performance.now();
    const pending = Array.from({ length: config.concurrency }, () => graph.forProvider(sources[0].providerId)
      .readDocuments({ selected: [id(1)] }).then((page) => { assert(page.results[0]?.ok); pinnedReadsCompleted++; }));
    await graph.close();
    await Promise.all(pending);
    await assert.rejects(graph.listCatalog(), { code: 'CG_NO_ACTIVE_VIEW' });
    await graph.close();
    closeMs = performance.now() - closing;
  } finally {
    await reloadTask;
    try { await graph?.close(); } finally {
      clearInterval(sampler); sample();
      await rm(root, { recursive: true, force: true });
    }
  }
  await assert.rejects(stat(root), { code: 'ENOENT' });
  return { ...config, node: process.version, platform: process.platform, topology: 'per-provider star with all four forward/reverse relations',
    authority: 'real file definitions and local document I/O', setupMs, openMs, correctnessMs, workloadMs, closeMs,
    operationsCompleted: Object.values(latencies).reduce((sum, state) => sum + state.count, 0), peakInFlight,
    queries: Object.fromEntries(kinds.map((kind) => [kind, summary(latencies[kind])])), providerQueries,
    catalogCoverage, retirementChecks, reloads, cursorRestarts,
    memory,
    pinnedReadsCompleted, closedQueriesRejected: true, temporarySourcesRemoved: true, modelCalls: 0,
    limitations: 'Local bounded load; sampled memory; no production SLA, database-driver retirement or model-quality claim' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCapacityOptions(process.argv.slice(2));
  const reportRoot = await createTemporaryDirectory('capacity-report-');
  const reportPath = path.join(reportRoot, 'result.json');
  try {
    const result = await runCapacity(options, (event) => console.error(JSON.stringify(event)));
    await writeFile(reportPath, JSON.stringify({ passed: true, ...result }, null, 2));
    console.log(JSON.stringify({ passed: true, reportPath, operationsCompleted: result.operationsCompleted, reloads: result.reloads.length }));
  } catch (error) {
    await writeFile(reportPath, JSON.stringify({ passed: false, ...options, error: { message: error.message, code: error.code } }, null, 2));
    console.error(JSON.stringify({ passed: false, reportPath })); throw error;
  }
}
