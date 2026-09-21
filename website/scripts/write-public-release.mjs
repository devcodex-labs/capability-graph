import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

const outputRoot = path.join(websiteRoot, 'doc_build');
const publicBase = 'https://devcodex-labs.github.io/capability-graph/';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function filesUnder(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = path.join(relative, entry.name);
    return entry.isDirectory() ? filesUnder(root, file) : [file];
  }))).flat();
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const releaseTag = process.env.RELEASE_TAG ?? `v${manifest.version}`;
const releaseCommit = process.env.RELEASE_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8'
}).trim();
const releaseId = `capability-graph-${manifest.version}`;
assert(releaseTag === `v${manifest.version}`, `release tag ${releaseTag} does not match package ${manifest.version}`);
assert(/^[0-9a-f]{40}$/i.test(releaseCommit), `invalid release commit: ${releaseCommit}`);

const pages = {};
const htmlFiles = (await filesUnder(outputRoot)).filter((file) => file.endsWith('.html') && file !== '404.html');
for (const file of htmlFiles) {
  const html = await readFile(path.join(outputRoot, file), 'utf8');
  if (html.includes('name="capability-graph-redirect"')) continue;
  const canonical = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((match) => match[1]);
  assert(canonical.length === 1, `${file} must expose one canonical URL before release identity generation`);
  assert(canonical[0].startsWith(publicBase), `${file} canonical is outside the public base`);
  assert(!pages[canonical[0]], `duplicate public route: ${canonical[0]}`);
  pages[canonical[0]] = hash(html);
}

const redirects = {};
const redirectConfig = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'route-redirects.json'), 'utf8'));
for (const [source, target] of Object.entries(redirectConfig)) {
  const url = `${publicBase}${source}/`;
  const targetUrl = new URL(target, publicBase).href;
  const html = await readFile(path.join(outputRoot, source, 'index.html'), 'utf8');
  redirects[url] = { target: targetUrl, sha256: hash(html) };
}

const sortObject = (value) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
const release = {
  schemaVersion: 'CapabilityGraphPublicReleaseV1',
  releaseId,
  releaseTag,
  releaseCommit,
  packageName: manifest.name,
  packageVersion: manifest.version,
  pages: sortObject(pages),
  redirects: sortObject(redirects)
};
await writeFile(path.join(outputRoot, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, 'utf8');
console.log(`generated public release identity: ${releaseId}, ${Object.keys(pages).length} pages, ${Object.keys(redirects).length} redirects`);
