import { defineConfig } from '@rspress/core';
import { pluginSitemap } from '@rspress/plugin-sitemap';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const siteOrigin = 'https://devcodex-labs.github.io';
const base = '/capability-graph/';

/** Build the one canonical directory-style public URL used by HTML and tests. */
export function toPublicUrl(routePath: string): string {
  const rawRoute = routePath.split(/[?#]/, 1)[0] ?? '';
  const absoluteRoute = `/${rawRoute.replace(/^\/+/, '')}`;
  if (absoluteRoute === base.slice(0, -1) || absoluteRoute.startsWith(base)) {
    throw new Error(`routePath must not include deployment base: ${routePath}`);
  }

  const route = rawRoute
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.html$/, '')
    .replace(/(^|\/)index$/, '$1')
    .replace(/\/+$/g, '');

  return new URL(`${base}${route ? `${route}/` : ''}`, siteOrigin).href;
}

function documentationRoutes(root: string, relative = ''): string[] {
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) return documentationRoutes(root, file);
    if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) return [];
    const withoutExtension = file.replace(/\.mdx?$/, '');
    if (withoutExtension === 'index') return ['/'];
    if (withoutExtension.endsWith('/index')) return [`/${withoutExtension.slice(0, -'index'.length)}`];
    return [`/${withoutExtension}`];
  });
}

const sitemapMaps = Object.fromEntries(
  documentationRoutes(path.resolve('docs')).map((routePath) => [routePath, { loc: toPublicUrl(routePath) }])
);

export default defineConfig({
  root: 'docs',
  title: 'Capability Graph',
  description: '面向 Provider 的能力建模、发现与知识导航基础设施',
  base,
  siteOrigin,
  lang: 'zh',
  llms: process.env.DOCS_ENABLE_LLMS === 'true',
  plugins: [pluginSitemap({ customMaps: sitemapMaps })],
  head: [
    (route) => ['link', { rel: 'canonical', href: toPublicUrl(route.routePath) }],
    (route) => ['meta', { property: 'og:url', content: toPublicUrl(route.routePath) }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Capability Graph' }]
  ],
  themeConfig: {
    search: true
  }
});
