import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { FileAuthorityStore } from '../../dist/store/file-authority-store.js';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory } from '../lib/artifact-paths.mjs';

const directory = await createTemporaryDirectory('capability-graph-file-profile-');
const count = Number(process.argv[2] || 1000);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('Expected 1..10000 records');
try {
  await writeFile(path.join(directory, 'provider.json'), JSON.stringify({ providerId: 'profile', name: 'Profile', version: '1' }));
  let definitionBytes = 0;
  for (let i = 0; i < count; i++) {
    const text = JSON.stringify({ capabilityId: `c${i}`, name: `Capability ${i}`, description: 'Definition loading profile', whenToUse: 'Profile full source loading' });
    definitionBytes += Buffer.byteLength(text); await writeFile(path.join(directory, `${i}.capability.json`), text);
  }
  const allocation = Buffer.allocUnsafe; let allocatedBytes = 0;
  Buffer.allocUnsafe = (size) => { allocatedBytes += size; return allocation(size); };
  try {
    const start = performance.now(); const source = await new FileAuthorityStore().load(directory); const loadMs = performance.now() - start;
    const recordAllocation = allocatedBytes; const openStart = performance.now();
    const graph = await CapabilityGraph.open({ hostAllowedProviders: ['profile'], integrationEnabledProviders: ['profile'], providers: [{ providerId: 'profile', authority: { kind: 'file', rootDir: directory } }] });
    await graph.close();
    console.log(JSON.stringify({ node: process.version, records: source.capabilities.length, definitionBytes,
      recordBufferAllocatedBytes: recordAllocation, loadMs, openAndCloseMs: performance.now() - openStart,
      memory: process.memoryUsage(), note: 'Cumulative Buffer.allocUnsafe allocation is not peak memory. Single fixed local workload; no network or model calls.' }, null, 2));
  } finally { Buffer.allocUnsafe = allocation; }
} finally { await rm(directory, { recursive: true, force: true }); }
