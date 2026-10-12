import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo@2026';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function openExam(page: Page, courseCode: string) {
  await page.goto('/examinations');
  await page.getByRole('row').filter({ hasText: courseCode }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(courseCode);
}

test.describe.configure({ mode: 'serial' });

test('admin control center shows live metrics and safeguards', async ({ page }) => {
  await signIn(page, 'admin@exam.local');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Examination control center')).toBeVisible();
  await expect(page.getByText('Live examination control')).toBeVisible();
  await expect(page.getByText('Capacity shortage').first()).toBeVisible();
  await expect(page.getByText('Room utilization').first()).toBeVisible();
});

test('admin resolves a capacity shortage, allocates with minimum rooms and publishes', async ({ page }) => {
  await signIn(page, 'admin@exam.local');
  await openExam(page, 'CS302');

  // rooms: add C-301 to clear the 26-vs-24 shortage
  await page.getByRole('tab', { name: /Rooms & in-charges/ }).click();
  await expect(page.getByText('Insufficient capacity')).toBeVisible();
  await page.getByRole('button', { name: /Choose rooms/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('label', { hasText: 'C-301' }).click();
  await dialog.getByRole('button', { name: 'Save rooms' }).click();
  await expect(page.getByText('Rooms updated')).toBeVisible();
  await expect(page.getByText('Insufficient capacity')).toHaveCount(0);

  // allocation: preview with the minimum-rooms objective, then confirm
  await page.getByRole('tab', { name: /Seating allocation/ }).click();
  await page.getByRole('button', { name: /Minimum rooms/ }).click();
  await page.getByRole('button', { name: /Generate preview/ }).click();
  await expect(page.getByText('Optimal room count')).toBeVisible();
  await expect(page.getByText(/Smallest single room that seats all 26/)).toBeVisible();
  await page.getByRole('button', { name: /Confirm allocation/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save allocation' }).click();
  await expect(page.getByText('Seating allocation saved as draft')).toBeVisible();
  await expect(page.getByText('Draft seating (not visible to students)')).toBeVisible();

  // in-charge for the occupied room, then publish through the checklist
  await page.getByRole('tab', { name: /Rooms & in-charges/ }).click();
  await page.getByLabel('In-charge for C-301').selectOption({ label: 'Mr. Sanjay Verma' });
  await expect(page.getByText('In-charge assigned')).toBeVisible();
  await page.getByRole('button', { name: /Publish seating/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Seating published to students')).toBeVisible();
  await expect(page.getByText('Published').first()).toBeVisible();
});

test('student sees the newly published seat and nothing unpublished', async ({ page }) => {
  await signIn(page, '23cse001@student.exam.local');
  await expect(page).toHaveURL(/\/my/);
  const card = page.locator('div').filter({ hasText: 'CS302 · Operating Systems' }).filter({ hasText: 'Room C-301' }).last();
  await expect(card).toBeVisible();
  await expect(page.getByText('MA301')).toHaveCount(0); // allocation still a draft
});

test('in-charge completes attendance; finalized records persist after refresh', async ({ page }) => {
  await signIn(page, 'arjun.mehta@exam.local');
  await expect(page).toHaveURL(/\/duties/);
  await page.getByRole('row').filter({ hasText: 'CS301' }).filter({ hasText: 'B-202' }).getByRole('link', { name: /Mark/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Room B-202');

  // submission is refused while students are unmarked
  await page.getByRole('button', { name: /Submit & finalize/ }).click();
  await expect(page.getByRole('dialog')).toContainText('still unmarked');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Submit & finalize' })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: /Mark remaining 4 present/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark present' }).click();
  await expect(page.getByText('10/10 marked')).toBeVisible();

  await page.getByRole('button', { name: /Submit & finalize/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit & finalize' }).click();
  await expect(page.getByText('Attendance finalized and locked')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Attendance finalized and locked')).toBeVisible();
  await expect(page.getByText('10/10 marked')).toBeVisible();
  await expect(page.getByRole('button', { name: /Present/ }).first()).toBeDisabled();
});

test('in-charge cannot reach admin pages or another in-charge’s room', async ({ page, request }) => {
  await signIn(page, 'arjun.mehta@exam.local');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/duties/);

  // find Priya's room id via the admin API in a separate session, then try to open it as Arjun
  const login = await request.post('/api/auth/login', {
    headers: { 'X-Requested-With': 'exam-app' },
    data: { email: 'admin@exam.local', password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const exams = await (await request.get('/api/exams?q=CS301')).json();
  const detail = await (await request.get(`/api/exams/${exams.items[0].id}`)).json();
  const a101 = detail.rooms.find((r: { roomNo: string }) => r.roomNo === 'A-101');
  await page.goto(`/attendance/${exams.items[0].id}/${a101.id}`);
  await expect(page.getByText('You are not assigned to this examination room.')).toBeVisible();
});
