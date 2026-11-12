import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('test cases page', () => {
  test('is reachable from the admin page and renders the plan', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('link', { name: 'Test cases' }).click();
    await expect(page).toHaveURL(/\/test-cases$/);
    await expect(page).toHaveTitle(/Test cases/);
    await expect(page.getByRole('heading', { level: 1, name: 'Test cases: Open Participation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '5. R1: only the shared training is playable' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'TC-35', exact: true })).toBeVisible();
  });

  test('summary counts match the rows in the document', async ({ page }) => {
    await page.goto('/test-cases');
    const rows = page.locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: /^TC-\d+$/ }) });
    const total = await rows.count();
    expect(total).toBeGreaterThan(50);
    const stats = page.getByRole('region', { name: 'Summary' });
    await expect(stats).toContainText(`${total}test cases`);
  });

  test('filter narrows the list and can be cleared', async ({ page }) => {
    await page.goto('/test-cases');
    const filter = page.getByLabel('Filter test cases');
    await filter.fill('deactivat');
    await expect(page.getByRole('status')).toContainText(/\d+ of \d+ cases match/);
    await expect(page.getByRole('cell', { name: 'TC-35', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'TC-01', exact: true })).toBeHidden();
    await filter.fill('');
    await expect(page.getByRole('cell', { name: 'TC-01', exact: true })).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`passes accessibility checks in ${scheme} mode without sideways page scroll`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/test-cases');
      await expect(page.getByRole('cell', { name: 'TC-01', exact: true })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: info.outputPath(`test-cases-${scheme}.png`) });
    });
  }
});
