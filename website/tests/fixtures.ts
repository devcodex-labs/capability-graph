import { expect, test as base } from '@playwright/test';

export { expect };
export const test = base.extend<{ browserErrors: void; expectedHTTPFailures: { url: RegExp; status: number }[] }>({
  expectedHTTPFailures: [[], { option: true }],
  browserErrors: [async ({ page, expectedHTTPFailures }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText.includes('ERR_ABORTED')) return;
      if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(request.resourceType())) {
        errors.push(`${request.url()}: ${request.failure()?.errorText}`);
      }
    });
    page.on('response', (response) => {
      if (expectedHTTPFailures.some(({ url, status }) => response.status() === status && url.test(response.url()))) return;
      if (response.status() >= 400 && ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(response.request().resourceType())) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    await use();
    expect(errors, 'uncaught errors and failed essential requests').toEqual([]);
  }, { auto: true }]
});
