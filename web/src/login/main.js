import { signIn, getRememberedIdentifier } from '../shared/session.js';
import { LoginFlow } from './flow.js';
import { MotionLoop } from './motion.js';
import { CelestialScene } from './scene.js';
import { createStarTrail } from '../shared/star-trail.js';

const form = document.querySelector('#login-form');
const identifier = document.querySelector('#identifier');
const password = document.querySelector('#password');
const remember = document.querySelector('#remember');
const submit = document.querySelector('#sign-in');
const submitLabel = document.querySelector('#sign-in-label');
const status = document.querySelector('#form-status');
const togglePassword = document.querySelector('#toggle-password');
const fields = { identifier, password };

const flow = new LoginFlow({
  authenticate: signIn,
  onChange(state) {
    form.dataset.state = state.status;
    const busy = state.status === 'loading' || state.status === 'success';
    form.setAttribute('aria-busy', String(busy));
    submit.disabled = busy;
    identifier.readOnly = busy;
    password.readOnly = busy;
    remember.disabled = busy;
    togglePassword.disabled = busy;
    submitLabel.textContent = state.status === 'loading' ? '登录中…' : state.status === 'success' ? '登录成功' : '登录';
    status.textContent = state.message;
    status.hidden = !state.message || Boolean(state.field);
    Object.entries(fields).forEach(([name, input]) => {
      const invalid = state.field === name;
      input.setAttribute('aria-invalid', String(invalid));
      const message = document.querySelector(`#${name}-error`);
      message.textContent = invalid ? state.message : '';
      message.hidden = !invalid;
    });
    if (state.field) fields[state.field].focus();
  },
  onSuccess() {
    password.value = '';
    location.assign('./observatory.html');
  },
});

const remembered = getRememberedIdentifier();
identifier.value = remembered;
remember.checked = Boolean(remembered);

form.addEventListener('submit', event => {
  event.preventDefault();
  flow.submit({ identifier: identifier.value, password: password.value, remember: remember.checked });
});
Object.values(fields).forEach(input => input.addEventListener('input', () => {
  if (flow.state.status === 'error') flow.update('idle');
}));
togglePassword.addEventListener('click', () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  togglePassword.setAttribute('aria-pressed', String(visible));
  togglePassword.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
});

const dialog = document.querySelector('#account-dialog');
const dialogTitle = document.querySelector('#account-dialog-title');
const dialogCopy = document.querySelector('#account-dialog-copy');
const dialogDetail = document.querySelector('#dialog-detail');
const dialogAction = document.querySelector('#dialog-action');
function openAccountDialog(mode) {
  dialogTitle.textContent = mode === 'register' ? '体验星序' : '本地演示无需找回密码';
  dialogCopy.textContent = mode === 'register'
    ? '当前为本地交互演示，无需创建服务端账号。填写任意非空账号和密码，即可进入星序。'
    : '这里没有服务端账号，也不会发送找回邮件。重新输入任意非空账号和密码，即可继续体验。';
  dialogDetail.replaceChildren();
  const credentials = document.createElement('div');
  credentials.className = 'demo-credential';
  const account = document.createElement('strong');
  account.textContent = '演示账号：Astra';
  const pass = document.createElement('span');
  pass.textContent = '演示密码：explore';
  credentials.append(account, pass);
  dialogDetail.append(credentials);
  dialogAction.textContent = '填写演示账号';
  dialog.showModal();
}
document.querySelector('#register').addEventListener('click', () => openAccountDialog('register'));
document.querySelector('#forgot-password').addEventListener('click', () => openAccountDialog('forgot'));
dialogAction.addEventListener('click', () => {
  identifier.value = 'Astra';
  password.value = 'explore';
  flow.update('idle');
  dialog.close();
  submit.focus();
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const starTrail = createStarTrail({ paused: reducedMotion.matches });
const pauseButton = document.querySelector('#motion-toggle');
const pauseLabel = document.querySelector('#motion-label');
let userPaused = false;
let sceneFailed = false;
let scene, loop;

function updateMotion() {
  const paused = userPaused || reducedMotion.matches || sceneFailed;
  starTrail.setPaused(paused);
  loop?.setPaused(paused);
  pauseButton.disabled = reducedMotion.matches || sceneFailed;
  pauseButton.setAttribute('aria-pressed', String(paused));
  const label = sceneFailed ? '动效不可用' : reducedMotion.matches ? '已减少动效' : paused ? '继续动效' : '暂停动效';
  pauseButton.setAttribute('aria-label', label);
  pauseLabel.textContent = label;
  document.body.dataset.motionPaused = String(paused);
}
pauseButton.addEventListener('click', () => { userPaused = !userPaused; updateMotion(); });
reducedMotion.addEventListener('change', updateMotion);

function sceneError(message, error) {
  sceneFailed = true;
  updateMotion();
  if (error) console.error('[Astra login] Scene failure:', error);
  const notice = document.querySelector('#scene-notice');
  notice.textContent = message;
  notice.hidden = false;
}

async function startScene() {
  updateMotion();
  try {
    scene = new CelestialScene(document.querySelector('#celestial-scene'));
    await scene.load();
    loop = new MotionLoop({ render: time => scene.render(time) });
    loop.setHidden(document.hidden);
    updateMotion();
    loop.draw();
    loop.start();
    document.body.dataset.sceneReady = 'true';
    const resize = () => { scene.resize(); loop.draw(); };
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      scene.setPointer(event.clientX / innerWidth * 2 - 1, event.clientY / innerHeight * 2 - 1);
    }, { passive: true });
    document.addEventListener('pointerleave', () => scene.setPointer(0, 0));
    document.addEventListener('visibilitychange', () => loop.setHidden(document.hidden));
    scene.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); loop.setPaused(true);
      sceneError('三维场景已暂停，请刷新恢复。登录表单仍可使用。');
    });
    window.addEventListener('pagehide', event => {
      loop.setHidden(true);
      if (!event.persisted) { loop.dispose(); scene.dispose(); window.removeEventListener('resize', resize); }
    });
    window.addEventListener('pageshow', event => { if (event.persisted) { loop.setHidden(document.hidden); loop.draw(); } });
    Object.defineProperty(window, '__ASTRA_LOGIN__', { value: Object.freeze({ get state() {
      return { time: loop.time, paused: loop.paused, hidden: loop.hidden, form: flow.state.status, ...scene.diagnostics };
    } }) });
  } catch (error) {
    loop?.dispose();
    scene?.dispose();
    sceneError('三维场景未能加载，登录表单仍可使用。', error);
  }
}
startScene();
