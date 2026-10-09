import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTemporaryDirectory } from '../lib/website-paths.mjs';

// Opt-in fixed-source plugin/Store lifecycle proof; real business paths are separately tested upstream.
const [frameworkArg, redisUrl, mongoUrl] = process.argv.slice(2);
if (!frameworkArg || !redisUrl || !mongoUrl) throw new Error('Usage: node scripts/validation/vextjs-service-lifecycle.mjs <fixed-framework-root> <owned-loopback-redis-url> <owned-loopback-mongo-url>');
for (const value of [redisUrl, mongoUrl]) {
  const url = new URL(value);
  if (url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Expected owned loopback services without credentials');
}
const frameworkRoot = await realpath(frameworkArg);
const requireFromFramework = createRequire(path.join(frameworkRoot, 'package.json'));
const Redis = requireFromFramework('ioredis');
const { createRedisJobStore } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/lib/jobs/stores/redis-store.js')).href);
const { setupMonSQLize } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/lib/plugins/monsqlize/plugin.js')).href);
const root = await createTemporaryDirectory('capability-graph-vext-services-');
const ownedId = randomUUID().replaceAll('-', ''); const prefix = `cg-lifecycle-${ownedId}:`;
const connections = []; const hooks = []; const checks = []; let ownedStore;
const rejectingServer = createServer((socket) => socket.destroy()); let rejectingListening = false;
const databaseName = `cg_lifecycle_${ownedId}`;
const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((name) => [name, () => {}]));
const context = (uri) => {
  const appHooks = []; const app = { config: { database: { config: { uri }, cache: { memory: { enabled: false } } } }, logger,
    onClose: (hook) => { appHooks.push(hook); hooks.push(hook); }, extend: (name, value) => { app[name] = value; } };
  return { app, close: async () => { for (const hook of appHooks.splice(0)) { hooks.splice(hooks.indexOf(hook), 1); await hook(); } } };
};
try {
  await mkdir(path.join(root, 'src/models'), { recursive: true });
  const client = new Redis(redisUrl, { maxRetriesPerRequest: 0, retryStrategy: () => null }); connections.push(client); client.on('error', () => {});
  const injected = createRedisJobStore({ client, keyPrefix: prefix }); await injected.init();
  const run = await injected.enqueueRun({ jobName: 'lifecycle', trigger: 'manual', payload: { ownedId } });
  await injected.close(); assert.equal(await client.ping(), 'PONG'); checks.push('injected Redis connection remains host-owned after Store close');
  client.disconnect(); await assert.rejects(injected.getRun(run.id)); checks.push('actual Redis connection failure is reported instead of a fabricated run');
  ownedStore = createRedisJobStore({ url: redisUrl, keyPrefix: prefix }); await ownedStore.init();
  assert.equal((await ownedStore.getRun(run.id)).payload.ownedId, ownedId); checks.push('fresh Store reconnects to real persisted run after failed connection');
  const cleanup = new Redis(redisUrl, { maxRetriesPerRequest: 0, retryStrategy: () => null }); connections.push(cleanup); cleanup.on('error', () => {});
  const keys = await cleanup.keys(prefix + '*'); assert(keys.every((key) => key.startsWith(prefix))); if (keys.length) await cleanup.del(...keys);
  await ownedStore.close(); await assert.rejects(ownedStore.getRun(run.id)); ownedStore = undefined; checks.push('owned Redis client closes and rejects further I/O; unique namespace removed');

  await new Promise((resolve, reject) => { rejectingServer.once('error', reject); rejectingServer.listen(0, '127.0.0.1', resolve); }); rejectingListening = true;
  const failed = context(`mongodb://127.0.0.1:${rejectingServer.address().port}/${databaseName}?serverSelectionTimeoutMS=300&connectTimeoutMS=300`);
  await assert.rejects(setupMonSQLize(failed.app, path.join(root, 'src'), { rootDir: root }));
  assert.equal(failed.app.db, undefined); await failed.close(); checks.push('real MongoDB connection failure leaves app.db absent and registered cleanup completes');
  const uri = new URL(mongoUrl); uri.pathname = '/' + databaseName;
  const first = context(uri.toString()); await setupMonSQLize(first.app, path.join(root, 'src'), { rootDir: root });
  assert.equal((await first.app.db.client.db().command({ ping: 1 })).ok, 1);
  await first.app.db.client.db().collection('probe').insertOne({ ownedId });
  const oldClient = first.app.db.client; await first.close(); await assert.rejects(oldClient.db().command({ ping: 1 })); checks.push('MonSQLize plugin registers and closes its actual MongoDB client');
  const second = context(uri.toString()); await setupMonSQLize(second.app, path.join(root, 'src'), { rootDir: root });
  assert.equal((await second.app.db.client.db().collection('probe').findOne({ ownedId })).ownedId, ownedId);
  await second.app.db.client.db().dropDatabase(); await second.close(); checks.push('new plugin instance reconnects, reads persisted data and removes its owned database');
  console.log(JSON.stringify({ node: process.version, platform: process.platform, transport: 'real loopback Redis and MongoDB', checks,
    limitation: 'Store/plugin lifecycle checks supplement the upstream business suites. Reconnect means a new owned instance, not a promise of transparent recovery for every in-flight operation.' }, null, 2));
} finally {
  try {
    const closed = await Promise.allSettled(hooks.splice(0).map((hook) => hook()));
    const failures = closed.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Owned database cleanup failed');
  } finally {
    try { await ownedStore?.close(); } finally {
      for (const client of connections) client.disconnect();
      if (rejectingListening) await new Promise((resolve) => rejectingServer.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  }
}
