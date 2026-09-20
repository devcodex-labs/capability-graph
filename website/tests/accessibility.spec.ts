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
  const flow = page.getByRole('img', { name: /Provider 定义能力/ });
  await expect(flow).toBeVisible();
  const motion = await flow.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  const seconds = (value: string) => value.endsWith('ms') ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
  expect(seconds(motion.animationDuration)).toBeLessThanOrEqual(0.00001);
  expect(seconds(motion.transitionDuration)).toBeLessThanOrEqual(0.00001);
});
