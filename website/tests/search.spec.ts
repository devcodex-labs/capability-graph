import { expect, test } from '@playwright/test';

const queries = [
  ['Provider', /Provider 与 Specification|建模 Provider|创建第一个 Provider/],
  ['能力关系', /设计关系|关系模型/],
  ['Runtime', /运行时模型|使用运行时|运行时状态|运行时接口/],
  ['Knowledge', /知识模型|知识读取|KnowledgeReader 接入|KnowledgeRetriever 接入/],
  ['CG_REVISION_MISMATCH', /ErrorCode 与 NextAction|修订与重新加载/],
  ['MCP', /Provider 自有 MCP|Seed MCP 示例/]
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
