import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
  await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/', { timeout: 10000 });
}

test.describe('Remittances', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to remittances list via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Remittances' }).click();
    await expect(page).toHaveURL('/remittances');
    await expect(page.getByRole('heading', { name: /remittances/i })).toBeVisible();
  });

  test('shows manual entry form', async ({ page }) => {
    await page.goto('/remittances/manual');
    await expect(page.getByRole('heading', { name: /record remittance/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /record remittance/i })).toBeDisabled();
  });

  test('shows bulk import page with file upload', async ({ page }) => {
    await page.goto('/remittances/import');
    await expect(page.getByRole('heading', { name: /bulk import remittances/i })).toBeVisible();
    await expect(page.getByText(/upload file/i)).toBeVisible();
  });
});
