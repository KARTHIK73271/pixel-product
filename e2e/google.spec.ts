import { expect, test, type Page } from '@playwright/test';

/**
 * Google sign-in, end to end in a real browser: login page → (fake) Google account chooser →
 * /api/auth/google/callback → role dashboard. The E2E server runs a local stand-in for Google's
 * OAuth endpoints; everything on our side (state cookie, PKCE, token exchange, RS256 ID-token
 * verification, account matching, session) is the production code path.
 */
async function signInWithGoogle(page: Page, email: string) {
  await page.goto('/login');
  const button = page.getByRole('button', { name: 'Continue with Google' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible();
  await page.locator(`a[data-account="${email}"]`).click();
}

test.describe.configure({ mode: 'serial' });

test('admin signs in with Google, lands on the control center, and signs out', async ({ page }) => {
  await signInWithGoogle(page, 'admin@exam.local');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Examination control center')).toBeVisible();

  await page.reload(); // session persists across reloads
  await expect(page.getByText('Examination control center')).toBeVisible();

  await page.goto('/login'); // already authenticated → straight back to the dashboard
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'Profile menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('in-charge signs in with Google and cannot open admin pages', async ({ page }) => {
  await signInWithGoogle(page, 'priya.raman@exam.local');
  await expect(page).toHaveURL(/\/duties$/);
  await expect(page.getByText('Welcome, Dr. Priya Raman')).toBeVisible();
  await page.goto('/examinations');
  await expect(page).toHaveURL(/\/duties$/);
  const res = await page.request.get('/api/dashboard/admin');
  expect(res.status()).toBe(403); // enforced by the API, not just the router
});

test('student signs in with Google and sees only their own portal', async ({ page }) => {
  await signInWithGoogle(page, '23cse001@student.exam.local');
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByRole('heading', { name: 'Aarav Sharma' })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/my$/);
  expect((await page.request.get('/api/students')).status()).toBe(403);
});

test('an unregistered Google account is refused with a clear message', async ({ page }) => {
  await signInWithGoogle(page, 'stranger@gmail.com');
  await expect(page).toHaveURL(/\/login$/); // the error code is read, then removed from the URL
  await expect(page.getByText('Account not registered')).toBeVisible();
  await expect(page.getByText(/stranger@gmail\.com is not registered/)).toBeVisible();
  expect((await page.request.get('/api/auth/me')).ok()).toBeTruthy();
  expect((await (await page.request.get('/api/auth/me')).json()).user).toBeNull();
});

test('cancelling at Google returns to the login page with a notice', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.locator('#cancel').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Google sign-in cancelled')).toBeVisible();
});

test('an expired session sends the user back to sign in with an explanation', async ({ page, context }) => {
  await signInWithGoogle(page, 'admin@exam.local');
  await expect(page).toHaveURL(/\/dashboard$/);
  await context.clearCookies(); // simulate the server-side session expiring
  // any API call now gets 401 — trigger one deterministically (the app may already have noticed)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Session expired')).toBeVisible();
});
