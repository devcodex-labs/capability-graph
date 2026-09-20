import { expect, test } from '@playwright/test';

const base = 'https://devcodex-labs.github.io/capability-graph/';

test('top navigation is compact and the global sidebar is complete', async ({ page }) => {
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
  await expect(sidebar.getByRole('link')).toHaveCount(74);
  await expect(sidebar.getByRole('link', { name: '安装', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '超时语义', exact: true })).toBeVisible();
  const sidebarLabels = await sidebar.getByRole('link').allTextContents();
  expect(sidebarLabels.every((label) => /[\u3400-\u9fff]/u.test(label))).toBe(true);

  await page.goto('getting-started/');
  await expect(page.locator('h1')).toContainText('快速开始');
});

for (const [route, canonical] of [
  ['./', base],
  ['getting-started/', `${base}getting-started/`],
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
