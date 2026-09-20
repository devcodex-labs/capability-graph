import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const websiteRoot = path.resolve(import.meta.dirname, '..');
const docsRoot = path.join(websiteRoot, 'docs');
const sections = [
  'getting-started',
  'concepts',
  'guides',
  'integrations',
  'examples',
  'reference',
  'troubleshooting'
];
const expectedNav = [
  ['Getting Started', '/getting-started/'],
  ['Concepts', '/concepts/'],
  ['Guides', '/guides/'],
  ['Integrations', '/integrations/'],
  ['Examples', '/examples/'],
  ['Reference', '/reference/'],
  ['GitHub', 'https://github.com/devcodex-labs/capability-graph']
];

function fail(message) {
  throw new Error(`content check failed: ${message}`);
}

function frontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) fail(`${file} has no frontmatter`);
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  if (!values.title || !values.description) fail(`${file} needs nonempty title and description`);
  return values;
}

const nav = JSON.parse(await readFile(path.join(docsRoot, '_nav.json'), 'utf8'));
if (JSON.stringify(nav.map(({ text, link }) => [text, link])) !== JSON.stringify(expectedNav)) {
  fail('_nav.json does not match the frozen navbar contract');
}

try {
  await stat(path.join(docsRoot, '_meta.json'));
  fail('root _meta.json is forbidden');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const home = await readFile(path.join(docsRoot, 'index.mdx'), 'utf8');
for (const section of sections) {
  if (!home.includes(`./${section}/`)) fail(`home does not link section ${section}`);
}

const titles = new Map();
const descriptions = new Map();
const publicPages = [path.join(docsRoot, 'index.mdx')];

for (const section of sections) {
  const sectionRoot = path.join(docsRoot, section);
  const meta = JSON.parse(await readFile(path.join(sectionRoot, '_meta.json'), 'utf8'));
  const overview = await readFile(path.join(sectionRoot, 'index.mdx'), 'utf8');
  const names = meta.filter((item) => item.type === 'file').map((item) => item.name);
  if (new Set(names).size !== names.length) fail(`${section}/_meta.json has duplicate pages`);

  const diskPages = (await readdir(sectionRoot))
    .filter((name) => name.endsWith('.mdx') && name !== 'index.mdx')
    .map((name) => name.slice(0, -4))
    .sort();
  const declared = [...names].sort();
  if (JSON.stringify(diskPages) !== JSON.stringify(declared)) {
    fail(`${section} disk pages and _meta.json differ`);
  }

  for (const name of names) {
    if (!overview.includes(`./${name}`)) fail(`${section}/index.mdx does not link ${name}`);
    publicPages.push(path.join(sectionRoot, `${name}.mdx`));
  }
  publicPages.push(path.join(sectionRoot, 'index.mdx'));
}

const terminology = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'terminology.json'), 'utf8'));
for (const file of publicPages) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(websiteRoot, file).replaceAll('\\', '/');
  const meta = frontmatter(source, relative);
  if (titles.has(meta.title)) fail(`duplicate title in ${relative} and ${titles.get(meta.title)}`);
  if (descriptions.has(meta.description)) fail(`duplicate description in ${relative} and ${descriptions.get(meta.description)}`);
  titles.set(meta.title, relative);
  descriptions.set(meta.description, relative);
  if (source.includes('.devcodex') || /[A-Z]:[\\/](?:Worker|Users)[\\/]/i.test(source)) {
    fail(`${relative} exposes an internal path`);
  }
  if (/\b(?:TODO|TBD)\b/.test(source)) fail(`${relative} contains an unfinished marker`);
  for (const claim of terminology.forbiddenClaims) {
    if (source.includes(claim)) fail(`${relative} contains forbidden claim: ${claim}`);
  }
}

const statuses = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'example-status.json'), 'utf8'));
for (const entry of statuses) {
  if (!terminology.allowedStatuses.includes(entry.status)) fail(`invalid example status ${entry.status}`);
}
const vext = statuses.find((entry) => entry.id === 'vextjs-integration');
if (!vext || vext.status !== 'Conceptual' || vext.source !== null || vext.verify !== null) {
  fail('VextJS integration must remain Conceptual without runnable evidence');
}

const config = await readFile(path.join(websiteRoot, 'rspress.config.ts'), 'utf8');
if (/themeConfig\s*:\s*{[\s\S]*?\b(?:nav|sidebar)\s*:/m.test(config)) {
  fail('rspress.config.ts contains a second nav/sidebar truth source');
}

console.log(`content check passed: ${publicPages.length} pages, ${titles.size} unique titles`);
