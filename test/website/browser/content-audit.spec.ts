import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';

const docsRoot = fileURLToPath(new URL('../../../website/docs/', import.meta.url));
function docFiles(relative = ''): string[] {
  return readdirSync(`${docsRoot}/${relative}`, { withFileTypes: true }).flatMap((entry) => {
    const file = `${relative}${entry.name}`;
    return entry.isDirectory() ? docFiles(`${file}/`) : /\.mdx?$/.test(file) ? [file] : [];
  });
}
const routes = docFiles().sort().map((file) => file.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '$1'));
const publicBase = 'https://devcodex-labs.github.io/capability-graph/';

for (const width of [320, 768, 1280]) {
  test(`every published page is legible with route metadata at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await test.step(route || 'home', async () => {
        await page.goto(route || './');
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByRole('main')).toHaveCount(1);
        await expect(page.getByRole('main').locator('h1')).toHaveCount(1);
        await expect(page.getByRole('main').locator('h1')).toBeVisible();
        await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${publicBase}${route}`);
        await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${publicBase}${route}`);
        const widths = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth
        }));
        expect(widths.scroll, `${route}: global horizontal overflow`).toBeLessThanOrEqual(widths.client + 1);
        const tables = await page.locator('.rp-doc table').evaluateAll((elements) => elements.map((element) => {
          const table = element.getBoundingClientRect();
          const container = element.closest('.rp-doc')!.getBoundingClientRect();
          return { right: table.right, containerRight: container.right };
        }));
        for (const table of tables) expect(table.right, `${route}: table extends outside its article`).toBeLessThanOrEqual(table.containerRight + 1);
        if (route === 'reference/queries-and-results') {
          await page.screenshot({ path: testInfo.outputPath(`audit-${width}-queries.png`) });
        }
      });
    }
    expect(routes).toHaveLength(45);
  });
}
