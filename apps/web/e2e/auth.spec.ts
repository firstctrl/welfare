import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test('redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('wronguser');
    await page.getByLabel(/password/i).fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(
      page.getByText(/invalid credentials|unauthori|incorrect/i),
    ).toBeVisible({ timeout: 6000 });
  });

  test('redirects to dashboard on valid login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
    await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/', { timeout: 10000 });
  });
});
