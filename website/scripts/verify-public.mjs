import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

const expectedOrigin = 'https://devcodex-labs.github.io';
const expectedBase = `${expectedOrigin}/capability-graph/`;
const packageName = '@devcodex/capability-graph';
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const packageVersion = process.env.PACKAGE_VERSION ?? manifest.version;
const releaseTag = process.env.RELEASE_TAG ?? `v${packageVersion}`;
const releaseId = process.env.RELEASE_ID ?? `capability-graph-${packageVersion}`;
const releaseCommit = process.env.RELEASE_COMMIT;
const verificationAttempts = Number.parseInt(process.env.VERIFY_ATTEMPTS ?? '12', 10);
const retryDelayMs = Number.parseInt(process.env.VERIFY_RETRY_DELAY_MS ?? '10000', 10);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
assert(Number.isInteger(verificationAttempts) && verificationAttempts > 0, 'VERIFY_ATTEMPTS must be a positive integer');
assert(Number.isInteger(retryDelayMs) && retryDelayMs >= 0, 'VERIFY_RETRY_DELAY_MS must be a non-negative integer');

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function documentationUrls(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const routes = await Promise.all(entries.map((entry) => {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) return documentationUrls(root, file);
    if (!/\.mdx?$/.test(entry.name)) return [];
    const normalized = file.replaceAll('\\', '/').replace(/\.mdx?$/, '');
    const isIndexRoute = normalized === 'index' || normalized.endsWith('/index');
    const route = normalized.replace(/(^|\/)index$/, '$1').replace(/^\/+|\/+$/g, '');
    return [`${expectedBase}${route}${isIndexRoute && route ? '/' : ''}`];
  }));
  return routes.flat();
}

function cleanRedirectTarget(target) {
  return target.replace(/\/(?=#|$)/, '');
}

async function eventually(operation, attempts = verificationAttempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw lastError;
}

async function fetchOnce(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'capability-graph-release-probe' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response;
}

async function fetchWithRetry(url) {
  return eventually(() => fetchOnce(url));
}

async function forEachConcurrent(values, limit, visitor) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      await visitor(values[index]);
    }
  }));
}

assert(releaseCommit && /^[0-9a-f]{40}$/i.test(releaseCommit), 'RELEASE_COMMIT must contain the tag commit');
const publicRelease = await eventually(async () => {
  const candidate = await (await fetchOnce(`${expectedBase}release.json`)).json();
  assert(candidate.schemaVersion === 'CapabilityGraphPublicReleaseV1', 'public release schema mismatch');
  assert(candidate.releaseId === releaseId, 'public release id mismatch');
  assert(candidate.releaseTag === releaseTag, 'public release tag mismatch');
  assert(candidate.releaseCommit === releaseCommit, 'public release commit mismatch');
  assert(candidate.packageName === packageName && candidate.packageVersion === packageVersion, 'public package identity mismatch');
  return candidate;
});

const expectedUrls = (await documentationUrls(path.join(websiteRoot, 'docs'))).sort();
const publishedUrls = Object.keys(publicRelease.pages).sort();
assert(JSON.stringify(publishedUrls) === JSON.stringify(expectedUrls), 'public release routes differ from the source documentation routes');
await forEachConcurrent(publishedUrls, 8, async (url) => {
  await eventually(async () => {
    const html = await (await fetchOnce(url)).text();
    assert(hash(html) === publicRelease.pages[url], `${url} content hash mismatch`);
    const canonical = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((match) => match[1]);
    const openGraph = [...html.matchAll(/<meta\s+property="og:url"\s+content="([^"]+)"/g)].map((match) => match[1]);
    assert(canonical.length === 1 && canonical[0] === url, `${url} canonical mismatch`);
    assert(openGraph.length === 1 && openGraph[0] === url, `${url} og:url mismatch`);
  });
});
const home = await (await fetchWithRetry(expectedBase)).text();
const asset = home.match(/(?:src|href)="(\/capability-graph\/static\/[^"]+)"/)?.[1];
assert(asset, 'public home has no deploy-base static asset');
await fetchWithRetry(`${expectedOrigin}${asset}`);

const locations = await eventually(async () => {
  const sitemap = await (await fetchOnce(`${expectedBase}sitemap.xml`)).text();
  const candidate = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).sort();
  assert(JSON.stringify(candidate) === JSON.stringify(expectedUrls), 'public sitemap does not exactly match the released documentation routes');
  return candidate;
});
const redirects = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'route-redirects.json'), 'utf8'));
assert(Object.keys(publicRelease.redirects).length === Object.keys(redirects).length, 'public release redirect count mismatch');
await forEachConcurrent(Object.entries(redirects), 8, async ([source, target]) => {
  const sourceUrl = `${expectedBase}${source}/`;
  const targetUrl = new URL(`${expectedBase}${cleanRedirectTarget(target)}`).href;
  const identity = publicRelease.redirects[sourceUrl];
  await eventually(async () => {
    const html = await (await fetchOnce(sourceUrl)).text();
    assert(identity?.target === targetUrl, `${source} release redirect target mismatch`);
    assert(hash(html) === identity.sha256, `${source} redirect content hash mismatch`);
    assert(html.includes('name="capability-graph-redirect"'), `${source} is not a compatibility redirect`);
    assert(html.includes(`<link rel="canonical" href="${targetUrl}">`), `${source} redirect target mismatch`);
  });
});
await eventually(async () => {
  const robots = await (await fetchOnce(`${expectedBase}robots.txt`)).text();
  assert(robots.includes('Allow: /') && robots.includes(`${expectedBase}sitemap.xml`), 'public robots.txt mismatch');
});

const encodedPackage = encodeURIComponent(packageName);
await eventually(async () => {
  const registry = await (await fetchOnce(`https://registry.npmjs.org/${encodedPackage}/latest`)).json();
  assert(registry.name === packageName && registry.version === packageVersion, 'registry version mismatch');
});
console.log(`public release check passed: ${locations.length} pages and ${packageName}@${packageVersion}`);
