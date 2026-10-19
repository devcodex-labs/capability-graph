import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTestApp } from 'vextjs/testing';

const base = process.env.CG_ARTIFACTS_DIR ?? tmpdir(); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'vextjs-greeting-'));
await mkdir(path.join(root, 'src/routes'), { recursive: true });
await mkdir(path.join(root, 'node_modules'));
const installedVext = path.resolve(path.dirname(createRequire(import.meta.url).resolve('vextjs')), '..');
await symlink(installedVext, path.join(root, 'node_modules/vextjs'), process.platform === 'win32' ? 'junction' : 'dir');
await copyFile(fileURLToPath(new URL('./routes/hello.ts', import.meta.url)), path.join(root, 'src/routes/index.ts'));
let instance;
try {
  instance = await createTestApp({ rootDir: root, services: false, middlewares: false, routes: true });
  const valid = await instance.request.post('/hello').send({ name: 'Ada' });
  assert.equal(valid.status, 200); assert.deepEqual(valid.body.data, { greeting: 'Hello, Ada' });
  // VextJS 2.0.0 ValidationError uses 422 for body validation (path parameters use 400).
  const invalid = await instance.request.post('/hello').send({ name: '' }); assert.equal(invalid.status, 422);
  console.log('PASS genuine VextJS 2.0.0 route registration, request and body validation');
} finally { await instance?.close(); await rm(root, { recursive: true, force: true }); }
