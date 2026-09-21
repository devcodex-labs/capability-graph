import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { websiteRoot } from './lib/paths.mjs';

const expectedOrigin = 'https://devcodex-labs.github.io';
const expectedBase = `${expectedOrigin}/capability-graph/`;
const packageName = '@devcodex-labs/capability-graph';
const packageVersion = process.env.PACKAGE_VERSION ?? '0.1.0';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function documentationPageCount(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const counts = await Promise.all(entries.map((entry) => {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) return documentationPageCount(root, file);
    return /\.mdx?$/.test(entry.name) ? 1 : 0;
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function fetchWithRetry(url, attempts = 12) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'capability-graph-release-probe' } });
      if (response.ok) return response;
      last = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      last = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw last;
}

for (const route of ['', 'getting-started/', 'reference/', 'troubleshooting/']) {
  const url = `${expectedBase}${route}`;
  const html = await (await fetchWithRetry(url)).text();
  const canonical = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((match) => match[1]);
  const openGraph = [...html.matchAll(/<meta\s+property="og:url"\s+content="([^"]+)"/g)].map((match) => match[1]);
  assert(canonical.length === 1 && canonical[0] === url, `${url} canonical mismatch`);
  assert(openGraph.length === 1 && openGraph[0] === url, `${url} og:url mismatch`);
  const asset = html.match(/(?:src|href)="(\/capability-graph\/static\/[^"]+)"/)?.[1];
  assert(asset, `${url} has no deploy-base static asset`);
  await fetchWithRetry(`${expectedOrigin}${asset}`);
}

const sitemap = await (await fetchWithRetry(`${expectedBase}sitemap.xml`)).text();
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expectedPages = await documentationPageCount(path.join(websiteRoot, 'docs'));
assert(locations.length === expectedPages && new Set(locations).size === expectedPages, `public sitemap must contain ${expectedPages} unique documentation pages`);
assert(locations.every((url) => url.startsWith(expectedBase) && url.endsWith('/')), 'public sitemap URLs must use directory form');
const redirects = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'route-redirects.json'), 'utf8'));
for (const [source, target] of Object.entries(redirects)) {
  const response = await fetchWithRetry(`${expectedBase}${source}/`);
  const html = await response.text();
  const targetUrl = new URL(`${expectedBase}${target}`).href;
  assert(html.includes('name="capability-graph-redirect"'), `${source} is not a compatibility redirect`);
  assert(html.includes(`<link rel="canonical" href="${targetUrl}">`), `${source} redirect target mismatch`);
}
const robots = await (await fetchWithRetry(`${expectedBase}robots.txt`)).text();
assert(robots.includes('Allow: /') && robots.includes(`${expectedBase}sitemap.xml`), 'public robots.txt mismatch');

const encodedPackage = encodeURIComponent(packageName);
const registry = await (await fetchWithRetry(`https://registry.npmjs.org/${encodedPackage}/${packageVersion}`)).json();
assert(registry.name === packageName && registry.version === packageVersion, 'registry version mismatch');
console.log(`public release check passed: ${locations.length} pages and ${packageName}@${packageVersion}`);
