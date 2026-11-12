import { expect, test } from '@playwright/test';
import { createShareInUi, createShareViaApi, localPath, setShareStatus, shareRow } from './helpers';

test.describe('visitor play page', () => {
  test('full journey: admin shares, visitor plays without login, report attributes the play', async ({ page, browser }) => {
    const label = `Journey ${Date.now()}`;
    const shareUrl = await createShareInUi(page, label);

    // A separate browser context: no cookies, no login, like a phone scanning the QR code.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(localPath(shareUrl));
    await expect(visitor.getByRole('heading', { name: 'Fire Safety Basics' })).toBeVisible();
    await expect(visitor.getByText('anonymous participant')).toBeVisible();
    await expect(visitor).toHaveTitle(/Training/);

    // The token must not linger in the address bar or history.
    expect(new URL(visitor.url()).hash).toBe('');

    await expect(shareRow(page, label)).toBeVisible();
    await page.reload();
    await expect(shareRow(page, label).getByRole('cell').nth(4)).toHaveText('1'); // playing now

    await visitor.getByRole('button', { name: 'Finish training' }).click();
    await expect(visitor.getByText('Training complete')).toBeVisible();

    await page.reload();
    const shares = shareRow(page, label).first();
    await expect(shares.getByRole('cell').nth(3)).toHaveText('1'); // plays
    await expect(shares.getByRole('cell').nth(4)).toHaveText('0'); // playing now
    const reportRow = page.getByTestId('session-report').getByRole('row').filter({ hasText: `Share: ${label}` });
    await expect(reportRow).toContainText('Anonymous participant');
    await expect(reportRow).toContainText('closed (completed)');
    await visitorContext.close();
  });

  test('an unknown link shows a clear message', async ({ page }) => {
    await page.goto('/play#not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(page.getByRole('heading', { name: 'Unavailable' })).toBeVisible();
    await expect(page.getByText('not valid or is no longer active')).toBeVisible();
  });

  test('a link without a code shows a clear message', async ({ page }) => {
    await page.goto('/play');
    await expect(page.getByText('missing its code')).toBeVisible();
  });

  test('an inactive link is refused, and works again after reactivation', async ({ page, request }) => {
    const { shareUrl, shareId } = await createShareViaApi(request, `Inactive ${Date.now()}`);
    await setShareStatus(request, shareId, 'inactive');
    await page.goto(localPath(shareUrl));
    await expect(page.getByText('not valid or is no longer active')).toBeVisible();

    await setShareStatus(request, shareId, 'active');
    await page.goto('about:blank');
    await page.goto(localPath(shareUrl));
    await expect(page.getByRole('button', { name: 'Finish training' })).toBeVisible();
  });

  test('deactivating while someone is watching ends their playback at the next refresh', async ({ page, request }) => {
    const { shareUrl, shareId } = await createShareViaApi(request, `Mid-play ${Date.now()}`);
    // The demo player runs at 10x speed and would finish before the real 4 minute refresh point,
    // so the redeem response is edited to ask for a refresh after 2 seconds instead.
    await page.route('**/api/public/shares/redeem', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, refreshAfterSeconds: 2 } });
    });
    await page.goto(localPath(shareUrl));
    await expect(page.getByRole('button', { name: 'Finish training' })).toBeVisible();

    await setShareStatus(request, shareId, 'inactive');
    await expect(page.getByText('This link has been deactivated')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Finish training' })).toHaveCount(0);
  });

  test('playback closes its session when the visitor leaves the page', async ({ browser, request }) => {
    const label = `Leave ${Date.now()}`;
    const { shareUrl, shareId } = await createShareViaApi(request, label);
    const ctx = await browser.newContext();
    const visitor = await ctx.newPage();
    await visitor.goto(localPath(shareUrl));
    await expect(visitor.getByRole('button', { name: 'Finish training' })).toBeVisible();
    await visitor.close({ runBeforeUnload: true });
    await ctx.close();

    await expect
      .poll(async () => {
        const res = await request.get(`/api/admin/shares/${shareId}/sessions`, {
          headers: { authorization: 'Bearer demo-admin-acme' },
        });
        return (await res.json()).sessions[0]?.closeReason;
      })
      .toBe('abandoned');
  });
});
