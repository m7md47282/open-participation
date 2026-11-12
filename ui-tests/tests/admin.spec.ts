import { expect, test } from '@playwright/test';
import { createShareInUi, shareRow } from './helpers';

test.describe('admin page', () => {
  test('shows the signed-in admin, organisation and only shareable training', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveTitle(/Shares/);
    await expect(page.getByText('Alice Admin · Acme Construction')).toBeVisible();

    const options = page.getByLabel('Training to share').locator('option');
    await expect(options).toHaveText(['Fire Safety Basics', 'Forklift Hazard Awareness']);
    await expect(page.getByText('Confined Space Entry')).toBeVisible();
    await expect(page.getByText('not shareable')).toBeVisible();
  });

  test('creating a share shows the QR code and link once, and lists the share', async ({ page }) => {
    const label = `Gate poster ${Date.now()}`;
    await createShareInUi(page, label);

    const qr = page.getByRole('img', { name: `QR code for ${label}` });
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await expect(page.getByText('The link is shown only once')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download QR' })).toHaveAttribute('download', 'share-qr.png');

    await expect(shareRow(page, label)).toContainText('active');
    await expect(page.getByTestId('audit-log')).toContainText('share.created');

    // After a reload the link cannot be shown again: only its hash is stored.
    await page.reload();
    await expect(page.getByTestId('share-url')).toHaveCount(0);
    await expect(shareRow(page, label)).toBeVisible();
  });

  test('marking a share inactive and reactivating it is reflected and audited', async ({ page }) => {
    const label = `Toggle ${Date.now()}`;
    await createShareInUi(page, label);
    await page.getByRole('button', { name: 'Done' }).click();

    const row = shareRow(page, label);
    await row.getByRole('button', { name: 'Mark inactive' }).click();
    await expect(row).toContainText('inactive');
    await expect(page.getByTestId('audit-log')).toContainText('share.deactivated');

    await row.getByRole('button', { name: 'Reactivate' }).click();
    await expect(row.getByRole('button', { name: 'Mark inactive' })).toBeVisible();
    await expect(page.getByTestId('audit-log')).toContainText('share.reactivated');
  });

  test('another organisation admin does not see these shares', async ({ page }) => {
    const label = `Acme only ${Date.now()}`;
    await createShareInUi(page, label);
    await page.getByLabel('Signed in as').selectOption({ label: 'Carol, admin at Globex Energy' });
    await expect(page.getByText('Carol Admin · Globex Energy')).toBeVisible();
    await expect(page.getByText(label)).toHaveCount(0);
    await expect(page.getByLabel('Training to share').locator('option')).toHaveText(['Working at Height: Ladders']);
  });

  test('a learner who is not an admin is refused', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Signed in as').selectOption({ label: 'Bob, learner at Acme (not an admin)' });
    await expect(page.getByRole('alert')).toHaveText('Only organisation admins can manage shares');
    await expect(page.getByRole('heading', { name: 'Share a training' })).toHaveCount(0);
  });
});
