import { expect, test, type Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce', video: 'off', trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true } });

async function login(page: Page, role: 'student' | 'teacher') {
  const response = await page.request.get('/api/auth/demo-accounts');
  expect(response.ok()).toBeTruthy();
  const { accounts } = await response.json();
  const account = accounts.find((item: { role: string }) => item.role === role);
  expect(account).toBeTruthy();
  await page.goto(`/login?role=${role}`);
  await page.getByRole('dialog', { name: role === 'student' ? '学生登录档案' : '教师登录档案' }).waitFor();
  await page.getByRole('textbox', { name: '账号', exact: true }).fill(account.username);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  const signedIn = page.waitForResponse(result => result.request().method() === 'POST' && result.url().endsWith('/api/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page.getByRole('navigation', { name: role === 'student' ? '学生端页面' : '教师端页面' })).toBeVisible();
  const restored = await page.request.get('/api/auth/session');
  expect(restored.status()).toBe(200);
  expect((await restored.json()).profileId).toBe(account.profileId);
}

test('旧 URL 身份参数不能绕过显式登录', async ({ page }) => {
  const issued: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/auth\/(?:login|demo-session)$/u.test(request.url())) issued.push(request.url());
  });
  await page.goto('/?view=student&section=communications&mode=course_platform&profileId=student-team-a&sessionId=demo-local-tourism');
  await expect(page.getByRole('button', { name: '学生登录', exact: true })).toBeVisible();
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  expect(issued).toEqual([]);
  await expect(page.getByRole('navigation', { name: '学生端页面' })).toHaveCount(0);
});

test('学生从登录档案进入课程目录并通过 Cookie 恢复身份', async ({ page }, info) => {
  // A fresh PGlite content store is opened lazily by the first catalogue request.
  // Wait for that real response before asserting the rendered scene, rather than
  // treating cold-store preparation as a 15-second DOM animation deadline.
  const catalogResponse = page.waitForResponse(response => response.url().endsWith('/api/v3/course-archive'), { timeout: 60_000 });
  await login(page, 'student');
  expect((await catalogResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/student\/courses\?/u);
  await expect(page.getByRole('button', { name: '我的课程', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.v3-archive')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '展开课程', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看档案：蟳埔 · 社区深度采访', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('student-courses.png') });
  await page.reload();
  await expect(page.getByRole('navigation', { name: '学生端页面' })).toBeVisible();
});

test('教师显式登录后读取班级和学生档案', async ({ page }, info) => {
  await login(page, 'teacher');
  await expect(page).toHaveURL(/\/teacher\/classes\?/u);
  const classes = page.getByRole('combobox', { name: '选择班级' });
  await expect(classes).toBeEnabled();
  await expect(classes.locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: '展开档案', exact: true }).click();
  const directory = page.getByRole('navigation', { name: '学生档案目录' });
  await expect(directory.getByRole('button')).toHaveCount(10);
  await page.screenshot({ path: info.outputPath('teacher-class.png') });
  await page.reload();
  await expect(page.getByRole('navigation', { name: '教师端页面' })).toBeVisible();
});
