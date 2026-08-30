import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
  await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/', { timeout: 10000 });
}

test.describe('Welfare claims', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to claims list via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Claims' }).click();
    await expect(page).toHaveURL('/claims');
    await expect(page.getByRole('heading', { name: /welfare claims/i })).toBeVisible();
  });

  test('shows new claim form', async ({ page }) => {
    await page.goto('/claims/new');
    await expect(page.getByRole('heading', { name: /new welfare claim/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /submit claim/i })).toBeVisible();
  });

  test('shows validation errors when claim form submitted without data', async ({ page }) => {
    await page.goto('/claims/new');
    await page.getByRole('button', { name: /submit claim/i }).click();
    await expect(page.getByText(/required/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('shows legacy claims import page', async ({ page }) => {
    await page.goto('/claims/import');
    await expect(page.getByRole('heading', { name: /legacy claims import/i })).toBeVisible();
    await expect(page.getByText(/upload excel file/i)).toBeVisible();
  });
});
