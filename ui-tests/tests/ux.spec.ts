import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createShareInUi, createShareViaApi, localPath } from './helpers';

/** WCAG 2.1 A and AA rules, which is the usual bar for enterprise customers. */
async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('admin page passes accessibility checks, including after creating a share', async ({ page }, info) => {
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Shares' })).toBeVisible();
      await expectNoA11yViolations(page);
      await createShareInUi(page, `A11y ${scheme} ${Date.now()}`);
      await expectNoA11yViolations(page);
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: info.outputPath(`admin-${scheme}.png`), fullPage: true });
    });

    test('play page passes accessibility checks while playing, finished and unavailable', async ({ page, request }, info) => {
      const { shareUrl } = await createShareViaApi(request, `A11y play ${scheme} ${Date.now()}`);
      await page.goto(localPath(shareUrl));
      await expect(page.getByRole('button', { name: 'Finish training' })).toBeVisible();
      await expectNoA11yViolations(page);
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: info.outputPath(`play-${scheme}.png`) });

      await page.getByRole('button', { name: 'Finish training' }).click();
      await expect(page.getByText('Training complete')).toBeVisible();
      await expectNoA11yViolations(page);

      await page.goto('/play#unknown-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      await expect(page.getByRole('heading', { name: 'Unavailable' })).toBeVisible();
      await expectNoA11yViolations(page);
    });

    test('dark and light themes actually apply', async ({ page }) => {
      await page.goto('/admin');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const [r, g, b] = bg.match(/\d+/g)!.map(Number);
      const luminance = (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
      if (scheme === 'dark') expect(luminance).toBeLessThan(0.2);
      else expect(luminance).toBeGreaterThan(0.8);
    });
  });
}

test('the admin flow works with the keyboard only', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'keyboard flow is a desktop concern');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Share a training' })).toBeVisible();

  await page.getByLabel('Training to share').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Label')).toBeFocused();
  await page.keyboard.type(`Keyboard ${Date.now()}`);
  await page.keyboard.press('Tab');
  const create = page.getByRole('button', { name: 'Create share' });
  await expect(create).toBeFocused();

  // A visible focus indicator is required for keyboard users.
  const outline = await create.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('share-url')).toBeVisible();
});

test('the play page is comfortable on a phone', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone-only check');
  const { shareUrl } = await createShareViaApi(request, `Phone ${Date.now()}`);
  await page.goto(localPath(shareUrl));
  const finish = page.getByRole('button', { name: 'Finish training' });
  await expect(finish).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Touch targets at least 44 by 44 CSS pixels (WCAG 2.5.5, Apple and Material guidance).
  const box = (await finish.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  // The main action is visible without scrolling.
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  // Text is not too small to read.
  const fontSize = await page.getByRole('heading', { level: 1 }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(20);
});

test('admin page has no horizontal page scroll on a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone-only check');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Shares' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('on a phone, the deactivate action is visible without sideways scrolling', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone-only check');
  const label = `Phone admin ${Date.now()}`;
  await createShareViaApi(request, label);
  await page.goto('/admin');
  const button = page.getByRole('row').filter({ hasText: label }).getByRole('button', { name: 'Mark inactive' });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('admin-phone-cards.png'), fullPage: false });
});

test('loading state is announced while the share is being opened', async ({ page, request }) => {
  const { shareUrl } = await createShareViaApi(request, `Slow ${Date.now()}`);
  await page.route('**/api/public/shares/redeem', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto(localPath(shareUrl));
  await expect(page.getByRole('status')).toHaveText('Opening training…');
  await expect(page.getByRole('button', { name: 'Finish training' })).toBeVisible();
});

test('no console errors on either page', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Shares' })).toBeVisible();
  const { shareUrl } = await createShareViaApi(request, `Console ${Date.now()}`);
  await page.goto(localPath(shareUrl));
  await page.getByRole('button', { name: 'Finish training' }).click();
  await expect(page.getByText('Training complete')).toBeVisible();
  expect(errors).toEqual([]);
});
