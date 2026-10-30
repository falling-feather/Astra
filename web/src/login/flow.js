/** Owns the form's asynchronous state; authentication remains in shared/session.js. */
export class LoginFlow {
  constructor({ authenticate, onChange = () => {}, onSuccess = () => {} }) {
    this.authenticate = authenticate;
    this.onChange = onChange;
    this.onSuccess = onSuccess;
    this.state = { status: 'idle', message: '', field: null };
  }

  update(status, message = '', field = null) {
    this.state = { status, message, field };
    this.onChange(this.state);
  }

  async submit({ identifier, password, remember = false }) {
    if (this.state.status === 'loading' || this.state.status === 'success') return false;
    identifier = identifier.trim();
    if (!identifier || !password) {
      this.update('error', !identifier ? '请输入邮箱或用户名' : '请输入密码', !identifier ? 'identifier' : 'password');
      return false;
    }
    this.update('loading', '正在登录…');
    try {
      const session = await this.authenticate({ identifier, password, remember: Boolean(remember) });
      this.update('success', '登录成功，正在进入星序…');
      this.onSuccess(session);
      return true;
    } catch (error) {
      const field = ['identifier', 'password'].includes(error?.field) ? error.field : null;
      this.update('error', error instanceof Error ? error.message : '登录失败，请重试', field);
      return false;
    }
  }
}
