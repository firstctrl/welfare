import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
  await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/', { timeout: 10000 });
}

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to reports via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL('/reports');
    await expect(page.getByRole('heading', { name: /^reports$/i })).toBeVisible();
  });

  test('defaults to the Fund Summary section', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('button', { name: 'Fund Summary' })).toHaveClass(/bg-primary-600/);
  });

  test('switches to the Arrears section', async ({ page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Arrears' }).click();
    await expect(page.getByRole('button', { name: 'Arrears' })).toHaveClass(/bg-primary-600/);
  });

  test('switches to the Overdue Loans section', async ({ page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Overdue Loans' }).click();
    await expect(page.getByRole('button', { name: 'Overdue Loans' })).toHaveClass(/bg-primary-600/);
  });
});
