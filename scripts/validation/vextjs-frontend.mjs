import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, realpath, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createTemporaryDirectory } from '../lib/website-paths.mjs';

const framework = await realpath(process.argv[2]); const root = await createTemporaryDirectory('capability-graph-vext-seo-');
const cli = path.join(framework, 'dist/cli/index.js'); let child; let output = '';
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function write(file, text) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); }
try {
  const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  await write('package.json', '{"name":"actual-frontend-seo","type":"module","private":true}'); await mkdir(path.join(root, 'node_modules'));
  for (const name of ['vextjs', 'react', 'react-dom']) await symlink(name === 'vextjs' ? framework : path.join(framework, 'node_modules', name), path.join(root, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir');
  await write('src/config/default.mjs', `export default {host:'127.0.0.1',port:${port},adapter:'native',logger:{level:'silent'},openapi:{enabled:false}, frontend:{enabled:true,apiClient:false,seo:{publicOrigin:'https://example.test',titleTemplate:'%s | Example',defaults:{description:'Example 全栈应用'},sitemap:{entries:()=>[{pathname:'/about'}]},robots:{}}}};`);
  await write('src/routes/about.mjs', `import {defineRoutes} from 'vextjs'; export default defineRoutes(app => {app.get('/', {frontend:{page:'about',hydration:'none',seo:{title:'关于我们',canonical:'/about',openGraph:{type:'profile'}}}}, (req,res)=>res.render('about'));});`);
  await write('src/frontend/pages/about.tsx', `import React from 'react'; export default function About(){return <main><h1>关于我们</h1><p>Live SEO SSR</p></main>;}`);
  const build = spawn(process.execPath, [cli, 'build'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } });
  let buildOutput = ''; build.stdout.on('data', (bytes) => buildOutput += bytes); build.stderr.on('data', (bytes) => buildOutput += bytes);
  const code = await new Promise((resolve, reject) => { build.once('exit', resolve); build.once('error', reject); }); assert.equal(code, 0, buildOutput);
  child = spawn(process.execPath, [cli, 'start'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } });
  child.stdout.on('data', (bytes) => output += bytes); child.stderr.on('data', (bytes) => output += bytes); child.on('error', () => {});
  const origin = `http://127.0.0.1:${port}`; let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Built application exited: ' + output);
    try { const response = await fetch(origin + '/about', { signal: AbortSignal.timeout(500) }); if (response.status === 200) { await response.text(); ready = true; break; } } catch {}
    await delay(50);
  }
  assert(ready, output);
  const response = await fetch(origin + '/about'); assert.equal(response.status, 200); const html = await response.text();
  assert.match(html, /<title>关于我们 \| Example<\/title>/); assert.match(html, /https:\/\/example\.test\/about/); assert.match(html, /Example 全栈应用/); assert.match(html, /og:type[^>]+profile/); assert.match(html, /Live SEO SSR/);
  assert(!/<script[^>]+(?:entry|hydrate)/.test(html), 'No hydration runtime for hydration:none');
  const sitemap = await fetch(origin + '/sitemap.xml'); assert.equal(sitemap.status, 200); assert.match(sitemap.headers.get('content-type'), /application\/xml/); assert.match(await sitemap.text(), /https:\/\/example\.test\/about/);
  const robots = await fetch(origin + '/robots.txt'); assert.equal(robots.status, 200); assert.match(await robots.text(), /sitemap\.xml/);
  await stop(); await assert.rejects(fetch(origin + '/about', { signal: AbortSignal.timeout(500) }));
  console.log(JSON.stringify({ node: process.version, build: 'actual vext build + vext start', checks: ['live SSR title/canonical/description/OpenGraph', 'hydration:none', 'actual HTTP sitemap and robots MIME/content', 'owned process stopped and listener released'] }, null, 2));
} finally { await stop(); await rm(root, { recursive: true, force: true }); }
