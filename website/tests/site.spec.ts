import { expect, test } from '@playwright/test';

const base = 'https://devcodex-labs.github.io/capability-graph/';

test('top navigation is compact and all sidebar sections are expanded by default', async ({ page }) => {
  await page.goto('./');
  const labels = await page.locator('.rp-nav-menu--right > li > a').allTextContents();
  expect(labels).toEqual(['v1', 'GitHub']);
  await expect(page.locator('.rp-nav-menu--right').getByRole('link', { name: 'v1', exact: true }))
    .toHaveAttribute('href', /^\/capability-graph\/(?:index\.html)?$/);
  await expect(page.locator('.rp-nav-menu--right').getByRole('link', { name: 'GitHub' }))
    .toHaveAttribute('href', 'https://github.com/devcodex-labs/capability-graph');

  const sidebar = page.locator('.rp-doc-layout__sidebar');
  await expect(sidebar.getByRole('link', { name: '概览', exact: true })).toBeVisible();
  for (const section of ['快速开始', '核心概念', '使用指南', '集成', '示例', 'API 参考', '故障排查']) {
    await expect(sidebar.getByRole('link', { name: section, exact: true })).toBeVisible();
  }
  const sectionBody = (name: string) => sidebar.getByRole('link', { name, exact: true })
    .locator('xpath=following-sibling::div[1]');
  for (const section of ['快速开始', '核心概念', '使用指南', '集成', '示例', 'API 参考', '故障排查']) {
    await expect.poll(() => sectionBody(section).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  }
  const sidebarLabels = await sidebar.getByRole('link').allTextContents();
  expect(sidebarLabels.every((label) => /[\u3400-\u9fff]/u.test(label))).toBe(true);

  await page.goto('getting-started/first-provider');
  await expect(page.locator('h1')).toContainText('创建第一个 Provider');
  for (const section of ['快速开始', '核心概念', '使用指南', '集成', '示例', 'API 参考', '故障排查']) {
    await expect.poll(() => sectionBody(section).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  }
});

test('home section links use canonical index routes and quick start continues to installation', async ({ page }) => {
  await page.goto('./');
  const main = page.getByRole('main');
  for (const [label, section] of [
    ['快速开始', 'getting-started'],
    ['核心概念', 'concepts'],
    ['使用指南', 'guides'],
    ['集成', 'integrations'],
    ['示例', 'examples'],
    ['API 参考', 'reference'],
    ['故障排查', 'troubleshooting']
  ] as const) {
    await expect(main.getByRole('link', { name: label, exact: true }).first())
      .toHaveAttribute('href', `/capability-graph/${section}/`);
  }

  await main.getByRole('link', { name: '快速开始', exact: true }).first().click();
  await expect(page).toHaveURL(/\/capability-graph\/getting-started\/$/);
  await expect(page.locator('.rp-prev-next-page__next')).toContainText('安装');
});

test('first Provider starts with a complete runnable path', async ({ page }) => {
  await page.goto('getting-started/first-provider.html');
  await expect(page.locator('h2').first()).toContainText('最快跑通');
  await expect(page.getByRole('link', { name: '完整受检示例目录' }))
    .toHaveAttribute('href', 'https://github.com/devcodex-labs/capability-graph/tree/main/website/fixtures/first-provider');
  await expect(page.getByText('node first-provider/discover.mjs', { exact: true })).toBeVisible();
  await expect(page.getByText('npm run check:examples', { exact: true })).toHaveCount(0);
});

for (const [route, canonical] of [
  ['./', base],
  ['getting-started/', `${base}getting-started/`],
  ['getting-started/first-provider', `${base}getting-started/first-provider`],
  ['reference/', `${base}reference/`],
  ['troubleshooting/', `${base}troubleshooting/`]
] as const) {
  test(`canonical metadata is unique for ${route}`, async ({ page }) => {
    await page.goto(route);
    const canonicalLink = page.locator('link[rel="canonical"]');
    const openGraph = page.locator('meta[property="og:url"]');
    await expect(canonicalLink).toHaveCount(1);
    await expect(openGraph).toHaveCount(1);
    await expect(canonicalLink).toHaveAttribute('href', canonical);
    await expect(openGraph).toHaveAttribute('content', canonical);
  });
}
