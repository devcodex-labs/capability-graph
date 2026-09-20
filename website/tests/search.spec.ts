import { expect, test } from '@playwright/test';

const queries = [
  ['Provider', /Provider and Specification/],
  ['能力关系', /Design Relations|Capability Relations/],
  ['Runtime', /^Runtime$|Use Runtime|Runtime States/],
  ['Knowledge', /^Knowledge$|Knowledge Reader|Knowledge Retriever/],
  ['CG_REVISION_MISMATCH', /ErrorCode and NextAction|Revision and Reload/],
  ['MCP', /Provider-owned MCP/]
] as const;

for (const [query, expectedResult] of queries) {
  test(`search returns documentation for ${query}`, async ({ page }) => {
    await page.goto('./');
    await page.locator('.rp-search-button').click();
    const input = page.getByRole('textbox', { name: 'SearchPanelInput' });
    await expect(input).toBeVisible();
    await input.fill(query);
    await expect(input).toHaveValue(query);
    await expect(page.getByRole('link', { name: expectedResult }).filter({ visible: true }).last()).toBeVisible({ timeout: 10_000 });
  });
}
