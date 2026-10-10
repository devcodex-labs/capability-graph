import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ProxyAgent } from 'proxy-agent';
import { sha256 } from '../../../examples/vextjs/source-provenance.mjs';

/** Lockfile integrity plus independently downloaded tarball bytes and original installed document equality. */
export async function verifyInstalledDocuments({ packageRoot, lockRoot, outputDirectory, documents }) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(lockRoot, 'package-lock.json'), 'utf8'));
  const expected = lock.packages[`node_modules/${manifest.name}`];
  assert.equal(expected.version, manifest.version); assert.match(expected.integrity, /^sha512-/);
  const url = new URL(expected.resolved);
  assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'registry.npmjs.org'); assert(!url.username && !url.password);
  const agent = new ProxyAgent(); let req; let timer;
  try {
    const bytes = await new Promise((resolve, reject) => {
      req = request(url, { agent, headers: { 'accept-encoding': 'identity' } }, async (response) => {
        try {
          assert.equal(response.statusCode, 200); assert(!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity');
          const chunks = []; let length = 0;
          for await (const chunk of response) { length += chunk.length; assert(length <= 16_777_216, 'Registry archive response budget exceeded'); chunks.push(Buffer.from(chunk)); }
          assert(response.complete); resolve(Buffer.concat(chunks, length));
        } catch (error) { req.destroy(); reject(error); }
      });
      req.on('error', reject); timer = setTimeout(() => req.destroy(new Error('Registry verification deadline exceeded')), 30000); req.end();
    });
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, expected.integrity);
    const archive = path.join(outputDirectory, 'registry-package.tgz'); await writeFile(archive, bytes, { flag: 'wx' });
    const compared = [];
    for (const file of documents) {
      assert.match(file, /^[A-Za-z0-9._/-]+$/); assert(!file.split('/').includes('..'));
      const original = execFileSync('tar', ['-xOf', archive, `package/${file}`], { maxBuffer: 4_194_304, stdio: ['ignore', 'pipe', 'pipe'] });
      const installed = await readFile(path.join(packageRoot, file)); assert.deepEqual(installed, original, `Installed ${file} differs from the integrity-verified archive`);
      compared.push({ path: file, originalSha256: sha256(original), installedSha256: sha256(installed), bytes: installed.length });
    }
    return { packageName: manifest.name, version: manifest.version, integrity: expected.integrity, registryUrl: url.href,
      archiveSha256: sha256(bytes), documents: compared, verified: true };
  } finally { clearTimeout(timer); req?.destroy(); agent.destroy(); }
}
