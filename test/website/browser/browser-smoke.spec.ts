import { expect, test } from './fixtures';

test('browser smoke: sidebar navigation reaches the complete tutorial', async ({ page }) => {
  await page.goto('./');
  const sidebar = page.locator('.rp-doc-layout__sidebar');
  await sidebar.getByRole('link', { name: '创建第一个 Provider', exact: true }).click();
  await expect(page).toHaveURL(/getting-started\/first-provider$/);
  await expect(page.getByRole('main').locator('h1')).toContainText('创建第一个 Provider');
  await expect(page.getByRole('main')).toContainText('discover.mjs');
});

test('browser smoke: keyboard search navigates and Escape restores focus', async ({ page }) => {
  await page.goto('./');
  const button = page.locator('.rp-search-button');
  await button.click();
  const input = page.getByRole('textbox', { name: '搜索文档' });
  await expect(input).toBeFocused();
  await input.fill('MCP');
  await expect(page.locator('.rp-search-panel__results a').first()).toBeVisible();
  await input.press('Escape');
  await expect(button).toBeFocused();
  await button.click(); await input.fill('MCP');
  const first = page.locator('.rp-search-panel__results a').first();
  await expect(first).toBeVisible();
  const href = await first.getAttribute('href');
  await input.press('ArrowDown'); await input.press('Enter');
  await expect(page).toHaveURL(new URL(href!, page.url()).href);
  await expect(page.getByRole('main').locator('h1')).toBeVisible();
});

test('browser smoke: mobile navigation releases modal state and keeps the article visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('getting-started/first-provider');
  const trigger = page.getByRole('button', { name: '文档导航', exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('main').locator('h1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
