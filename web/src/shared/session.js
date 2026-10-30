/** @typedef {{ username: string, mode: 'demo' }} DemoSession */

const SESSION_KEY = 'astra.demo.session';
const REMEMBERED_KEY = 'astra.demo.identifier';

function fieldError(field, message) {
  return Object.assign(new Error(message), { field });
}

/**
 * 本地交互演示：只保留显示名，不认证账号，也不保存密码。
 * @param {{identifier: string, password: string, remember?: boolean}} credentials
 * @returns {Promise<DemoSession>}
 */
export async function signIn({ identifier = '', password = '', remember = false } = {}) {
  const account = typeof identifier === 'string' ? identifier.trim() : '';
  if (!account) throw fieldError('identifier', '请填写邮箱或用户名。');
  if (typeof password !== 'string' || !password.trim()) throw fieldError('password', '请填写一个演示密码。');

  const username = account.split('@')[0].trim() || account;
  const session = { username, mode: 'demo' };
  try {
    if (remember) localStorage.setItem(REMEMBERED_KEY, account);
    else localStorage.removeItem(REMEMBERED_KEY);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (cause) {
    throw new Error('浏览器无法保存演示状态，请允许本站存储后重试。', { cause });
  }
  return session;
}

/** @returns {DemoSession | null} */
export function getSession() {
  // 无法读取或损坏的本地状态按未登录处理；不能据此显示已认证。
  try {
    const record = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (record?.mode !== 'demo' || typeof record.username !== 'string' || !record.username.trim()) return null;
    return { username: record.username, mode: 'demo' };
  } catch {
    return null;
  }
}

export function getRememberedIdentifier() {
  try { return localStorage.getItem(REMEMBERED_KEY) ?? ''; }
  catch { return ''; }
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
}
