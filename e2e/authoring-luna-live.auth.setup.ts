import { expect, test as setup } from '@playwright/test';
setup('authenticate the isolated Luna QA instructor', async ({ request }) => {
  const api = `http://localhost:${process.env.LUNA_E2E_API_PORT || '8051'}/api/create`;
  const login = await request.post(`${api}/auth/auto-login`, { data: { cwlId: 'luna-e2e-admin' } });
  expect(login.ok(), 'isolated auto-login').toBeTruthy();
  const me = await request.get(`${api}/auth/me`);
  expect((await me.json()).data?.authenticated).toBe(true);
  await request.storageState({ path: 'playwright/.auth/luna-e2e.json' });
});
