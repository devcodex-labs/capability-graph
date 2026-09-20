import { expect, test } from '@playwright/test';

const pages = [
  ['home', './'],
  ['first-provider', 'getting-started/first-provider'],
  ['runtime', 'guides/use-runtime'],
  ['reference', 'reference/capability-graph']
] as const;
const viewports = [
  ['mobile', { width: 375, height: 812 }],
  ['desktop', { width: 1280, height: 800 }]
] as const;

for (const [viewportName, viewport] of viewports) {
  for (const [pageName, route] of pages) {
    test(`${pageName} has no global overflow on ${viewportName}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      await expect(page.locator('h1')).toBeVisible();
      await page.screenshot({
        path: `output/playwright/screenshots/${viewportName}-${pageName}.png`,
        fullPage: true
      });
    });
  }
}

test('home process is vertical and ordered', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  const boxes = page.locator('.cg-flow > div');
  await expect(boxes).toHaveCount(4);
  const positions = await boxes.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  for (let index = 1; index < positions.length; index += 1) {
    expect(positions[index].y).toBeGreaterThan(positions[index - 1].y);
    expect(Math.abs(positions[index].x - positions[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(positions[index].width - positions[0].width)).toBeLessThanOrEqual(1);
  }
});
