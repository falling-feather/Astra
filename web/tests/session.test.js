import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSession, getRememberedIdentifier, signIn, signOut } from '../src/shared/session.js';

const originals = new Map();
function storage() {
  const items = new Map();
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
    get entries() { return [...items]; },
  };
}

beforeEach(() => {
  for (const key of ['localStorage', 'sessionStorage']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: storage() });
  }
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test('演示登录跨页面保留用户名，密码不会进入任何存储', async () => {
  const session = await signIn({ identifier: '  小星  ', password: 'private-test-value', remember: true });
  assert.deepEqual(session, { username: '小星', mode: 'demo' });
  assert.deepEqual(getSession(), session);
  assert.equal(getRememberedIdentifier(), '小星');
  const saved = JSON.stringify([...localStorage.entries, ...sessionStorage.entries]);
  assert.equal(saved.includes('private-test-value'), false);
  assert.equal(saved.includes('password'), false);
});

test('邮箱用于预填，欢迎文字只显示邮箱名称', async () => {
  await signIn({ identifier: 'astra@example.test', password: 'x', remember: true });
  assert.equal(getSession().username, 'astra');
  assert.equal(getRememberedIdentifier(), 'astra@example.test');
});

test('空账号或空密码返回可定位的错误，不创建会话', async () => {
  await assert.rejects(signIn({ identifier: '  ', password: 'x' }), error => error.field === 'identifier');
  await assert.rejects(signIn({ identifier: '星序', password: '  ' }), error => error.field === 'password');
  assert.equal(getSession(), null);
  assert.equal(sessionStorage.entries.length, 0);
});

test('取消记住账号会清除此前的预填，退出只清除星序会话', async () => {
  localStorage.setItem('unrelated', 'retain');
  sessionStorage.setItem('unrelated', 'retain');
  await signIn({ identifier: '旧账号', password: 'x', remember: true });
  await signIn({ identifier: '新账号', password: 'x', remember: false });
  assert.equal(getRememberedIdentifier(), '');
  signOut();
  signOut();
  assert.equal(getSession(), null);
  assert.equal(localStorage.getItem('unrelated'), 'retain');
  assert.equal(sessionStorage.getItem('unrelated'), 'retain');
});

test('退出后可预填记住的账号，不能恢复已退出的会话', async () => {
  await signIn({ identifier: '旅人', password: 'x', remember: true });
  signOut();
  assert.equal(getSession(), null);
  assert.equal(getRememberedIdentifier(), '旅人');
});

test('损坏或不同来源的存储记录不能被当作有效演示登录', async () => {
  await signIn({ identifier: '旅人', password: 'x' });
  const [[key]] = sessionStorage.entries;
  for (const record of ['{broken', 'null', '{"username":{},"mode":"demo"}', '{"username":"","mode":"demo"}', '{"username":"旅人","mode":"real"}']) {
    sessionStorage.setItem(key, record);
    assert.equal(getSession(), null);
  }
});

test('浏览器禁止保存状态时，不虚报登录成功', async () => {
  sessionStorage.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  await assert.rejects(signIn({ identifier: '旅人', password: 'x' }), /无法保存演示状态/);
  assert.equal(getSession(), null);
});
