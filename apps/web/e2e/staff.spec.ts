import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(process.env.TEST_USERNAME || 'admin');
  await page.getByLabel(/password/i).fill(process.env.TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/', { timeout: 10000 });
}

test.describe('Staff management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to staff list via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Staff' }).click();
    await expect(page).toHaveURL('/staff');
    await expect(page.getByRole('heading', { name: /staff/i })).toBeVisible();
  });

  test('opens add staff modal', async ({ page }) => {
    await page.goto('/staff');
    await page.getByRole('button', { name: /\+ add staff/i }).click();
    await expect(page.getByText('Add Staff Member')).toBeVisible();
  });

  test('shows Zod validation errors when form submitted empty', async ({ page }) => {
    await page.goto('/staff');
    await page.getByRole('button', { name: /\+ add staff/i }).click();
    await page.getByRole('button', { name: /^add staff$/i }).click();
    await expect(page.getByText('Required').first()).toBeVisible({ timeout: 3000 });
  });
});
