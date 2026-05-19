import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
  await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/', { timeout: 10000 });
}

test.describe('Loan recording', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to loans list via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Loans' }).click();
    await expect(page).toHaveURL('/loans');
    await expect(page.getByRole('heading', { name: /loans/i })).toBeVisible();
  });

  test('shows new loan form', async ({ page }) => {
    await page.goto('/loans/new');
    await expect(page.getByText(/record.*loan|new.*loan|loan application/i)).toBeVisible();
  });

  test('shows validation errors when loan form submitted without data', async ({ page }) => {
    await page.goto('/loans/new');
    await page.getByRole('button', { name: /submit|record|create/i }).click();
    await expect(page.getByText(/required|select a staff/i).first()).toBeVisible({
      timeout: 3000,
    });
  });
});
