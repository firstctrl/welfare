import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
  await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/', { timeout: 10000 });
}

test.describe('Contribution import happy path', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to contributions via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Contributions' }).click();
    await expect(page).toHaveURL('/contributions');
  });

  test('shows import page with file upload', async ({ page }) => {
    await page.goto('/contributions/import');
    await expect(page.getByText(/import|upload/i)).toBeVisible();
  });

  test('shows manual entry form', async ({ page }) => {
    await page.goto('/contributions/manual');
    await expect(page.getByText(/manual|amount/i)).toBeVisible();
  });
});
