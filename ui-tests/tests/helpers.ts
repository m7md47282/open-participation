import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ADMIN_ACME = 'demo-admin-acme';

/** Creates a share through the admin UI and returns the one-time share URL. */
export async function createShareInUi(page: Page, label: string, training = 'Fire Safety Basics'): Promise<string> {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Share a training' })).toBeVisible();
  await page.getByLabel('Training to share').selectOption({ label: training });
  await page.getByLabel('Label').fill(label);
  await page.getByRole('button', { name: 'Create share' }).click();
  const url = await page.getByTestId('share-url').textContent();
  expect(url).toMatch(/\/play#[A-Za-z0-9_-]{43}$/);
  return url!.trim();
}

/** Creates a share through the API (faster, for tests that only exercise the visitor side). */
export async function createShareViaApi(request: APIRequestContext, label: string, contentId = 'c_fire_safety') {
  const res = await request.post('/api/admin/shares', {
    headers: { authorization: `Bearer ${ADMIN_ACME}` },
    data: { contentId, label },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { shareUrl: body.shareUrl as string, shareId: body.share.id as string };
}

export async function setShareStatus(request: APIRequestContext, shareId: string, status: 'active' | 'inactive') {
  const res = await request.patch(`/api/admin/shares/${shareId}`, {
    headers: { authorization: `Bearer ${ADMIN_ACME}` },
    data: { status },
  });
  expect(res.status()).toBe(200);
}

/** Path plus fragment, so the test hits the server under test whatever host is in the link. */
export function localPath(shareUrl: string): string {
  const url = new URL(shareUrl);
  return url.pathname + url.hash;
}

export function shareRow(page: Page, label: string) {
  return page.getByRole('row').filter({ hasText: label });
}
