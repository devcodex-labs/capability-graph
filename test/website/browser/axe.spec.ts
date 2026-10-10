import { createRequire } from 'node:module';
import { expect, test } from './fixtures';

const require = createRequire(import.meta.url);
for (const width of [390, 1280]) for (const mode of ['light', 'dark'] as const) {
  for (const route of ['./', 'getting-started/installation', 'examples/vextjs-integration', 'reference/knowledge', 'reference/runtime-adapter']) {
    test(`axe WCAG and landmarks: ${route} at ${width}px in ${mode}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((dark) => { localStorage.setItem('rspress-theme-appearance', dark ? 'dark' : 'light'); }, mode === 'dark');
      await page.goto(route);
      await page.evaluate((dark) => document.documentElement.classList.toggle('rp-dark', dark), mode === 'dark');
      await expect(page.getByRole('button', { name: '更多文档选项' })).toBeVisible();
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
        const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
        return result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }));
      });
      expect(violations).toEqual([]);
    });
  }
}

test('document options are a keyboard disclosure with separate actionable controls', async ({ page }) => {
  await page.goto('reference/knowledge');
  const trigger = page.getByRole('button', { name: '更多文档选项' });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '复制 Markdown 链接' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '在 ChatGPT 中打开' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('a.rp-header-anchor[aria-hidden="true"]').evaluateAll((anchors) => anchors.every((anchor) => (anchor as HTMLElement).tabIndex < 0))).toBe(true);
});

test('an overflowing API table scrolls with the keyboard and keeps its table semantics', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('reference/runtime-adapter');
  const tables = page.locator('.rp-table-scroll-container[tabindex="0"]');
  await expect(tables.first()).toBeVisible();
  const table = tables.first();
  await expect(table).toHaveRole('region');
  await expect(table.getByRole('table')).toBeVisible();
  await table.focus();
  const before = await table.evaluate((element) => element.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  await page.keyboard.press('End');
  await expect.poll(() => table.evaluate((element) => Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBeLessThanOrEqual(1);
  await page.keyboard.press('Home');
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBe(0);
  await expect(table).toBeFocused();
  expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});
