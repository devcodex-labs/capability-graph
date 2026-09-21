import { expect, test } from '@playwright/test';

test('primary controls are keyboard reachable with visible focus', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
  });
  expect(focusStyle.outlineStyle !== 'none' || focusStyle.outlineWidth !== '0px' || focusStyle.boxShadow !== 'none').toBeTruthy();

  await page.locator('.rp-search-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('input').filter({ visible: true }).first()).toBeVisible();
});

test('semantic process label and reduced motion are preserved', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const flow = page.getByRole('img', { name: /Agent 调用 Provider 自有 API 或 MCP/ });
  await expect(flow).toBeVisible();
  await expect(flow.locator('strong')).toHaveText([
    'Agent', 'Provider-owned API / MCP', 'Capability Graph Core', 'Provider 权威来源'
  ]);
  const motion = await flow.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  const seconds = (value: string) => value.endsWith('ms') ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
  expect(seconds(motion.animationDuration)).toBeLessThanOrEqual(0.00001);
  expect(seconds(motion.transitionDuration)).toBeLessThanOrEqual(0.00001);
});

test('mobile search and site menu expose keyboard semantics and restore focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');

  const search = page.locator('.rp-search-button--mobile');
  await expect(search).toHaveRole('button');
  await expect(search).toHaveAccessibleName('搜索文档');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.focus();
  await page.keyboard.press('Space');
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog', { name: '搜索文档' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索文档' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '搜索文档' })).toBeHidden();
  await expect(search).toBeFocused();

  await page.keyboard.press('Enter');
  const closeSearch = page.locator('.rp-search-panel__cancel');
  await expect(closeSearch).toHaveRole('button');
  await expect(closeSearch).toHaveAccessibleName('关闭搜索');
  await closeSearch.focus();
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();

  const siteMenu = page.locator('.rp-nav-hamburger__sm');
  await expect(siteMenu).toHaveAttribute('aria-label', '打开站点菜单');
  await expect(siteMenu).toHaveAttribute('aria-expanded', 'false');
  await siteMenu.focus();
  await page.keyboard.press('Enter');
  await expect(siteMenu).toHaveAttribute('aria-label', '关闭站点菜单');
  await expect(siteMenu).toHaveAttribute('aria-expanded', 'true');
});

test('mobile document navigation and page outline are distinguishable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('getting-started/first-provider.html');

  const documentNavigation = page.getByRole('button', { name: '文档导航' });
  const pageOutline = page.getByRole('button', { name: '本页目录' });
  await expect(documentNavigation).toHaveAttribute('aria-expanded', 'false');
  await expect(pageOutline).toHaveAttribute('aria-expanded', 'false');

  await documentNavigation.click();
  await expect(documentNavigation).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.rp-sidebar-menu__mask').click({ position: { x: 380, y: 800 } });
  await expect(documentNavigation).toHaveAttribute('aria-expanded', 'false');

  await pageOutline.click();
  await expect(pageOutline).toHaveAttribute('aria-expanded', 'true');
});
