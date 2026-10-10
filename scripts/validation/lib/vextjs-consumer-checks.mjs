import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { bootstrap } from 'vextjs';
import { TextCapabilityRetriever, TextKnowledgeRetriever } from './adapters/text-retrieval.js';
import { HttpKnowledgeReader } from './adapters/knowledge-reader.js';

// The runner copies this maintained verifier into the external consumer before execution.
// Bare imports above MUST resolve to that consumer's installed tarballs, never the checkout.
const execute = promisify(execFile);
const context = JSON.parse(await readFile(process.argv[2], 'utf8'));
process.env.VEXT_CONSUMER_TEST_MODE = '1';
process.env.VEXT_CONSUMER_MONGO_URI = context.mongoUri;
delete process.env.VEXT_CONSUMER_PORT;
const { repositoryRoot, sourceRoot, sourceIdentity, appRoot, runRoot } = context;
assert.equal(await realpath(process.cwd()), await realpath(appRoot));
const repoImport = (relative) => import(pathToFileURL(path.join(repositoryRoot, relative)).href);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const frameworkRoot = path.join(appRoot, 'node_modules/vextjs');
const coreRoot = path.join(appRoot, 'node_modules/@devcodex/capability-graph');
const installedEntry = await realpath(new URL(import.meta.resolve('@devcodex/capability-graph')));
assert.equal(installedEntry, await realpath(path.join(coreRoot, 'dist/index.js')));
assert.notEqual(installedEntry, path.join(repositoryRoot, 'dist/index.js'));
const monsqlizeRequire = createRequire(path.join(appRoot, 'node_modules/monsqlize/package.json'));
const { MongoClient } = monsqlizeRequire('mongodb');
const report = { status: 'running', node: process.version, platform: process.platform, installedEntry,
  coreVersion: JSON.parse(await readFile(path.join(coreRoot, 'package.json'), 'utf8')).version,
  modelCalls: 0, phases: {}, limitation: 'Deterministic integration-authored business application. No model/Agent success claim; Jobs, SSR, hot reload and production load remain outside this phase.' };
const reportFile = path.join(runRoot, 'reports/consumer.json');
let runtime; let graph; let client; let mongo; let recall;
const phase = async (name, action) => {
  console.log(`Phase: ${name}`);
  report.phases[name] = { status: 'running' };
  try { report.phases[name] = { status: 'passed', result: await action() }; }
  catch (error) { report.phases[name] = { status: 'failed', error: String(error) }; throw error; }
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
};
const connectMongo = async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const connection = new MongoClient(context.mongoUri);
    try { await connection.connect(); await connection.db().command({ ping: 1 }); return connection; }
    catch (error) { await connection.close(); if (attempt === 19) throw error; await delay(100); }
  }
};
const freePort = async () => {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
};
const assertPortReleased = async (port) => {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
};
async function closeRuntime() {
  if (!runtime) return;
  const owned = runtime; runtime = undefined;
  const closedClient = owned.app.db.client;
  try { await owned.serverHandle.close(); }
  finally { await owned.internals.shutdown(undefined, { skipExit: true }); }
  assert.deepEqual(owned.app.consumerAudit.events, ['store-setup', 'consumer-setup', 'ready', 'consumer-close', 'store-close']);
  await assert.rejects(closedClient.db().command({ ping: 1 }));
  return owned;
}
async function createBusinessApplication(port) {
  const files = {
    'start.mjs': "import {bootstrap} from 'vextjs'; await bootstrap(process.cwd());\n",
    'src/config/default.mjs': `const config = ${JSON.stringify({ port, host: '127.0.0.1', adapter: 'native',
      logger: { level: 'silent' }, accessLog: { enabled: false }, rateLimit: { enabled: false },
      shutdown: { timeout: 5 }, frontend: { enabled: false }, openapi: { enabled: false },
      session: { enabled: true }, csrf: { enabled: true, mode: 'session' },
      database: { config: { uri: context.mongoUri }, cache: { memory: { enabled: false } } } })};
config._testMode = process.env.VEXT_CONSUMER_TEST_MODE === '1';
config.database.config.uri = process.env.VEXT_CONSUMER_MONGO_URI || config.database.config.uri;
if (process.env.VEXT_CONSUMER_PORT) config.port = Number(process.env.VEXT_CONSUMER_PORT);
export default config;\n`,
    'src/plugins/store.mjs': `import {definePlugin} from 'vextjs';
export default definePlugin({name:'consumer-store', setup(app){
 app.extend('consumerAudit',{events:['store-setup'],requests:0,ready:false});
 app.onClose(()=>app.consumerAudit.events.push('store-close'));
}});\n`,
    'src/plugins/consumer.mjs': `import {definePlugin} from 'vextjs';
export default definePlugin({name:'consumer-audit',dependencies:['consumer-store'],setup(app){
 app.consumerAudit.events.push('consumer-setup');
 app.use(async(req,res,next)=>{app.consumerAudit.requests++;res.setHeader('x-consumer-plugin','active');await next();});
 app.onReady(()=>{app.consumerAudit.ready=true;app.consumerAudit.events.push('ready');});
 app.onClose(()=>app.consumerAudit.events.push('consumer-close'));
}});\n`,
    'src/services/notes.mjs': `export default class NotesService {
 constructor(app){this.app=app;}
 async create(input){const result=await this.app.db.collection('notes').insertOne(input);return {...input,id:String(result.insertedId)};}
 async get(slug){return this.app.db.collection('notes').findOne({slug});}
 async list(page,limit){return this.app.db.collection('notes').findAndCount({}, {sort:{slug:1},skip:(page-1)*limit,limit});}
}\n`,
    'src/routes/notes.mjs': `import {defineRoutes} from 'vextjs';
export default defineRoutes(app=>{
 app.get('/token',{},(req,res)=>res.json({token:req.csrfToken()}));
 app.post('/',{validate:{body:{slug:'string:1-40!',title:'string:1-100!',priority:'integer:1-5!'}}},async(req,res)=>{
  const note=await app.services.notes.create(req.valid('body'));req.session.writes=(req.session.writes??0)+1;res.json({...note,writes:req.session.writes},201);
 });
 app.get('/',{validate:{query:{page:'integer:1-!',limit:'integer:1-2!'}}},async(req,res)=>{
  const {page,limit}=req.valid('query');res.json(await app.services.notes.list(page,limit));
 });
 app.get('/session',{},(req,res)=>res.json({writes:req.session?.writes??0}));
 app.post('/logout',{},async(req,res)=>{await req.session.destroy();res.json({ok:true});});
 app.get('/:slug',{validate:{param:{slug:'string:1-40!'}}},async(req,res)=>{
  const note=await app.services.notes.get(req.valid('param').slug);if(!note) app.throw(404,'Note missing');res.json(note);
 });
});\n`,
  };
  const provenance = [];
  for (const [relative, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(appRoot, relative)), { recursive: true });
    await writeFile(path.join(appRoot, relative), body);
    provenance.push({ path: relative, sha256: hash(body), role: 'integration-authored real business application; not copied official documentation' });
  }
  return provenance;
}

async function verifyHttpFailures(original) {
  let mode = 'normal'; let body = original; let validator = '"original"'; let requested;
  const sockets = new Set(); const timers = new Set(); let downloads = 0; let revalidated = 0; let ranges = 0; let stalledClosed = 0;
  const server = createHttpServer((req, res) => {
    if (req.headers.range) ranges++;
    requested?.(); requested = undefined;
    if (mode === 'stall') {
      const timer = setTimeout(() => { timers.delete(timer); if (!res.destroyed) res.end(body); }, 2000);
      timers.add(timer); res.once('close', () => { clearTimeout(timer); timers.delete(timer); stalledClosed++; }); return;
    }
    if (req.headers['if-none-match'] === validator) { revalidated++; res.writeHead(304, { etag: validator }); res.end(); return; }
    downloads++; res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-length': body.length, etag: validator }); res.end(body);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; const origin = `http://127.0.0.1:${port}`;
  const providerRoot = path.join(appRoot, 'providers/http-verification');
  await mkdir(path.join(providerRoot, 'capabilities'), { recursive: true });
  await writeFile(path.join(providerRoot, 'provider.json'), JSON.stringify({ providerId: 'http-verification', name: 'Owned HTTP transport verification', version: '1.0.0' }));
  await writeFile(path.join(providerRoot, 'capabilities/config.json'), JSON.stringify({ capabilityId: 'config', name: 'Original Vext config', description: 'Controlled transport over exact original bytes', whenToUse: 'Verify HTTP transport',
    knowledge: [{ kind: 'document', knowledgeId: 'config', role: 'guide', locator: { type: 'http', url: `${origin}/config.md` } }] }));
  const checks = []; let httpGraph; let httpReader;
  const open = async (snapshot) => {
    await httpGraph?.close(); await httpReader?.close();
    httpReader = new HttpKnowledgeReader({ allowedOrigins: [origin], timeoutMs: 150,
      ...(snapshot ? { snapshot: { directory: path.join(runRoot, 'cache/http'), ...snapshot } } : {}) });
    httpGraph = await CapabilityGraph.open({ providers: [{ providerId: 'http-verification', authority: { kind: 'file', rootDir: providerRoot, definitionLayout: 'directory' } }],
      readers: [httpReader], hostAllowedProviders: ['http-verification'], integrationEnabledProviders: ['http-verification'] });
    return httpGraph.forProvider('http-verification');
  };
  try {
    for (const [name, tag, snapshot] of [['no-snapshot', '"original"', null], ['strong-etag', '"original"', {}], ['weak-etag', 'W/"original"', {}], ['cache-overflow', '"original"', { maxBytes: 64 }]]) {
      validator = tag; downloads = 0; revalidated = 0; const bound = await open(snapshot); let cursor; const chunks = []; let pages = 0;
      do { const page = await bound.readDocumentPage({ capabilityId: 'config', knowledgeId: 'config', ...(cursor ? { cursor } : {}) });
        chunks.push(Buffer.from(page.text)); cursor = page.nextCursor; pages++; } while (cursor);
      assert.deepEqual(Buffer.concat(chunks), original); assert.equal(pages, 5); assert.equal(ranges, 0);
      assert.equal(downloads, name === 'strong-etag' ? 1 : pages); assert.equal(revalidated, name === 'strong-etag' ? pages - 1 : 0);
      checks.push({ name, pages, downloads, revalidated, originalSha256: hash(original) });
    }
    validator = '"original"'; let bound = await open({});
    const first = await bound.readDocumentPage({ capabilityId: 'config', knowledgeId: 'config' });
    body = Buffer.concat([original, Buffer.from('\ncontrolled source drift\n')]); validator = '"changed"';
    await assert.rejects(bound.readDocumentPage({ capabilityId: 'config', knowledgeId: 'config', cursor: first.nextCursor }), { code: 'CG_REVISION_MISMATCH' });
    checks.push({ name: 'old-cursor-rejects-changed-body', code: 'CG_REVISION_MISMATCH' });
    body = original; validator = '"original"'; mode = 'stall'; bound = await open(null);
    let sawRequest = false; requested = () => { sawRequest = true; };
    const eventually = async (predicate) => { for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await delay(5); assert(predicate()); };
    const controller = new AbortController();
    const aborted = assert.rejects(bound.readDocumentPage({ capabilityId: 'config', knowledgeId: 'config', signal: controller.signal }), { code: 'CG_READER_UNAVAILABLE' });
    await eventually(() => sawRequest); controller.abort(); await aborted; assert.equal(httpReader.activeRequests, 0);
    await eventually(() => stalledClosed === 1);
    checks.push({ name: 'abort-closes-reader-request', code: 'CG_READER_UNAVAILABLE' });
    await assert.rejects(bound.readDocumentPage({ capabilityId: 'config', knowledgeId: 'config' }), { code: 'CG_READER_UNAVAILABLE' });
    assert.equal(httpReader.activeRequests, 0); await eventually(() => stalledClosed === 2);
    checks.push({ name: 'deadline-closes-reader-request', code: 'CG_READER_UNAVAILABLE' });
    mode = 'normal'; const recovered = await bound.readDocumentPage({ capabilityId: 'config', knowledgeId: 'config' });
    assert.deepEqual(Buffer.from(recovered.text), original.subarray(0, recovered.endOffset));
    checks.push({ name: 'reader-recovers-after-abort-and-deadline' });
    await httpGraph.close(); httpGraph = undefined; await httpReader.close(); httpReader = undefined;
    await assert.rejects(bound.readDocumentPage({ capabilityId: 'config', knowledgeId: 'config' }), { code: 'CG_NO_ACTIVE_VIEW' });
    checks.push({ name: 'closed-graph-rejects-further-reads', code: 'CG_NO_ACTIVE_VIEW' });
  } finally {
    try { await httpGraph?.close(); } finally { await httpReader?.close(); }
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await assertPortReleased(port);
  }
  return { checks, rangeRequests: ranges, transport: 'controlled loopback HTTP over exact fixed official document bytes; negative mutations are explicit' };
}

try {
  await phase('package-and-source-identity', async () => {
    const { verifyVextSource } = await repoImport('examples/vextjs/source-provenance.mjs');
    assert.notEqual(await realpath(frameworkRoot), await realpath(sourceRoot), 'VextJS must be installed independently of its checkout');
    const source = await verifyVextSource({ frameworkRoot, sourceRoot, sourceIdentity });
    const { CapabilityGraph: checkoutGraph } = await repoImport('dist/index.js');
    assert.notEqual(CapabilityGraph, checkoutGraph, 'Consumer must execute its own installed Core');
    // Compare every installed Core package file with the exact packed checkout output.
    const { stdout: pack } = await execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: repositoryRoot, timeout: 30000 });
    const files = JSON.parse(pack)[0].files;
    for (const { path: relative } of files) assert.deepEqual(await readFile(path.join(coreRoot, relative)), await readFile(path.join(repositoryRoot, relative)), `Installed Core differs: ${relative}`);
    return { source, installedCoreFiles: files.length, installedEntry, isolatedCoreClass: true };
  });
  await phase('official-source-matrix', async () => {
    const { validateProviderSources } = await repoImport('scripts/validation/provider-sources.mjs');
    return validateProviderSources({ sourceRoot, installedProject: appRoot, sourceIdentity, includeHttps: context.includeHttps,
      graphClass: CapabilityGraph, knowledgeClass: TextKnowledgeRetriever, readerClass: HttpKnowledgeReader });
  });
  await phase('native-mcp-retrieval', async () => {
    const { validateVextjs } = await repoImport('scripts/validation/vextjs.mjs');
    await mkdir(path.join(appRoot, 'src/config'), { recursive: true });
    await writeFile(path.join(appRoot, 'src/config/default.mjs'), 'export default {frontend:{enabled:false},logger:{level:"silent"}};\n');
    return validateVextjs({ frameworkRoot, projectRoot: appRoot, sourceRoot, sourceIdentity, graphClass: CapabilityGraph,
      capabilityClass: TextCapabilityRetriever, knowledgeClass: TextKnowledgeRetriever });
  });
  await phase('discover-select-read-business', async () => {
    const { VextMcpClient } = await repoImport('examples/vextjs/mcp-client.mjs');
    const { exportVextProvider, readNativeCatalog, capabilityIdFor } = await repoImport('examples/vextjs/native-provider.mjs');
    const { officialDocumentMappings } = await repoImport('examples/vextjs/official-documents.mjs');
    const source = report.phases['package-and-source-identity'].result.source;
    client = new VextMcpClient({ cli: path.join(frameworkRoot, 'dist/cli/index.js'), projectRoot: appRoot });
    await client.initialize();
    const { buildMcpCatalog } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/assistant/catalog.js')).href);
    const catalog = await readNativeCatalog(client, buildMcpCatalog());
    await mkdir(path.join(appRoot, 'providers'));
    const officialDocuments = await officialDocumentMappings(sourceRoot, catalog, source.commit);
    const exported = await exportVextProvider({ catalog, source, version: source.version, officialDocuments,
      outputDir: path.join(appRoot, 'providers/vextjs'), repositoryRoot });
    const requiredNative = ['C03', 'C04', 'C05', 'C07', 'C08', 'C21', 'K05', 'K06'];
    const requires = requiredNative.map(capabilityIdFor);
    await writeFile(path.join(exported.rootDir, 'capabilities/business.notes.json'), JSON.stringify({ capabilityId: 'business.notes', name: 'Validated persistent notes with Session and CSRF',
      description: 'Integration-authored workflow for this actual consumer application', whenToUse: 'create validated notes session csrf database plugin', requires,
      knowledge: [{ kind: 'document', knowledgeId: 'official-database', role: 'guide', locator: { type: 'relative-file', root: 'official', path: 'website/docs/zh/guide/database.md' } }] }, null, 2));
    const monRoot = path.join(appRoot, 'providers/monsqlize'); await mkdir(path.join(monRoot, 'capabilities'), { recursive: true });
    const installedMon = JSON.parse(await readFile(path.join(appRoot, 'node_modules/monsqlize/package.json'), 'utf8'));
    await writeFile(path.join(monRoot, 'provider.json'), JSON.stringify({ providerId: 'monsqlize', name: 'MonSQLize real installed package', version: installedMon.version }));
    await writeFile(path.join(monRoot, 'capabilities/documentation.json'), JSON.stringify({ capabilityId: 'documentation', name: 'MonSQLize README', description: 'Installed original README', whenToUse: 'MonSQLize database access',
      knowledge: [{ kind: 'document', knowledgeId: 'README', role: 'guide', locator: { type: 'relative-file', root: 'installed', path: 'README.md' } }] }));
    recall = new TextCapabilityRetriever(); const knowledge = new TextKnowledgeRetriever();
    graph = await CapabilityGraph.open({ hostAllowedProviders: ['vextjs', 'monsqlize'], integrationEnabledProviders: ['vextjs', 'monsqlize'], capabilityRetriever: recall, knowledgeRetriever: knowledge,
      providers: [{ providerId: 'vextjs', authority: { kind: 'file', rootDir: exported.rootDir, definitionLayout: 'directory' }, knowledgeRoots: { official: { kind: 'directory', rootDir: sourceRoot } } },
        { providerId: 'monsqlize', authority: { kind: 'file', rootDir: monRoot, definitionLayout: 'directory' }, knowledgeRoots: { installed: { kind: 'package', packageName: 'monsqlize', resolveFrom: appRoot } } }] });
    await recall.rebuild(graph);
    const candidates = await graph.retrieveCapabilities({ text: 'create validated notes session csrf database plugin', limit: 10 });
    assert(candidates.items.some((item) => item.id.capabilityId === 'business.notes'));
    const selection = await graph.resolveSelection({ selected: [{ providerId: 'vextjs', capabilityId: 'business.notes' }] });
    assert.deepEqual(selection.added.map((item) => item.capabilityId).sort(), requires.slice().sort());
    const documents = [];
    for (const nativeId of requiredNative) {
      const result = await graph.forProvider('vextjs').readDocumentPage({ capabilityId: capabilityIdFor(nativeId), knowledgeId: nativeId });
      const expected = await readFile(path.join(exported.rootDir, 'knowledge', `${nativeId}.json`));
      assert.deepEqual(Buffer.from(result.text), expected); documents.push({ nativeId, contentId: result.contentId, sha256: hash(expected) });
    }
    const hits = await graph.queryKnowledge({ selected: selection.resolved, knowledgeIds: ['K06'], text: 'cookie session csrf', limit: 3 });
    assert(hits.items.length > 0);
    for (const hit of hits.items) {
      const bytes = await readFile(path.join(exported.rootDir, hit.source));
      assert.equal(bytes.subarray(hit.startOffset, hit.endOffset).toString(), hit.snippet);
    }
    const port = await freePort(); const applicationFiles = await createBusinessApplication(port);
    mongo = await connectMongo();
    runtime = await bootstrap(appRoot);
    assert.equal(runtime.app.consumerAudit.ready, true);
    const origin = `http://127.0.0.1:${runtime.serverHandle.port}`;
    const request = async (relative, options = {}) => {
      const response = await fetch(origin + relative, { signal: AbortSignal.timeout(5000), ...options });
      return { response, json: await response.json() };
    };
    const token = await request('/notes/token'); assert.equal(token.response.status, 200);
    const csrf = token.json.data.token;
    const cookie = token.response.headers.getSetCookie().find((value) => value.startsWith('vext.sid=')).split(';')[0];
    assert.match(token.response.headers.get('set-cookie'), /HttpOnly/i); assert.equal(token.response.headers.get('cache-control'), 'no-store');
    const headers = { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const checks = [];
    const missing = await request('/notes/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'absent', title: 'Absent', priority: 1 }) });
    assert.equal(missing.response.status, 403); assert.equal(await mongo.db().collection('notes').countDocuments(), 0); checks.push('missing CSRF rejects before database write');
    const invalid = await request('/notes/', { method: 'POST', headers, body: JSON.stringify({ slug: 'invalid', title: '', priority: 9 }) });
    assert.equal(invalid.response.status, 422); assert.equal(await mongo.db().collection('notes').countDocuments(), 0); checks.push('invalid body rejects before database write');
    const malformed = await request('/notes/', { method: 'POST', headers, body: '{' }); assert.equal(malformed.response.status, 400); checks.push('malformed JSON rejected');
    for (let index = 1; index <= 3; index++) {
      const created = await request('/notes/', { method: 'POST', headers, body: JSON.stringify({ slug: `note-${index}`, title: `Note ${index}`, priority: String(index) }) });
      assert.equal(created.response.status, 201); assert.equal(created.json.data.priority, index); assert.equal(created.json.data.writes, index);
      assert.match(created.json.data.id, /^[a-f0-9]{24}$/); assert.equal(created.response.headers.get('x-consumer-plugin'), 'active');
      const persisted = await mongo.db().collection('notes').findOne({ slug: `note-${index}` }); assert.equal(persisted.title, `Note ${index}`); assert.equal(persisted.priority, index);
    }
    checks.push('actual 201 writes and schema conversion independently read back through MongoDB driver');
    const first = await request('/notes/?page=1&limit=2'); const second = await request('/notes/?page=2&limit=2');
    assert.equal(first.response.status, 200); assert.equal(second.response.status, 200);
    assert.deepEqual(first.json.data.data.map((note) => note.slug), ['note-1', 'note-2']);
    assert.deepEqual(second.json.data.data.map((note) => note.slug), ['note-3']); assert.equal(first.json.data.total, 3); assert.equal(second.json.data.total, 3);
    checks.push('database findAndCount pagination returns exact rows and total');
    const badPage = await request('/notes/?page=0&limit=3'); assert.equal(badPage.response.status, 422); checks.push('invalid pagination rejected');
    const read = await request('/notes/note-2'); assert.equal(read.json.data.title, 'Note 2');
    const session = await request('/notes/session', { headers: { cookie } }); assert.equal(session.json.data.writes, 3); checks.push('Session retained across TCP requests');
    const wrong = await request('/notes/', { method: 'POST', headers: { ...headers, 'x-csrf-token': 'invalid' }, body: JSON.stringify({ slug: 'tampered', title: 'No', priority: 1 }) });
    assert.equal(wrong.response.status, 403); assert.equal(await mongo.db().collection('notes').countDocuments(), 3); checks.push('invalid CSRF cannot change persistence');
    const logout = await request('/notes/logout', { method: 'POST', headers }); assert.equal(logout.response.status, 200); assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/i);
    const afterLogout = await request('/notes/session', { headers: { cookie } }); assert.equal(afterLogout.json.data.writes, 0); checks.push('logout destroys old Session');
    await closeRuntime(); await assertPortReleased(port); checks.push('plugin LIFO close, database client close and HTTP port release');
    return { candidates: candidates.items.map((item) => item.id), selection, documents, knowledgeHits: hits.items.length, applicationFiles, checks, port,
      dependencyProvenance: 'requires edges describe this integration-authored application, not native inferred framework dependencies' };
  });
  await phase('database-stop-and-restart', async () => {
    // Only the freshly allocated container may be controlled by this verifier.
    assert.match(context.mongoContainer, /^[a-f0-9]{64}$/);
    const inspected = JSON.parse((await execute('docker', ['inspect', context.mongoContainer])).stdout)[0];
    assert.equal(inspected.Config.Labels['capability-graph.verification'], 'vextjs-consumer');
    await mongo.close(); mongo = undefined;
    // Vext caches imported configuration modules; reuse the original project's declared port.
    const port = report.phases['discover-select-read-business'].result.port;
    runtime = await bootstrap(appRoot); assert.equal(runtime.serverHandle.port, port);
    await execute('docker', ['stop', '--time', '1', context.mongoContainer], { timeout: 30000 });
    const failed = await fetch(`http://127.0.0.1:${port}/notes/note-1`, { signal: AbortSignal.timeout(5000) });
    assert.equal(failed.status, 500); await failed.json();
    await closeRuntime(); await assertPortReleased(port);
    await assert.rejects(bootstrap(appRoot)); // Real failed startup must clean up rather than return a ready app.
    await assertPortReleased(port);
    await execute('docker', ['start', context.mongoContainer], { timeout: 30000 });
    mongo = await connectMongo();
    runtime = await bootstrap(appRoot);
    const recovered = await fetch(`http://127.0.0.1:${port}/notes/note-1`, { signal: AbortSignal.timeout(5000) });
    assert.equal(recovered.status, 200); assert.equal((await recovered.json()).data.title, 'Note 1');
    assert.equal(await mongo.db().collection('notes').countDocuments(), 3);
    await closeRuntime(); await assertPortReleased(port);
    await mongo.db().dropDatabase(); await mongo.close(); mongo = undefined;
    return { checks: ['stopped database yields HTTP 500', 'unavailable database rejects startup', 'failed startup releases port',
      'restarted owned MongoDB plus new app reads original persisted rows', 'owned database removed and clients closed'],
      recovery: 'new application instance; no transparent in-flight recovery claim', image: context.mongoImage };
  });
  await phase('document-failures-and-recovery', async () => {
    const original = await readFile(path.join(sourceRoot, 'website/docs/zh/api/config.md'));
    const localRoot = path.join(appRoot, 'providers/vextjs');
    const driftFile = path.join(localRoot, 'knowledge/local-drift.md'); await writeFile(driftFile, original);
    await writeFile(path.join(localRoot, 'capabilities/local-drift.json'), JSON.stringify({ capabilityId: 'local-drift', name: 'Copied official config drift check', description: 'Controlled copy; exact original source hash initially', whenToUse: 'Verify changed bytes and reload',
      knowledge: [{ kind: 'document', knowledgeId: 'config', role: 'guide', locator: { type: 'relative-file', path: 'knowledge/local-drift.md' } }] }));
    assert((await graph.reload({ providerId: 'vextjs' })).ok);
    await assert.rejects(graph.retrieveCapabilities({ text: 'create validated notes', limit: 10 }), { code: 'CG_INDEX_STALE' });
    await recall.rebuild(graph);
    assert((await graph.retrieveCapabilities({ text: 'create validated notes', limit: 10 })).items.some((item) => item.id.capabilityId === 'business.notes'));
    const bound = graph.forProvider('vextjs'); const query = { capabilityId: 'local-drift', knowledgeId: 'config' };
    const first = await bound.readDocumentPage(query);
    await writeFile(driftFile, Buffer.concat([original, Buffer.from('\ncontrolled drift\n')]));
    await assert.rejects(bound.readDocumentPage({ ...query, cursor: first.nextCursor }), { code: 'CG_REVISION_MISMATCH' });
    await writeFile(driftFile, original);
    const recovered = await bound.readDocumentPage(query); assert.equal(first.contentId, recovered.contentId);
    const http = await verifyHttpFailures(original);
    return { local: ['copied official bytes match original', 'reload rejects stale index', 'explicit index rebuild restores capability recall',
      'changed body rejects old cursor', 'restored source is readable'], originalSha256: hash(original),
      originalPath: 'website/docs/zh/api/config.md', controlledCopy: 'providers/vextjs/knowledge/local-drift.md',
      transformation: 'byte-exact copy; negative changes restored', http };
  });
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); throw error; }
finally {
  const cleaned = await Promise.allSettled([closeRuntime(), graph?.close(), client?.close(), mongo?.close()]);
  const failures = cleaned.filter((result) => result.status === 'rejected').map((result) => String(result.reason));
  if (failures.length) { report.status = 'failed'; report.cleanupErrors = failures; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
}
