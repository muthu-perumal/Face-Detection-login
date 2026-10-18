import { expect, test } from '@playwright/test';

test('login and registration fit the screen', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  for (const label of ['Full name', 'Employee ID', 'Email', 'Department', 'Designation', 'Password', 'Confirm password']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
});

test('mobile login does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('camera denial is explained and the stream can be stopped', async ({ page }) => {
  let stopped = false;
  await page.addInitScript(() => {
    const tracks = [{ kind: 'video', stop: () => { (window as unknown as { __stopped: boolean }).__stopped = true; } }];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        async enumerateDevices() { return [{ kind: 'videoinput', deviceId: 'cam', label: 'FaceTime' }]; },
        async getUserMedia() {
          return { getTracks: () => tracks };
        },
      },
    });
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@attendance.local');
  await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/');
  await page.getByRole('link', { name: 'Profile' }).click();
  await page.getByRole('link', { name: 'Manage face enrollment' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /enroll/i }).click();
  await page.getByRole('button', { name: 'Close camera' }).click();
  stopped = await page.evaluate(() => Boolean((window as unknown as { __stopped?: boolean }).__stopped));
  expect(stopped).toBe(true);
});
