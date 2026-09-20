import { expect, test } from '@playwright/test';

const base = 'https://devcodex-labs.github.io/capability-graph/';

test('top navigation and home section directory are complete', async ({ page }) => {
  await page.goto('./');
  const labels = await page.locator('.rp-nav-menu--right > li > a').allTextContents();
  expect(labels).toEqual(['Getting Started', 'Concepts', 'Guides', 'Integrations', 'Examples', 'Reference', 'GitHub']);
  await expect(page.locator('.rp-nav-menu--right').getByRole('link', { name: 'GitHub' }))
    .toHaveAttribute('href', 'https://github.com/devcodex-labs/capability-graph');

  const content = page.locator('.rspress-doc');
  for (const section of ['Getting Started', 'Concepts', 'Guides', 'Integrations', 'Examples', 'Reference', 'Troubleshooting']) {
    await expect(content.getByRole('link', { name: section, exact: true }).first()).toBeVisible();
  }
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
