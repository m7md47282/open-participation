import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function bodyLuminance(page: Page): Promise<number> {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number);
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
}

test.describe('theme switch', () => {
  test.use({ colorScheme: 'light' });

  test('switches between light, dark and device theme, and remembers the choice', async ({ page }) => {
    await page.goto('/admin');
    const group = page.getByRole('group', { name: 'Colour theme' });
    await expect(group.getByRole('button', { name: 'Use device theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(await bodyLuminance(page)).toBeGreaterThan(0.8);

    await group.getByRole('button', { name: 'Dark theme' }).click();
    await expect(group.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => bodyLuminance(page)).toBeLessThan(0.2);

    // Survives a reload and carries over to other pages.
    await page.reload();
    expect(await bodyLuminance(page)).toBeLessThan(0.2);
    await page.goto('/test-cases');
    await expect(page.getByRole('group', { name: 'Colour theme' }).getByRole('button', { name: 'Dark theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await bodyLuminance(page)).toBeLessThan(0.2);

    await page.getByRole('button', { name: 'Use device theme' }).click();
    await expect.poll(() => bodyLuminance(page)).toBeGreaterThan(0.8);
  });

  test('a forced light theme wins over a dark device', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Light theme' }).click();
    await expect.poll(() => bodyLuminance(page)).toBeGreaterThan(0.8);
  });

  test('the switch is on the lesson page and passes accessibility checks in forced dark', async ({ page }) => {
    await page.goto('/play');
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await expect.poll(() => bodyLuminance(page)).toBeLessThan(0.2);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
