import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { websiteRoot, generatedRoot } from '../../lib/website-paths.mjs';

const docsRoot = path.join(websiteRoot, 'docs');
const sections = [
  'getting-started',
  'guides',
  'concepts',
  'integrations',
  'examples',
  'reference',
  'troubleshooting'
];
const sectionLabels = new Map([
  ['getting-started', '快速开始'],
  ['concepts', '核心概念'],
  ['guides', '使用指南'],
  ['integrations', '集成'],
  ['examples', '示例'],
  ['reference', 'API 参考'],
  ['troubleshooting', '故障排查']
]);
const expectedNav = [
  ['v1', '/'],
  ['GitHub', 'https://github.com/devcodex-labs/capability-graph']
];
const expectedRootSidebar = [
  ['file', 'index', '概览'],
  ...sections.map((name) => ['dir', name, sectionLabels.get(name)])
];

function fail(message) {
  throw new Error(`content check failed: ${message}`);
}

function assertChineseNavigationLabel(value, location) {
  if (typeof value !== 'string' || !/[\u3400-\u9fff]/u.test(value)) {
    fail(`${location} must use a Chinese user-facing label`);
  }
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

const rootSidebar = JSON.parse(await readFile(path.join(docsRoot, '_meta.json'), 'utf8'));
const rootSidebarShape = rootSidebar.map(({ type, name, label }) => [type, name, label]);
if (JSON.stringify(rootSidebarShape) !== JSON.stringify(expectedRootSidebar)) {
  fail('root _meta.json does not expose the complete global sidebar');
}
for (const item of rootSidebar) assertChineseNavigationLabel(item.label, `root sidebar ${item.name}`);
for (const item of rootSidebar.filter(({ type }) => type === 'dir')) {
  if (item.collapsible !== true || item.collapsed !== false) {
    fail(`global sidebar section ${item.name} must be collapsible and initially expanded`);
  }
}
const expectedPageTitles = new Map();

const home = await readFile(path.join(docsRoot, 'index.mdx'), 'utf8');
for (const section of sections) {
  if (!home.includes(`./${section}/index`)) fail(`home does not link canonical section index ${section}`);
}

const titles = new Map();
const descriptions = new Map();
const publicPages = [path.join(docsRoot, 'index.mdx')];
const navigationRoutes = [];
const diskRoutes = [];

for (const section of sections) {
  const sectionRoot = path.join(docsRoot, section);
  const meta = JSON.parse(await readFile(path.join(sectionRoot, '_meta.json'), 'utf8'));
  const overview = await readFile(path.join(sectionRoot, 'index.mdx'), 'utf8');
  expectedPageTitles.set(`docs/${section}/index.mdx`, sectionLabels.get(section));
  const names = meta.filter((item) => item.type === 'file').map((item) => item.name);
  for (const item of meta) {
    assertChineseNavigationLabel(item.label, `${section}/_meta.json:${item.name}`);
    if (item.tag !== undefined) assertChineseNavigationLabel(item.tag, `${section}/_meta.json:${item.name}:tag`);
    const route = item.type === 'file' ? `${section}/${item.name}` : item.link?.replace(/^\//, '');
    if (!route || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(route)) fail(`invalid internal navigation route in ${section}`);
    navigationRoutes.push(route);
    expectedPageTitles.set(`docs/${route}.mdx`, item.label);
    const relativeLink = item.type === 'file' ? `./${item.name}` : `../${route}`;
    if (!overview.includes(relativeLink)) fail(`${section}/index.mdx does not link ${route}`);
  }
  if (new Set(names).size !== names.length) fail(`${section}/_meta.json has duplicate pages`);

  const diskPages = (await readdir(sectionRoot))
    .filter((name) => name.endsWith('.mdx') && name !== 'index.mdx')
    .map((name) => name.slice(0, -4))
    .sort();
  for (const name of diskPages) {
    diskRoutes.push(`${section}/${name}`);
    publicPages.push(path.join(sectionRoot, `${name}.mdx`));
  }
  publicPages.push(path.join(sectionRoot, 'index.mdx'));
}
if (new Set(navigationRoutes).size !== navigationRoutes.length ||
    JSON.stringify([...navigationRoutes].sort()) !== JSON.stringify([...diskRoutes].sort())) {
  fail('every topic route must have exactly one navigation entry, including cross-section links');
}

const terminology = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'terminology.json'), 'utf8'));
for (const file of publicPages) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(websiteRoot, file).replaceAll('\\', '/');
  const meta = frontmatter(source, relative);
  const expectedTitle = expectedPageTitles.get(relative);
  if (expectedTitle !== undefined) {
    if (meta.title !== expectedTitle) fail(`${relative} title must match its Chinese navigation label`);
    const heading = source.match(/^# (.+)$/m)?.[1];
    if (heading !== expectedTitle) fail(`${relative} H1 must match its Chinese navigation label`);
  }
  for (const status of source.matchAll(/<span className="cg-status">([^<]+)<\/span>/g)) {
    assertChineseNavigationLabel(status[1], `${relative} status badge`);
  }
  if (titles.has(meta.title)) fail(`duplicate title in ${relative} and ${titles.get(meta.title)}`);
  if (descriptions.has(meta.description)) fail(`duplicate description in ${relative} and ${descriptions.get(meta.description)}`);
  titles.set(meta.title, relative);
  descriptions.set(meta.description, relative);
  if (source.includes('.devcodex') || /[A-Z]:[\\/](?:Worker|Users)[\\/]/i.test(source)) {
    fail(`${relative} exposes an internal path`);
  }
  if (source.includes('@devcodex-labs/')) {
    fail(`${relative} uses the retired npm scope @devcodex-labs`);
  }
  if (/\b(?:TODO|TBD)\b/.test(source)) fail(`${relative} contains an unfinished marker`);
  for (const claim of terminology.forbiddenClaims) {
    if (source.includes(claim)) fail(`${relative} contains forbidden claim: ${claim}`);
  }
}

const statuses = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'example-status.json'), 'utf8'));
for (const entry of statuses) {
  if (!terminology.allowedStatuses.includes(entry.status)) fail(`invalid example status ${entry.status}`);
  if (!Array.isArray(entry.prerequisites) || !Array.isArray(entry.userResponsibilities) ||
      !entry.userResponsibilities.length || typeof entry.proof !== 'string' || !entry.proof) {
    fail(`${entry.id} must document preparation, proof boundaries and user responsibilities`);
  }
  if (entry.status === 'Conceptual') {
    if (entry.runDir !== null || entry.entry !== null) fail(`${entry.id} cannot claim a runnable cwd/entry`);
  } else if (typeof entry.runDir !== 'string' || typeof entry.entry !== 'string') {
    fail(`${entry.id} needs an explicit execution cwd and entry`);
  }
}
const vext = statuses.find((entry) => entry.id === 'vextjs-integration');
if (!vext || vext.status !== 'Contract-only' || vext.source !== '../examples/vextjs' || vext.verify !== 'npm test') {
  fail('VextJS integration must retain the explicit contract and opt-in real-source boundary');
}

const publicRoutes = new Set(publicPages.map((file) => path.relative(docsRoot, file)
  .replaceAll('\\', '/')
  .replace(/\.mdx?$/, '')
  .replace(/(^|\/)index$/, '$1')
  .replace(/\/$/, '')));
const redirects = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'route-redirects.json'), 'utf8'));
for (const [source, target] of Object.entries(redirects)) {
  const targetRoute = target.split('#', 1)[0].replace(/\/$/, '');
  if (publicRoutes.has(source)) fail(`redirect source ${source} still exists as a formal page`);
  if (!publicRoutes.has(targetRoute)) fail(`redirect target ${targetRoute} is not a formal page`);
}

const config = await readFile(path.join(websiteRoot, 'rspress.config.ts'), 'utf8');
if (/themeConfig\s*:\s*{[\s\S]*?\b(?:nav|sidebar)\s*:/m.test(config)) {
  fail('rspress.config.ts contains a second nav/sidebar truth source');
}

const publicApiSnippet = await readFile(path.join(generatedRoot, 'snippets', 'public-api.mdx'), 'utf8');
if (!publicApiSnippet.startsWith('## 生成的公开符号\n\n| 符号 | 类型 |')) {
  fail('generated public API navigation text must remain Chinese');
}
const errorSnippet = await readFile(path.join(generatedRoot, 'snippets', 'errors.mdx'), 'utf8');
if (!errorSnippet.includes('## 完整错误语义') ||
    !errorSnippet.includes('| ErrorCode | 含义 | 常见触发 | 典型 NextAction | 调用方处理 |') ||
    !errorSnippet.includes('## 完整 NextAction 联合类型')) {
  fail('generated error reference headings must remain Chinese');
}

console.log(`content check passed: ${publicPages.length} pages, ${titles.size} unique titles`);
