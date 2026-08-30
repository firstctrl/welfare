import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
  await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/', { timeout: 10000 });
}

test.describe('Investments', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to investments list via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Investments' }).click();
    await expect(page).toHaveURL('/investments');
    await expect(page.getByRole('heading', { name: /investments/i })).toBeVisible();
  });

  test('shows bulk import page with file upload', async ({ page }) => {
    await page.goto('/investments/import');
    await expect(page.getByRole('heading', { name: /bulk import investments/i })).toBeVisible();
    await expect(page.getByText(/upload file/i)).toBeVisible();
  });
});
