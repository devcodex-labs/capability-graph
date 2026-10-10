import { expect, test } from './fixtures';

const queries = [
  ['Provider', /Provider 与 Specification|建模 Provider|创建第一个 Provider/],
  ['能力关系', /设计关系|关系模型|身份与关系/],
  ['Runtime', /运行时模型|使用运行时|运行时状态|运行时接口/],
  ['Knowledge', /知识模型|知识读取|KnowledgeReader 接入|KnowledgeRetriever 接入/],
  ['CG_REVISION_MISMATCH', /错误与恢复动作|修订、预算与分页/],
  ['MCP', /Provider 自有 MCP|Seed MCP 示例/],
  ['必要上下文', /渐进发现与按需读取|查询接口|身份与关系/]
] as const;

for (const [query, expectedResult] of queries) {
  test(`search returns documentation for ${query}`, async ({ page }, testInfo) => {
    await page.goto('./');
    await page.locator('.rp-search-button').click();
    const input = page.getByRole('textbox', { name: '搜索文档' });
    await expect(input).toBeVisible();
    await input.fill(query);
    await expect(input).toHaveValue(query);
    await expect(page.getByRole('dialog', { name: '搜索文档' }).getByRole('link', { name: expectedResult }).last()).toBeVisible({ timeout: 10_000 });
  });
}

test('Enter outside search never throws or reuses a closed result', async ({ page }, testInfo) => {
  await page.goto('./');
  const originalURL = page.url();
  await page.locator('body').press('Enter');
  await expect(page).toHaveURL(originalURL);
  await page.locator('.rp-search-button').click();
  await page.getByRole('textbox', { name: '搜索文档' }).fill('MCP');
  await expect(page.locator('.rp-search-panel__results a').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('body').press('Enter');
  await expect(page).toHaveURL(originalURL);
});

test('empty, cleared and zero-result searches ignore Enter and arrows', async ({ page }, testInfo) => {
  await page.goto('./');
  const originalURL = page.url();
  await page.locator('.rp-search-button').click();
  const input = page.getByRole('textbox', { name: '搜索文档' });
  await input.press('ArrowUp');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(originalURL);
  await input.fill('MCP');
  await expect(page.locator('.rp-search-panel__results a').first()).toBeVisible();
  await input.fill('');
  await input.press('Enter');
  await expect(page).toHaveURL(originalURL);
  await input.fill('zzzz_no_matching_document_92831');
  await expect(page.locator('.rp-search-panel__results')).toContainText('没有找到');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page).toHaveURL(originalURL);
});

test('IME confirmation does not navigate; a normal selected result does', async ({ page }, testInfo) => {
  await page.goto('./');
  const originalURL = page.url();
  await page.locator('.rp-search-button').click();
  const input = page.getByRole('textbox', { name: '搜索文档' });
  await input.fill('MCP');
  const first = page.locator('.rp-search-panel__results a').first();
  await expect(first).toBeVisible();
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(page).toHaveURL(originalURL);
  const href = await first.getAttribute('href');
  await input.press('Enter');
  await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  await expect(page.getByRole('dialog', { name: '搜索文档' })).toBeHidden();
});

test('clear cancels visible stale results even while a query is debouncing', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.locator('.rp-search-button').click();
  const input = page.getByRole('textbox', { name: '搜索文档' });
  await input.fill('MCP');
  await expect(page.locator('.rp-search-panel__results a').first()).toBeVisible();
  await input.fill('Runtime');
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.rp-search-panel__results')).toContainText('输入关键词');
  // Wait beyond the engine debounce by completing a browser round trip with its timer.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
  await expect(page.locator('.rp-search-panel__results a')).toHaveCount(0);
  await input.press('Enter');
  await expect(page).toHaveURL(/\/capability-graph\/$/);
});

test.describe('search recovers from an unavailable index', () => {
  // Only the deliberately injected index 503 is expected; other browser and
  // essential request failures still fail the shared fixture.
  test.use({ expectedHTTPFailures: [{ url: /\/search_index[^/]*\.json$/, status: 503 }] });
  for (const recovery of ['reopen', 'retry'] as const) {
    test(`transient 503 recovers by ${recovery} with focus and keyboard navigation`, async ({ page }, testInfo) => {
      let failures = 0;
      await page.route('**/search_index*.json', (route) => {
        failures++;
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      });
      await page.goto('./');
      const origin = page.locator('.rp-search-button');
      await origin.click();
      await expect(page.getByRole('alert')).toContainText('搜索索引加载失败');
      expect(failures).toBeGreaterThan(0);
      const input = page.getByRole('textbox', { name: '搜索文档' });
      await input.fill('Provider');
      await page.unroute('**/search_index*.json');
      if (recovery === 'reopen') {
        await page.keyboard.press('Escape');
        await expect(origin).toBeFocused();
        await page.keyboard.press('Control+k');
        await input.fill('Provider');
      } else {
        await page.getByRole('button', { name: '重试搜索' }).click();
        await expect(input).toHaveValue('Provider');
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(input).toBeFocused();
      const result = page.locator('.rp-search-panel__results a').first();
      await expect(result).toBeVisible();
      if (recovery === 'retry') await page.screenshot({ path: testInfo.outputPath('search-recovered.png') });
      // Recovery must not leave background inert or lose the opening control.
      await page.keyboard.press('Escape');
      await expect(origin).toBeFocused();
      expect(await origin.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false);
      await page.keyboard.press('Control+k');
      await input.fill('Provider');
      await expect(result).toBeVisible();
      const href = await result.getAttribute('href');
      await input.press('Enter');
      await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    });
  }
});
