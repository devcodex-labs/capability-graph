import { expect, test } from './fixtures';

test('primary controls are keyboard reachable with visible focus', async ({ page }, testInfo) => {
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

test('semantic process label and reduced motion are preserved', async ({ page }, testInfo) => {
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

test('mobile search and site menu expose keyboard semantics and restore focus', async ({ page }, testInfo) => {
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

test('mobile document navigation and page outline are distinguishable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('getting-started/first-provider.html');

  const documentNavigation = page.locator('.rp-sidebar-menu__left');
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

for (const width of [320, 1280]) {
  test(`search traps focus and restores shortcut origin at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('./');
    const origin = page.locator('.rp-nav__title a').first();
    await origin.focus();
    await page.keyboard.press('Control+k');
    const modal = page.getByRole('dialog', { name: '搜索文档' });
    await expect(modal).toBeVisible();
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    expect(await page.getByRole('main', { includeHidden: true }).evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(origin).toBeFocused();
    expect(await origin.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false);
  });
}

test('folding is independent of navigation, removes hidden focus and reports current page', async ({ page }, testInfo) => {
  await page.goto('getting-started/first-provider');
  const originalURL = page.url();
  const sidebar = page.locator('.rp-doc-layout__sidebar');
  const current = sidebar.getByRole('link', { name: '创建第一个 Provider', exact: true });
  await expect(current).toHaveAttribute('aria-current', 'page');
  const toggle = sidebar.getByRole('button', { name: '收起快速开始', exact: true });
  const id = await toggle.getAttribute('aria-controls');
  await toggle.click();
  await expect(page).toHaveURL(originalURL);
  const closed = sidebar.getByRole('button', { name: '展开快速开始', exact: true });
  await expect(closed).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`#${id}`)).toBeHidden();
  await page.keyboard.press('Tab');
  expect(await page.locator(`#${id}`).evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await closed.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(current).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(originalURL);
  await expect(closed).toHaveAttribute('aria-expanded', 'false');
});

for (const width of [320, 375, 390]) {
  test(`mobile document navigation can be cancelled without selecting a page at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('getting-started/first-provider');
    const origin = page.locator('.rp-sidebar-menu__left');
    const url = page.url();
    await origin.click();
    const close = page.getByRole('button', { name: '关闭文档导航', exact: true });
    await expect(close).toBeInViewport();
    await expect(close).toBeFocused();
    const modal = page.getByRole('dialog', { name: '文档导航', exact: true });
    if (width === 320) await page.screenshot({ path: testInfo.outputPath('mobile-320-navigation.png') });
    await page.keyboard.press('Shift+Tab');
    expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(origin).toHaveAttribute('aria-expanded', 'false');
    await expect(origin).toBeFocused();
    await origin.click();
    await close.click();
    await expect(origin).toBeFocused();
    await expect(page).toHaveURL(url);
  });
}

for (const width of [769, 1024, 1280]) {
  test(`navigation releases modal state when resized from mobile to ${width}px and back`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('getting-started/first-provider');
    const trigger = page.locator('.rp-sidebar-menu__left');
    await trigger.click();
    await expect(page.getByRole('dialog', { name: '文档导航', exact: true })).toBeVisible();
    await page.setViewportSize({ width, height: 844 });
    await expect(trigger).toBeHidden();
    await expect(page.getByRole('button', { name: '关闭文档导航', exact: true })).toBeHidden();
    await expect(page.locator('.rp-doc-layout__sidebar')).not.toHaveAttribute('role', 'dialog');
    await expect.poll(() => page.locator('main').evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    await expect(page.locator('.rp-sidebar-menu__mask')).toHaveCount(0);
    if (width === 1024) await page.screenshot({ path: testInfo.outputPath('navigation-1024.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
}

test('resize closes background navigation while keeping search isolated', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('getting-started/first-provider');
  await page.locator('.rp-sidebar-menu__left').click();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: '搜索文档' });
  await expect(search).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(page.locator('.rp-doc-layout__sidebar--open')).toHaveCount(0);
  expect(await page.locator('main').evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await search.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  expect(await page.locator('main').evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('768px boundary retains a visible navigation mask', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto('getting-started/first-provider');
  const trigger = page.locator('.rp-sidebar-menu__left');
  await trigger.click();
  await expect(page.locator('.rp-sidebar-menu__mask')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

for (const width of [320, 768, 1024]) {
  test(`page outline supports Escape without navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('getting-started/first-provider');
    const url = page.url();
    const trigger = page.getByRole('button', { name: '本页目录' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveAttribute('aria-controls', 'cg-page-outline');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(url);
    await trigger.click();
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(page.locator('.rp-doc-layout__outline--open')).toHaveCount(0);
  });
}

for (const mode of ['light', 'dark'] as const) {
  test(`navigation badge and search shortcut contrast are at least 4.5 in ${mode} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.goto('./');
    const hint = page.locator('.rp-search-button__hotkey');
    await expect(hint).toHaveCSS('opacity', '1');
    for (const text of [page.locator('.rp-doc-layout__sidebar .rp-badge--info').last(), hint]) {
    const contrast = await text.evaluate((element) => {
      const rgba = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const composite = (front: number[], back: number[]) => {
        const alpha = front[3] ?? 1;
        return front.slice(0, 3).map((channel, index) => channel * alpha + back[index] * (1 - alpha));
      };
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
      let background = [255, 255, 255];
      for (const node of ancestors) background = composite(rgba(getComputedStyle(node).backgroundColor), background);
      const foreground = composite(rgba(getComputedStyle(element).color), background);
      const luminance = (color: number[]) => color.map((value) => {
        const x = value / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });
}
