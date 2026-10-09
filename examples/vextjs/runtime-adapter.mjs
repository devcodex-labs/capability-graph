import { createHash } from 'node:crypto';
import { CapabilityGraphError } from '@devcodex/capability-graph';
import { capabilityIdFor, decodeNative } from './native-provider.mjs';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Project and runtime snapshot evidence. An available stopped snapshot never proves process liveness. */
export class VextNativeRuntimeAdapter {
  id = 'vext-native-runtime';
  constructor({ client, providerId = 'vextjs', project, environment, projectRoot, deploymentRevisionBySource = {} }) {
    Object.assign(this, { client, providerId, project, environment, projectRoot, deploymentRevisionBySource });
  }
  async query(input) {
    if (input.project !== this.project || input.environment !== this.environment) throw new CapabilityGraphError('CG_RUNTIME_RESULT_MISMATCH', { nextAction: 'fix_input' });
    const project = decodeNative(await this.client.request('tools/call', { name: 'vext_project_inspect', arguments: { section: 'identity' } }));
    if (project.identity.rootDir !== this.projectRoot) throw new Error('Native project ownership mismatch');
    const raw = decodeNative(await this.client.request('tools/call', { name: 'vext_runtime_inspect', arguments: { section: 'summary', limit: 100 } }));
    const data = raw.data;
    if (data.projectIdentity?.rootDir !== this.projectRoot || data.page?.nextCursor || data.nextCursor) throw new Error('Native runtime incomplete or ownership mismatch');
    const rows = data.instances ?? [];
    if (data.page?.total > rows.length) throw new Error('Native runtime enumeration exceeds this adapter window');
    const runtimeRevision = `vext:${digest({ projectIdentity: data.projectIdentity, inspectedIdentity: project.identity, rows })}`;
    let offset = 0;
    if (input.cursor) {
      let cursor;
      try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()); } catch { throw new Error('Invalid adapter cursor'); }
      if (cursor.revision !== runtimeRevision || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new CapabilityGraphError('CG_REVISION_MISMATCH', { nextAction: 'refresh' });
      offset = cursor.offset;
    }
    const instanceOf = { providerId: this.providerId, capabilityId: capabilityIdFor('C18') };
    const filtered = rows.filter((row) => (!input.instanceId || row.instanceId === input.instanceId) && (!input.instanceOf || input.instanceOf.capabilityId === instanceOf.capabilityId));
    const page = filtered.slice(offset, offset + input.limit);
    const sources = new Set(rows.map((row) => this.deploymentRevisionBySource[row.runtimeIdentity?.sourceRevision]).filter(Boolean));
    const completeSource = rows.length > 0 && rows.every((row) => this.deploymentRevisionBySource[row.runtimeIdentity?.sourceRevision]);
    const observedAgainstStaticRevision = completeSource && sources.size === 1 ? [...sources][0] : 'unverified';
    return { instances: page.map((row) => ({ instanceId: row.instanceId, providerId: this.providerId, project: this.project, environment: this.environment, instanceOf,
      facts: { layer: 'native-startup-snapshot', state: row.summary.state, mode: row.runtimeIdentity.mode, counts: row.counts,
        liveness: row.evidence.liveness, ownership: row.evidence.ownership, sourceFreshness: row.evidence.sourceFreshness,
        sourceRevision: row.runtimeIdentity.sourceRevision, currentProjectSourceRevision: data.projectIdentity.sourceRevision,
        projectImplementationState: project.implementation?.state ?? 'unverified' } })),
      observation: { source: 'vext_runtime_inspect + vext_project_inspect', observedAt: new Date().toISOString(), sourceIdentity: digest({ project: this.project, environment: this.environment, root: this.projectRoot }),
        runtimeRevision, observedAgainstStaticRevision, compatibility: observedAgainstStaticRevision === 'unverified' ? 'unknown' : observedAgainstStaticRevision === input.currentStaticRevision ? 'compatible' : 'refresh_required',
        availability: 'partial', freshness: 'current', coverage: 'Native startup snapshots only; HTTP contract, worker behavior and liveness require separate observations.', freshnessLimit: 'Fresh snapshot read does not establish live process or deployment compatibility.' },
      ...(offset + page.length < filtered.length ? { nextCursor: Buffer.from(JSON.stringify({ offset: offset + page.length, revision: runtimeRevision })).toString('base64url') } : {}) };
  }
}
