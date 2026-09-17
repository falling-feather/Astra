const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

class Element {
  constructor() {
    this.children = [];
    this.nodes = new Map();
    this.listeners = new Map();
    this.value = '';
  }
  appendChild(node) { this.children.push(node); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  focus() {}
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
}

async function testConfigurationGate({ enabled, status = 200 }) {
  const body = new Element();
  const requests = [];
  const context = {
    window: { location: { hash: '#physics/pendulum' } },
    document: { body, readyState: 'complete', title: '摆的运动', createElement: () => new Element(), addEventListener() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      assert.ok(['/api/ai-tutor/config', '/api/ai-tutor/chat'].includes(url), 'the tutor must use only its same-origin API');
      return { ok: status === 200, status, json: async () => url.endsWith('/config')
        ? { enabled, provider: 'deepseek', model: enabled ? 'deepseek-chat' : null }
        : { answer: '先观察周期随长度的变化。', provider: 'deepseek', model: 'deepseek-chat' } };
    },
  };
  vm.runInNewContext(read('shared/js/product-capabilities.js'), context);
  assert.equal(context.window.AstraProductCapabilities.get('ai-tutor').status, 'partial',
    'the advertised capability must remain conditional on school configuration and login');
  vm.runInNewContext(read('shared/js/ai-tutor.js'), context);
  assert.equal(requests.length, 0, 'mounting the entry must not contact the tutor service');
  context.window.AstraAiTutor.open();
  await new Promise(setImmediate);
  assert.equal(requests.length, 1, 'opening the tutor must first inspect configuration');
  assert.equal(requests[0].options.credentials, 'same-origin');
  const panel = body.children.find((element) => element.className === 'ai-tutor-panel');
  panel.querySelector('.ai-tutor-panel__input').value = '如何比较两次摆动？';
  await panel.querySelector('form').listeners.get('submit')({ preventDefault() {} });
  if (!enabled || status !== 200) {
    assert.equal(requests.length, 1, 'disabled or unauthenticated configuration must block chat requests');
  } else {
    assert.equal(requests.length, 2, 'enabled tutor must send the learner question to the backend');
    assert.equal(requests[1].options.method, 'POST');
    assert.equal(requests[1].options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      message: '如何比较两次摆动？', context: { space: 'englab', route: '#physics/pendulum', page_title: '摆的运动' },
    });
    assert.ok(panel.querySelector('.ai-tutor-panel__messages').children.some((node) => node.textContent === '先观察周期随长度的变化。'));
  }
}

(async () => {
  await testConfigurationGate({ enabled: false });
  await testConfigurationGate({ enabled: false, status: 401 });
  await testConfigurationGate({ enabled: true });
  console.log('ai-tutor-capability-contract: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
