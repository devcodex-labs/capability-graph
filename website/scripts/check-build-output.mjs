import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

const outputRoot = path.join(websiteRoot, 'doc_build');
const docsRoot = path.join(websiteRoot, 'docs');
const publicBase = 'https://devcodex-labs.github.io/capability-graph/';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function filesUnder(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = path.join(relative, entry.name);
    return entry.isDirectory() ? filesUnder(root, file) : [file];
  }))).flat();
}

function canonicalForHtml(file) {
  const route = file.replaceAll('\\', '/').replace(/\.html$/, '').replace(/(^|\/)index$/, '$1').replace(/^\/+|\/+$/g, '');
  return `${publicBase}${route ? `${route}/` : ''}`;
}

const files = await filesUnder(outputRoot);
const allHtmlFiles = files.filter((file) => file.endsWith('.html') && file !== '404.html');
const htmlKinds = await Promise.all(allHtmlFiles.map(async (file) => [
  file,
  (await readFile(path.join(outputRoot, file), 'utf8')).includes('name="capability-graph-redirect"')
]));
const htmlFiles = htmlKinds.filter(([, redirect]) => !redirect).map(([file]) => file);
const redirectHtmlFiles = htmlKinds.filter(([, redirect]) => redirect).map(([file]) => file.replaceAll('\\', '/')).sort();
const expectedPages = (await filesUnder(docsRoot)).filter((file) => /\.mdx?$/.test(file)).length;
assert(htmlFiles.length === expectedPages, `expected ${expectedPages} rendered pages from docs routes, received ${htmlFiles.length}`);
const redirects = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'route-redirects.json'), 'utf8'));
const expectedRedirectFiles = Object.keys(redirects)
  .flatMap((source) => [`${source}.html`, `${source}/index.html`])
  .sort();
assert(JSON.stringify(redirectHtmlFiles) === JSON.stringify(expectedRedirectFiles), 'compatibility redirect files do not match route-redirects.json');
for (const [source, target] of Object.entries(redirects)) {
  const targetUrl = new URL(`/capability-graph/${target}`, 'https://devcodex-labs.github.io').href;
  const [targetRoute, fragment] = target.split('#');
  const targetFile = `${targetRoute.replace(/\/$/, '')}.html`;
  const targetHtml = await readFile(path.join(outputRoot, targetFile), 'utf8');
  if (fragment) assert(targetHtml.includes(`id="${fragment}"`), `${source} redirect fragment does not exist in ${targetFile}`);
  for (const file of [`${source}.html`, `${source}/index.html`]) {
    const html = await readFile(path.join(outputRoot, file), 'utf8');
    assert(html.includes('<meta name="robots" content="noindex">'), `${file} redirect must be noindex`);
    assert(html.includes(`<link rel="canonical" href="${targetUrl}">`), `${file} redirect target mismatch`);
  }
}
const canonicalUrls = [];
const pageHashes = {};
for (const file of htmlFiles) {
  const html = await readFile(path.join(outputRoot, file), 'utf8');
  const canonicals = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((match) => match[1]);
  const openGraphUrls = [...html.matchAll(/<meta\s+property="og:url"\s+content="([^"]+)"/g)].map((match) => match[1]);
  assert(canonicals.length === 1, `${file} must contain exactly one canonical URL`);
  assert(openGraphUrls.length === 1, `${file} must contain exactly one og:url`);
  assert(canonicals[0] === openGraphUrls[0], `${file} canonical and og:url differ`);
  assert(canonicals[0] === canonicalForHtml(file), `${file} has unexpected canonical ${canonicals[0]}`);
  const pathname = new URL(canonicals[0]).pathname;
  assert(pathname.startsWith('/capability-graph/'), `${file} is outside the deployment base`);
  assert(!pathname.startsWith('/capability-graph/capability-graph/'), `${file} deployment base is duplicated`);
  canonicalUrls.push(canonicals[0]);
  pageHashes[canonicals[0]] = hash(html);
  assert(!html.includes('.devcodex') && !html.includes('D:\\Worker') && !html.includes('C:\\Users'), `${file} leaks an internal path`);
}
assert(new Set(canonicalUrls).size === canonicalUrls.length, 'canonical URLs are not unique');

const normalizedFiles = new Set(files.map((file) => file.replaceAll('\\', '/')));
const canonicalFileByPath = new Map(htmlFiles.map((file) => [
  new URL(canonicalForHtml(file)).pathname,
  file.replaceAll('\\', '/')
]));
const publicBaseUrl = new URL(publicBase);
for (const sourceFile of htmlFiles) {
  const sourceHtml = await readFile(path.join(outputRoot, sourceFile), 'utf8');
  for (const match of sourceHtml.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const rawHref = match[1].replaceAll('&amp;', '&');
    const targetUrl = new URL(rawHref, canonicalForHtml(sourceFile));
    if (targetUrl.origin !== publicBaseUrl.origin) continue;
    assert(targetUrl.pathname.startsWith(publicBaseUrl.pathname), `${sourceFile} links outside the deployment base: ${rawHref}`);

    const directTarget = decodeURIComponent(targetUrl.pathname.slice(publicBaseUrl.pathname.length));
    const targetFile = normalizedFiles.has(directTarget)
      ? directTarget
      : canonicalFileByPath.get(targetUrl.pathname);
    assert(targetFile && normalizedFiles.has(targetFile), `${sourceFile} has a missing internal link target: ${rawHref}`);

    if (targetUrl.hash && targetFile.endsWith('.html')) {
      const fragment = decodeURIComponent(targetUrl.hash.slice(1));
      const targetHtml = await readFile(path.join(outputRoot, targetFile), 'utf8');
      assert(targetHtml.includes(`id="${fragment}"`), `${sourceFile} has a missing fragment ${targetUrl.hash} in ${targetFile}`);
    }
  }
}

const sitemap = await readFile(path.join(outputRoot, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert(new Set(sitemapUrls).size === sitemapUrls.length, 'sitemap contains duplicate URLs');
assert(sitemapUrls.length === canonicalUrls.length, 'sitemap and rendered page counts differ');
assert(canonicalUrls.every((url) => sitemapUrls.includes(url)), 'sitemap does not exactly match page canonicals');

const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const release = JSON.parse(await readFile(path.join(outputRoot, 'release.json'), 'utf8'));
assert(release.schemaVersion === 'CapabilityGraphPublicReleaseV1', 'public release identity schema mismatch');
assert(release.releaseId === `capability-graph-${manifest.version}`, 'public release id mismatch');
assert(release.releaseTag === `v${manifest.version}`, 'public release tag mismatch');
assert(release.packageName === manifest.name && release.packageVersion === manifest.version, 'public package identity mismatch');
assert(/^[0-9a-f]{40}$/i.test(release.releaseCommit), 'public release commit is invalid');
assert(JSON.stringify(release.pages) === JSON.stringify(Object.fromEntries(Object.entries(pageHashes).sort(([left], [right]) => left.localeCompare(right)))), 'public page hashes do not match the final build');
const expectedReleaseRedirects = {};
for (const [source, target] of Object.entries(redirects)) {
  const url = `${publicBase}${source}/`;
  const html = await readFile(path.join(outputRoot, source, 'index.html'), 'utf8');
  expectedReleaseRedirects[url] = { target: new URL(target, publicBase).href, sha256: hash(html) };
}
assert(JSON.stringify(release.redirects) === JSON.stringify(Object.fromEntries(Object.entries(expectedReleaseRedirects).sort(([left], [right]) => left.localeCompare(right)))), 'public redirect hashes do not match the final build');

const robots = await readFile(path.join(outputRoot, 'robots.txt'), 'utf8');
assert(robots.includes('Allow: /'), 'robots.txt must allow public pages');
assert(robots.includes(`${publicBase}sitemap.xml`), 'robots.txt must point to the public sitemap');
assert(files.some((file) => /static[\\/]search_index\..+\.json$/.test(file)), 'static search index is missing');

const normalizedHtmlFiles = htmlFiles.map((file) => file.replaceAll('\\', '/'));
for (const route of ['index.html', 'getting-started/index.html', 'reference/index.html', 'troubleshooting/index.html']) {
  assert(normalizedHtmlFiles.includes(route), `required route is missing: ${route}`);
}
console.log(`build output check passed: ${htmlFiles.length} pages, ${sitemapUrls.length} sitemap URLs`);
