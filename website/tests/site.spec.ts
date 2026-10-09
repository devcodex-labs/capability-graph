import { expect, test } from './fixtures';

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
    .locator('xpath=../following-sibling::div[1]');
  for (const section of ['快速开始', '核心概念', '使用指南', '集成', '示例', 'API 参考', '故障排查']) {
    await expect.poll(() => sectionBody(section).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  }
  const sidebarLabels = await sidebar.getByRole('link').allTextContents();
  expect(sidebarLabels.every((label) => /[\u3400-\u9fff]/u.test(label))).toBe(true);
  expect(sidebarLabels.indexOf('使用指南')).toBeLessThan(sidebarLabels.indexOf('核心概念'));
  await expect(sidebar.getByRole('link', { name: '渐进发现与按需读取', exact: true })).toBeVisible();

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
  await expect(page.locator('pre').getByText('node discover.mjs', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '完整受检示例目录' })).toHaveCount(0);
  await expect(page.getByRole('main')).toContainText('不需要克隆仓库');
  await expect(page.getByText('npm run check:examples', { exact: true })).toHaveCount(0);
});

test('tutorial checkpoints and MCP entry remain directly reachable', async ({ page }) => {
  await page.goto('guides/progressive-discovery#g4-provider-specification');
  await expect(page.locator('h1')).toContainText('渐进发现与按需读取');
  for (const anchor of ['g1-child-capability', 'g2-local-knowledge', 'g3-required-context', 'g4-provider-specification']) {
    await expect(page.locator(`[id="${anchor}"]`)).toHaveCount(1);
  }
  await expect(page.getByRole('main')).toContainText('本节只需要 G0，不需要 G1-G3');
  await page.goto('integrations/provider-owned-mcp#seed-调用示例');
  await expect(page.getByRole('main')).toContainText('node examples/seed-mcp/docs-main-entry/client.mjs');
  await expect(page.getByRole('main')).toContainText('十二工具');
});

test('task navigation keeps API design in integrations and derives section jumps', async ({ page }) => {
  await page.goto('./');
  const sidebar = page.locator('.rp-doc-layout__sidebar');
  const integration = sidebar.locator('[data-section="集成"]');
  await expect(integration.getByRole('link', { name: '设计 Provider API', exact: true })).toHaveAttribute('href', '/capability-graph/getting-started/provider-owned-api');
  await expect(sidebar.locator('[data-section="快速开始"]').getByRole('link', { name: '设计 Provider API' })).toHaveCount(0);
  const options = await sidebar.getByLabel('跳转分区').locator('option').allTextContents();
  const groups = await sidebar.locator('[data-section]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-section')));
  expect(options.slice(1)).toEqual(groups);
  const url = page.url();
  await sidebar.getByLabel('跳转分区').selectOption({ label: '故障排查' });
  await expect(sidebar.getByRole('link', { name: '故障排查', exact: true })).toBeInViewport();
  await expect(page).toHaveURL(url);
});

for (const fragment of ['产品边界', '责任链', '当前边界']) {
  test(`merged product boundary preserves bookmark ${fragment}`, async ({ page }) => {
    await page.goto(`concepts/product-boundary.html#${fragment}`);
    await expect(page).toHaveURL(new RegExp(`/capability-graph/concepts/#${encodeURIComponent(fragment)}$`));
    await expect(page.locator(`[id="${fragment}"]`)).toBeInViewport();
  });
}

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
