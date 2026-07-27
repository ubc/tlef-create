import { expect, test as setup } from '@playwright/test';

const authFile = 'playwright/.auth/admin.json';

setup('authenticate isolated E2E admin', async ({ request }) => {
  const loginResponse = await request.post('http://localhost:8051/api/create/auth/auto-login', {
    data: { cwlId: 'e2e-admin' }
  });
  expect(loginResponse.ok()).toBeTruthy();

  const meResponse = await request.get('http://localhost:8051/api/create/auth/me');
  expect(meResponse.ok()).toBeTruthy();
  const body = await meResponse.json();
  expect(body.data?.authenticated).toBe(true);
  expect(body.data?.user?.cwlId).toBe('e2e-admin');

  await request.storageState({ path: authFile });
});
