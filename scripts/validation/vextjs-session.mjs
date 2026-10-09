import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTemporaryDirectory } from '../lib/website-paths.mjs';

/** Actual TCP requests, public testing factory and owned Store lifecycle. No request mocks. */
export async function validateVextSession(frameworkRoot) {
  frameworkRoot = await realpath(frameworkRoot);
  const { createTestApp } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/testing/index.js')).href);
  const { createMemorySessionStore } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/index.js')).href);
  const root = await createTemporaryDirectory('capability-graph-vext-session-');
  let app; let server; const events = []; const checks = [];
  try {
    await mkdir(path.join(root, 'node_modules')); await symlink(frameworkRoot, path.join(root, 'node_modules/vextjs'), process.platform === 'win32' ? 'junction' : 'dir');
    await mkdir(path.join(root, 'src/routes'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"name":"real-session-consumer","type":"module","private":true}');
    await writeFile(path.join(root, 'src/routes/session.mjs'), `import {defineRoutes} from 'vextjs';
export default defineRoutes(app => {
 app.get('/', {}, (req,res) => res.json({visits:req.session?.visits ?? 0}));
 app.get('/token', {}, (req,res) => res.json({token:req.csrfToken()}));
 app.post('/visit', {}, (req,res) => {req.session.visits=(req.session.visits ?? 0)+1; res.cookie('theme','dark',{httpOnly:true,sameSite:'lax',path:'/'}); res.json({visits:req.session.visits});});
 app.post('/logout', {}, async (req,res) => {await req.session.destroy(); res.clearCookie('theme',{path:'/'}); res.json({ok:true});});
 app.get('/public', {session:false}, (req,res) => res.json({hasSession:req.session !== undefined}));
 app.post('/signed', {}, (req,res) => res.json({ok:true}));
});`);
    const memory = createMemorySessionStore();
    const store = { get: async (id) => { events.push('get'); return memory.get(id); },
      set: async (...args) => { await delay(5); events.push('set'); return memory.set(...args); }, delete: (id) => { events.push('delete'); return memory.delete(id); }, close: () => events.push('close') };
    app = await createTestApp({ rootDir: root, config: { adapter: 'native', frontend: { enabled: false }, session: { enabled: true, ttl: 1, store }, csrf: { enabled: true, mode: 'session' } } });
    server = await app.app.adapter.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${server.port}`;
    const request = (route, options = {}) => fetch(origin + '/session' + route, { signal: AbortSignal.timeout(3000), ...options });
    const absent = await request('/visit', { method: 'POST' }); assert.equal(absent.status, 403); checks.push('missing CSRF rejected');
    const tokenResponse = await request('/token'); assert.equal(tokenResponse.status, 200);
    const token = (await tokenResponse.json()).data.token; const cookie = tokenResponse.headers.getSetCookie().find((value) => value.startsWith('vext.sid=')).split(';')[0];
    assert.match(tokenResponse.headers.get('set-cookie'), /HttpOnly/i); assert.equal(tokenResponse.headers.get('cache-control'), 'no-store');
    const visited = await request('/visit', { method: 'POST', headers: { cookie, 'x-csrf-token': token } }); assert.equal(visited.status, 200); assert.equal((await visited.json()).data.visits, 1);
    assert.equal(memory.size(), 1); assert(events.includes('set')); checks.push('session persisted before actual HTTP success; Cookie attributes');
    const invalid = await request('/visit', { method: 'POST', headers: { cookie, 'x-csrf-token': 'invalid' } }); assert.equal(invalid.status, 403); checks.push('invalid CSRF rejected');
    const read = await request('', { headers: { cookie } }); assert.equal((await read.json()).data.visits, 1);
    const logout = await request('/logout', { method: 'POST', headers: { cookie, 'x-csrf-token': token } }); assert.equal(logout.status, 200); assert.equal(memory.size(), 0); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i); checks.push('logout removes Store state and expires Cookie');
    const publicResponse = await request('/public'); assert.equal((await publicResponse.json()).data.hasSession, false); checks.push('route disables Session');
    const renewed = await request('/token'); const renewedCookie = renewed.headers.getSetCookie().find((value) => value.startsWith('vext.sid=')).split(';')[0]; await renewed.json();
    await delay(1050);
    const expired = await request('', { headers: { cookie: renewedCookie } }); assert.equal((await expired.json()).data.visits, 0); assert.equal(memory.size(), 0); checks.push('actual Store TTL expiration');
    await server.close(); server = undefined; await app.close(); app = undefined; assert.equal(events.filter((event) => event === 'close').length, 1); checks.push('owned Store closed exactly once');
    app = await createTestApp({ rootDir: root, config: { adapter: 'native', frontend: { enabled: false }, session: { enabled: false },
      csrf: { enabled: true, mode: 'signed-cookie', secret: 'local-verification-csrf-signing-secret' } } });
    server = await app.app.adapter.listen(0, '127.0.0.1');
    const signedOrigin = `http://127.0.0.1:${server.port}/session`;
    const signedTokenResponse = await fetch(signedOrigin + '/token'); const signedToken = (await signedTokenResponse.json()).data.token;
    const signedCookie = signedTokenResponse.headers.getSetCookie()[0].split(';')[0];
    const signedOk = await fetch(signedOrigin + '/signed', { method: 'POST', headers: { cookie: signedCookie, 'x-csrf-token': signedToken } }); assert.equal(signedOk.status, 200); await signedOk.json();
    const tampered = await fetch(signedOrigin + '/signed', { method: 'POST', headers: { cookie: signedCookie.slice(0, -1) + 'x', 'x-csrf-token': signedToken } }); assert.equal(tampered.status, 403); await tampered.json();
    checks.push('actual signed CSRF Cookie accepted; tampered signature rejected');
    await server.close(); server = undefined; await app.close(); app = undefined;
    app = await createTestApp({ rootDir: root, config: { adapter: 'native', frontend: { enabled: false }, session: { enabled: true,
      store: { get: () => null, set: () => { throw new Error('Owned Store failed'); }, delete: () => {} } }, csrf: { enabled: false } } });
    server = await app.app.adapter.listen(0, '127.0.0.1');
    const failure = await fetch(`http://127.0.0.1:${server.port}/session/visit`, { method: 'POST' }); assert.equal(failure.status, 500);
    assert(!failure.headers.getSetCookie().some((value) => value.startsWith('vext.sid='))); await failure.json(); checks.push('Store commit failure prevents successful response and new Session Cookie');
    return { node: process.version, transport: 'actual loopback TCP HTTP', checks, note: 'Session IDs are opaque random IDs; signing belongs to CSRF signed-cookie mode. No JWT/OAuth claim.' };
  } finally { await server?.close(); await app?.close(); await rm(root, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(await validateVextSession(process.argv[2]), null, 2));
