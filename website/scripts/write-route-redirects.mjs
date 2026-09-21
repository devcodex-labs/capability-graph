import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { websiteRoot } from './lib/paths.mjs';

const outputRoot = path.join(websiteRoot, 'doc_build');
const publicOrigin = 'https://devcodex-labs.github.io';
const publicBase = '/capability-graph/';
const redirects = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'route-redirects.json'), 'utf8'));

function assertRoute(value, field) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9/-]*(?:#[^<>"']+)?$/u.test(value)) {
    throw new Error(`invalid ${field} redirect route: ${value}`);
  }
}

function redirectHtml(target) {
  const relativeTarget = `${publicBase}${target}`;
  const absoluteTarget = new URL(relativeTarget, publicOrigin).href;
  const encodedTarget = JSON.stringify(relativeTarget).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="capability-graph-redirect" content="v1">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0;url=${absoluteTarget}">
  <link rel="canonical" href="${absoluteTarget}">
  <title>文档已迁移</title>
</head>
<body>
  <p>文档已迁移到<a href="${absoluteTarget}">新位置</a>。</p>
  <script>location.replace(${encodedTarget});</script>
</body>
</html>
`;
}

for (const [source, target] of Object.entries(redirects)) {
  assertRoute(source, 'source');
  assertRoute(target, 'target');
  const html = redirectHtml(target);
  const flatPath = path.join(outputRoot, `${source}.html`);
  const directoryPath = path.join(outputRoot, source, 'index.html');
  await mkdir(path.dirname(flatPath), { recursive: true });
  await mkdir(path.dirname(directoryPath), { recursive: true });
  await writeFile(flatPath, html, 'utf8');
  await writeFile(directoryPath, html, 'utf8');
}

console.log(`generated ${Object.keys(redirects).length} compatibility redirects`);
