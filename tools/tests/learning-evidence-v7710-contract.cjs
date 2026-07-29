const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const activitySource = read('shared/js/learning-evidence-activity.js');
const clientSource = read('shared/js/learning-evidence-client.js');
const queueSource = read('shared/js/learning-evidence-queue.js');
const fabSource = read('shared/js/fab-trigger.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function settle(rounds = 24) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function createControlledTimers() {
  let timerId = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    clear() {
      timers.clear();
    },
    pendingCount() {
      return timers.size;
    },
    runNext() {
      const entry = timers.entries().next();
      assert.equal(entry.done, false, 'a controlled timer must be pending');
      const [id, timer] = entry.value;
      timers.delete(id);
      return Promise.resolve().then(() => timer.callback());
    },
  };
}

function createControlledBroadcastBus() {
  const channels = new Set();
  const pending = [];

  class TestBroadcastChannel {
    constructor(name) {
      this.name = String(name);
      this.closed = false;
      this.listeners = new Set();
      channels.add(this);
    }

    addEventListener(type, listener) {
      if (type === 'message' && typeof listener === 'function') this.listeners.add(listener);
    }

    postMessage(data) {
      const snapshot = JSON.parse(JSON.stringify(data));
      channels.forEach((peer) => {
        if (peer !== this && !peer.closed && peer.name === this.name) {
          pending.push(() => {
            if (!peer.closed) peer.listeners.forEach((listener) => listener({ data: snapshot }));
          });
        }
      });
    }

    close() {
      this.closed = true;
      this.listeners.clear();
      channels.delete(this);
    }
  }

  return {
    BroadcastChannel: TestBroadcastChannel,
    pendingCount() { return pending.length; },
    deliverNext() {
      const delivery = pending.shift();
      if (delivery) delivery();
      return Boolean(delivery);
    },
  };
}

function dataProperty(name) {
  return name.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

class MiniClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  set(value) {
    this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this.owner._notifyAttribute('class');
  }

  add(...names) {
    let changed = false;
    names.forEach((name) => {
      if (!this.values.has(name)) {
        this.values.add(name);
        changed = true;
      }
    });
    if (changed) this.owner._notifyAttribute('class');
  }

  remove(...names) {
    let changed = false;
    names.forEach((name) => {
      if (this.values.delete(name)) changed = true;
    });
    if (changed) this.owner._notifyAttribute('class');
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name);
    else this.remove(name);
    return enabled;
  }

  toString() {
    return Array.from(this.values).join(' ');
  }
}

class MiniElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new MiniClassList(this);
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.isConnected = true;
    this.value = '';
    this._innerHTML = '';
    this._textContent = '';
  }

  get className() {
    return this.classList.toString();
  }

  set className(value) {
    this.classList.set(value);
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get textContent() {
    return this.children.length
      ? this.children.map((child) => child.textContent).join('')
      : this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value == null ? '' : value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.children = [];
    if (this.dataset.learningEvidenceActivity) this._buildEvidencePanel();
    if (this._innerHTML.includes('fab-trigger-badge')) {
      const badge = new MiniElement('span', this.ownerDocument);
      badge.className = 'fab-trigger-badge';
      this.appendChild(badge);
    }
  }

  get offsetWidth() {
    return 44;
  }

  _buildEvidencePanel() {
    const create = (tag, attribute, value) => {
      const element = new MiniElement(tag, this.ownerDocument);
      element.setAttribute(attribute, value === undefined ? '' : value);
      return element;
    };
    const scope = create('div', 'data-evidence-scope');
    const status = create('div', 'data-evidence-status');
    status.hidden = true;
    const domainStatus = create('div', 'data-evidence-domain-status');
    domainStatus.hidden = true;
    const projection = create('p', 'data-evidence-projection');
    projection.hidden = true;
    const controls = create('div', 'data-evidence-controls');
    controls.hidden = true;
    const prediction = create('select', 'data-evidence-value', 'prediction');
    prediction.value = 'expect-change';
    const predicted = create('button', 'data-evidence-command', 'predicted');
    const explanation = create('select', 'data-evidence-value', 'explanation');
    explanation.value = 'claim-supported';
    const explained = create('button', 'data-evidence-command', 'explained');
    controls.append(prediction, predicted, explanation, explained);
    const freeText = create('textarea', 'data-evidence-free-text');
    const explainedText = create('button', 'data-evidence-command', 'explained-text');
    this.append(scope, status, domainStatus, projection, controls, freeText, explainedText);
  }

  _notifyAttribute(name) {
    if (this.ownerDocument) {
      this.ownerDocument._notifyMutation({
        type: 'attributes',
        target: this,
        attributeName: name,
      });
    }
  }

  setAttribute(name, value) {
    const normalized = String(name);
    const serialized = String(value == null ? '' : value);
    if (normalized === 'class') this.classList.set(serialized);
    else {
      this.attributes.set(normalized, serialized);
      if (normalized.startsWith('data-')) this.dataset[dataProperty(normalized)] = serialized;
      this._notifyAttribute(normalized);
    }
  }

  getAttribute(name) {
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    if (name === 'class') return Boolean(this.className);
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    if (name === 'class') this.classList.set('');
    else {
      this.attributes.delete(name);
      if (name.startsWith('data-')) delete this.dataset[dataProperty(name)];
      this._notifyAttribute(name);
    }
  }

  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    child.isConnected = this.isConnected;
    this.children.push(child);
    if (this.ownerDocument) {
      this.ownerDocument._notifyMutation({
        type: 'childList',
        target: this,
        addedNodes: [child],
        removedNodes: [],
      });
    }
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  prepend(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    child.isConnected = this.isConnected;
    this.children.unshift(child);
    if (this.ownerDocument) {
      this.ownerDocument._notifyMutation({
        type: 'childList',
        target: this,
        addedNodes: [child],
        removedNodes: [],
      });
    }
  }

  replaceChildren(...children) {
    const removedNodes = this.children.slice();
    this.statusMessage = '';
    removedNodes.forEach((child) => {
      child.parentNode = null;
      child.isConnected = false;
    });
    this.children = [];
    children.forEach((child) => this.appendChild(child));
    if (this.ownerDocument && removedNodes.length) {
      this.ownerDocument._notifyMutation({
        type: 'childList',
        target: this,
        addedNodes: [],
        removedNodes,
      });
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    child.isConnected = false;
    if (this.ownerDocument) {
      this.ownerDocument._notifyMutation({
        type: 'childList',
        target: this,
        addedNodes: [],
        removedNodes: [child],
      });
    }
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
    else this.isConnected = false;
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child.contains(target));
  }

  matches(selector) {
    const normalized = String(selector || '').trim();
    if (!normalized) return false;
    if (normalized.includes(',')) return normalized.split(',').some((part) => this.matches(part));
    if (normalized.startsWith('.')) return this.classList.contains(normalized.slice(1));
    if (normalized.startsWith('#')) return this.id === normalized.slice(1);
    const attribute = normalized.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    if (attribute) {
      const [, name, expected] = attribute;
      if (name.startsWith('data-') && Object.hasOwn(this.dataset, dataProperty(name))) {
        return expected === undefined || this.dataset[dataProperty(name)] === expected;
      }
      return this.hasAttribute(name) && (expected === undefined || this.getAttribute(name) === expected);
    }
    return this.tagName.toLowerCase() === normalized.toLowerCase();
  }

  querySelectorAll(selector) {
    const normalized = String(selector || '').trim();
    if (normalized.startsWith(':scope > ')) {
      const childSelector = normalized.slice(9);
      return this.children.filter((child) => child.matches(childSelector));
    }
    const result = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        if (child.matches(normalized)) result.push(child);
        visit(child);
      });
    };
    visit(this);
    return result;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches && current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  addEventListener(type, listener, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ listener, once: Boolean(options && options.once) });
  }

  removeEventListener(type, listener) {
    const values = this.listeners.get(type) || [];
    this.listeners.set(type, values.filter((item) => item.listener !== listener));
  }

  dispatchEvent(event) {
    const actual = event || {};
    if (!actual.type) throw new Error('event type required');
    if (!actual.target) actual.target = this;
    if (!actual.stopPropagation) actual.stopPropagation = () => { actual.propagationStopped = true; };
    if (!actual.preventDefault) actual.preventDefault = () => { actual.defaultPrevented = true; };
    let current = this;
    while (current) {
      const values = (current.listeners.get(actual.type) || []).slice();
      values.forEach((item) => {
        item.listener(actual);
        if (item.once) current.removeEventListener(actual.type, item.listener);
      });
      if (actual.propagationStopped) break;
      current = current.parentNode;
    }
    if (!actual.propagationStopped && this.ownerDocument) {
      this.ownerDocument._dispatch(actual.type, actual);
    }
    return !actual.defaultPrevented;
  }

  click() {
    if (this.disabled || this.inert) return;
    this.focus();
    this.dispatchEvent({ type: 'click', target: this });
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
}

class MiniDocument {
  constructor() {
    this.activeElement = null;
    this.listeners = new Map();
    this.observers = new Set();
    this.body = new MiniElement('body', this);
    this.body.isConnected = true;
  }

  createElement(tagName) {
    return new MiniElement(tagName, this);
  }

  querySelector(selector) {
    return this.body.matches(selector) ? this.body : this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    const result = this.body.querySelectorAll(selector);
    return this.body.matches(selector) ? [this.body, ...result] : result;
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const values = this.listeners.get(type) || [];
    this.listeners.set(type, values.filter((value) => value !== listener));
  }

  _dispatch(type, event) {
    (this.listeners.get(type) || []).slice().forEach((listener) => listener(event));
  }

  _notifyMutation(record) {
    this.observers.forEach((observer) => {
      observer.enqueue(record);
    });
  }

  flushMutations() {
    let delivered = 0;
    for (let round = 0; round < 10; round += 1) {
      let roundDelivered = 0;
      this.observers.forEach((observer) => {
        roundDelivered += observer.flush();
      });
      delivered += roundDelivered;
      if (!roundDelivered) break;
    }
    return delivered;
  }
}

function createMutationObserverClass(document) {
  return class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      this.target = null;
      this.options = null;
      this.records = [];
      document.observers.add(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
      this.disconnected = false;
    }

    disconnect() {
      this.disconnected = true;
      this.target = null;
      this.records = [];
    }

    enqueue(record) {
      if (this.disconnected || !this.options || !this.target) return;
      const withinTarget = record.target === this.target
        || Boolean(this.options.subtree && this.target.contains(record.target));
      if (!withinTarget) return;
      if (record.type === 'childList' && !this.options.childList) return;
      if (record.type === 'attributes') {
        if (!this.options.attributes) return;
        const filter = this.options.attributeFilter;
        if (Array.isArray(filter) && !filter.includes(record.attributeName)) return;
      }
      this.records.push(record);
    }

    flush() {
      if (this.disconnected || !this.records.length) return 0;
      const records = this.records.splice(0);
      this.callback(records);
      return records.length;
    }
  };
}

function createPeerQueueRuntime(bus, namespace) {
  const instrumented = queueSource.replace(
    'global.AstraLearningEvidenceQueue = Object.freeze({',
    [
      'global.__queuePeerTest = Object.freeze({',
      '    eventProjection, emit, receivePeerChange,',
      '    setNamespace(value) { activeNamespace = String(value || ""); }',
      '});',
      'global.AstraLearningEvidenceQueue = Object.freeze({',
    ].join('\n'),
  );
  assert.notEqual(instrumented, queueSource, 'queue peer instrumentation must apply');
  const context = {
    window: null,
    console: { log() {}, warn() {}, error() {} },
    TextEncoder,
    crypto: webcrypto,
    BroadcastChannel: bus.BroadcastChannel,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, {
    filename: 'shared/js/learning-evidence-queue.js',
  });
  context.__queuePeerTest.setNamespace(namespace);
  return context;
}

function confirmed(payload) {
  return {
    outcome: 'confirmed',
    client_event_id: payload.client_event_id,
    event_type: payload.event_type,
    state: 'confirmed',
    receipt: {
      event_id: 100,
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
      outcome: 'accepted',
      received_at: '2026-07-29T08:00:00Z',
    },
  };
}

function createActivityHarness(recordHandler, options = {}) {
  const document = new MiniDocument();
  const statusRenders = [];
  const calls = [];
  const completions = [];
  const warnings = [];
  const listeners = new Set();
  let recoveryCalls = 0;
  let domainCommand = null;
  const contextValue = Object.freeze({
    available: true,
    class_id: 41,
    course_id: 13,
    course_unit_id: 37,
    activity_key: 'physics.mechanics',
  });

  const client = {
    normalizeError(error) {
      return Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: error && error.code || 'learning_evidence_failed',
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async recovery(scope, requestOptions) {
      recoveryCalls += 1;
      if (typeof options.recoveryHandler === 'function') {
        return options.recoveryHandler(scope, recoveryCalls, requestOptions);
      }
      return {
        rule_version: 1,
        activities: [{
          course_unit_id: 37,
          activity_key: 'physics.mechanics',
          rule_version: 1,
          status: 'in_progress',
        }],
      };
    },
    async stateFor() {
      return { state: 'confirmed' };
    },
    async flush() {
      return { outcome: 'empty' };
    },
    async record(payload, options) {
      calls.push({ payload, options });
      emit({
        type: 'syncing',
        state: 'syncing',
        client_event_id: payload.client_event_id,
        event_type: payload.event_type,
        ...payload,
      });
      let result;
      try {
        result = await recordHandler(payload, options, calls);
        if (result && result.state) {
          emit({
            type: result.state === 'confirmed' ? 'confirmed' : result.state,
            state: result.state,
            client_event_id: payload.client_event_id,
            event_type: payload.event_type,
            projection: {
              class_id: payload.class_id,
              course_id: payload.course_id,
              course_unit_id: payload.course_unit_id,
              activity_key: payload.activity_key,
              rule_version: payload.rule_version,
              last_event_type: payload.event_type,
            },
          });
        }
        return result;
      } finally {
        completions.push({ payload, result });
      }
    },
  };

  function emit(change) {
    listeners.forEach((listener) => listener(change));
  }

  const parent = new MiniElement('div', document);
  document.body.appendChild(parent);
  const context = {
    window: null,
    document,
    Element: MiniElement,
    Map: options.Map || Map,
    AbortController,
    crypto: webcrypto,
    console: {
      log() {},
      error() {},
      warn(...values) { warnings.push(values.join(' ')); },
    },
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    AstraLearningEvidenceClient: client,
    AstraLearningActivityCatalog: {
      resolve() {
        return {
          galaxy_key: 'englab',
          activity_key: 'physics.mechanics',
          publication_context: {},
          representative: true,
        };
      },
    },
    AstraLearningEvidenceStatus: {
      render(node, value, options = {}) {
        node.hidden = false;
        node.dataset.evidenceState = value;
        node.statusMessage = options.message || '';
        statusRenders.push({ state: value, message: options.message || '' });
        return true;
      },
    },
    AstraLearningEvidenceLoader: {
      claimDomainCommands(mapping, accept) {
        domainCommand = accept;
        return () => {
          if (domainCommand === accept) domainCommand = null;
        };
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(activitySource, context, {
    filename: 'shared/js/learning-evidence-activity.js',
  });
  const controller = context.AstraLearningEvidenceActivity.mount({
    host: parent,
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    resolveContext: async () => contextValue,
  });
  const host = parent.querySelector('[data-learning-evidence-activity]');
  return {
    context,
    controller,
    host,
    client,
    calls,
    completions,
    warnings,
    statusRenders,
    emit,
    emitDomain(detail, occurredAt = '2026-07-29T08:05:00Z') {
      assert.equal(typeof domainCommand, 'function', 'domain command consumer must be claimed');
      return domainCommand(detail, occurredAt);
    },
    recoveryCalls: () => recoveryCalls,
    predictedButton: host.querySelector('[data-evidence-command="predicted"]'),
    explainedButton: host.querySelector('[data-evidence-command="explained"]'),
    explainedTextButton: host.querySelector('[data-evidence-command="explained-text"]'),
    freeText: host.querySelector('[data-evidence-free-text]'),
    controls: host.querySelector('[data-evidence-controls]'),
    statusNode: host.querySelector('[data-evidence-status]'),
    domainStatusNode: host.querySelector('[data-evidence-domain-status]'),
    projectionNode: host.querySelector('[data-evidence-projection]'),
  };
}

async function createPeerActivityHarness(receiverQueue, predictedGate) {
  const document = new MiniDocument();
  const statusRenders = [];
  const apiCalls = [];
  const clientEvents = [];
  const queueAdapter = {
    async configureIdentity() {},
    async clearAuthority() {},
    subscribe(listener) { return receiverQueue.subscribe(listener); },
    async enqueue() { throw new Error('peer activity must not enqueue locally'); },
    async updateState() { throw new Error('peer activity must not update local queue state'); },
    async remove() {},
    async list() { return []; },
    async stats() { return { count: 0, bytes: 0, oldest_at: null }; },
    async acquireLease() { return true; },
    async renewLease() { return true; },
    async releaseLease() {},
  };
  const parent = new MiniElement('div', document);
  document.body.appendChild(parent);
  const context = {
    window: null,
    document,
    Element: MiniElement,
    TextEncoder,
    AbortController,
    crypto: webcrypto,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
    removeEventListener() {},
    AstraLearningEvidenceQueue: queueAdapter,
    AstraLearningEvidenceLoader: {
      isAuthorityClearPending: () => false,
      claimDomainCommands() { return () => {}; },
    },
    AstraApiClient: {
      isOffline: () => false,
      async request(pathname, options = {}) {
        apiCalls.push({ pathname, options });
        if (pathname.endsWith('/me/recovery')) {
          return {
            class_id: 41,
            course_id: 13,
            subject_user_id: 7,
            rule_version: 1,
            activities: [{
              course_unit_id: 37,
              activity_key: 'physics.mechanics',
              rule_version: 1,
              status: 'in_progress',
              learner_event_count: 1,
              attempt_count: 0,
              reported_correct_attempt_count: 0,
              corrected_count: 0,
              explained_count: 0,
              first_started_at: '2026-07-29T08:00:00Z',
              last_occurred_at: '2026-07-29T08:00:00Z',
              completed_at: null,
              transferred_at: null,
              resume_cursor: {},
            }],
            resume: null,
          };
        }
        if (pathname.endsWith('/events')) {
          const payload = options.body;
          if (payload.event_type === 'started') return confirmed(payload).receipt;
          if (payload.event_type === 'predicted') return predictedGate.promise;
        }
        throw new Error(`unexpected peer activity API path ${pathname}`);
      },
    },
    AstraLearningActivityCatalog: {
      resolve() {
        return {
          galaxy_key: 'englab',
          activity_key: 'physics.mechanics',
          publication_context: {},
          representative: true,
        };
      },
    },
    AstraLearningEvidenceStatus: {
      render(node, value, options = {}) {
        node.hidden = false;
        node.dataset.evidenceState = value;
        node.statusMessage = options.message || '';
        statusRenders.push({ state: value, message: options.message || '' });
        return true;
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context, {
    filename: 'shared/js/learning-evidence-client.js',
  });
  const client = context.AstraLearningEvidenceClient;
  client.subscribe((change) => clientEvents.push(change));
  await client.configureIdentity({ id: 7, role: 'student' });
  vm.runInContext(activitySource, context, {
    filename: 'shared/js/learning-evidence-activity.js',
  });
  const controller = context.AstraLearningEvidenceActivity.mount({
    host: parent,
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    resolveContext: async () => ({
      available: true,
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
    }),
  });
  const host = parent.querySelector('[data-learning-evidence-activity]');
  return {
    context,
    client,
    controller,
    host,
    apiCalls,
    clientEvents,
    statusRenders,
    statusNode: host.querySelector('[data-evidence-status]'),
    predictedButton: host.querySelector('[data-evidence-command="predicted"]'),
    explainedButton: host.querySelector('[data-evidence-command="explained"]'),
    explainedTextButton: host.querySelector('[data-evidence-command="explained-text"]'),
  };
}

async function testActivityClickUsesExactPredictedCommand() {
  const startedGate = deferred();
  const predictedGate = deferred();
  const harness = createActivityHarness((payload) => {
    if (payload.event_type === 'started') return startedGate.promise;
    if (payload.event_type === 'predicted') return predictedGate.promise;
    throw new Error(`unexpected event ${payload.event_type}`);
  });
  await waitFor(() => harness.calls.length === 1, 'delayed started request');
  assert.equal(harness.calls[0].payload.event_type, 'started');
  assert.equal(harness.controls.hidden, true);
  assert.equal(harness.predictedButton.disabled, true);
  harness.predictedButton.click();
  await settle();
  assert.equal(harness.calls.length, 1, 'hidden/disabled prediction must not race started');

  startedGate.resolve(confirmed(harness.calls[0].payload));
  await waitFor(() => harness.predictedButton.disabled === false, 'durable started outcome');
  assert.equal(harness.controls.hidden, false);

  harness.predictedButton.click();
  await waitFor(() => harness.calls.length === 2, 'production predicted DOM click');
  const prediction = harness.calls[1].payload;
  assert.equal(prediction.event_type, 'predicted');
  assert.match(prediction.client_event_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  assert.equal(prediction.evidence.prediction.choice, 'expect-change');
  assert.equal(harness.statusNode.dataset.evidenceState, 'syncing');
  assert.match(harness.statusNode.statusMessage, /本次预测/);
  assert.equal(harness.predictedButton.disabled, true);
  assert.equal(harness.explainedButton.disabled, true);
  assert.equal(harness.explainedTextButton.disabled, true);
  harness.freeText.value = 'pending prediction must serialize commands';
  harness.explainedButton.click();
  harness.explainedTextButton.click();
  await settle();
  assert.equal(harness.calls.length, 2, 'a tracked prediction must serialize all evidence buttons');

  harness.emit({
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: prediction.client_event_id,
    event_type: 'attempted',
    projection: {
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      event_type: 'attempted',
    },
  });
  harness.emit({
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: 'other-predicted-event',
    event_type: 'predicted',
    projection: {
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      event_type: 'predicted',
    },
  });
  harness.emit({
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: prediction.client_event_id,
    event_type: 'predicted',
    projection: {
      class_id: 99,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      event_type: 'predicted',
    },
  });
  assert.equal(harness.statusNode.dataset.evidenceState, 'syncing');
  assert.match(harness.statusNode.statusMessage, /本次预测/);

  predictedGate.resolve(confirmed(prediction));
  await waitFor(
    () => harness.statusNode.dataset.evidenceState === 'confirmed'
      && /本次预测/.test(harness.statusNode.statusMessage),
    'exact predicted receipt status',
  );
  assert.equal(harness.predictedButton.disabled, false);
  assert.equal(harness.explainedButton.disabled, false);
  assert.equal(harness.explainedTextButton.disabled, false);
  harness.controller.destroy();
}

async function testActivityOutcomesAndLeaveAreHonest() {
  for (const scenario of [
    {
      name: 'queued',
      outcome(payload) {
        return {
          outcome: 'queued',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'local-pending',
        };
      },
      expectedState: 'local-pending',
      expectedMessage: /安全保存在本机/,
    },
    {
      name: 'manual',
      outcome(payload) {
        return {
          outcome: 'manual-intervention',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'manual-intervention',
        };
      },
      expectedState: 'manual-intervention',
      expectedMessage: /尚未获得权威确认/,
    },
    {
      name: 'cancelled',
      outcome() {
        return { outcome: 'cancelled', state: '' };
      },
      expectedState: 'manual-intervention',
      expectedMessage: /本次预测未保存/,
    },
  ]) {
    const harness = createActivityHarness((payload) => (
      payload.event_type === 'started' ? confirmed(payload) : scenario.outcome(payload)
    ));
    await waitFor(() => harness.predictedButton.disabled === false, `${scenario.name} ready`);
    harness.predictedButton.click();
    await waitFor(() => harness.calls.length === 2, `${scenario.name} predicted call`);
    await waitFor(
      () => harness.statusNode.dataset.evidenceState === scenario.expectedState
        && harness.predictedButton.disabled === false
        && harness.explainedButton.disabled === false
        && harness.explainedTextButton.disabled === false,
      `${scenario.name} status`,
    );
    assert.match(harness.statusNode.statusMessage || harness.statusNode.textContent, scenario.expectedMessage);
    assert.notEqual(harness.statusNode.dataset.evidenceState, 'confirmed');
    assert.equal(harness.predictedButton.disabled, false, `${scenario.name} prediction restored`);
    assert.equal(harness.explainedButton.disabled, false, `${scenario.name} explanation restored`);
    assert.equal(harness.explainedTextButton.disabled, false, `${scenario.name} free text restored`);
    harness.controller.destroy();
  }

  const leaveGate = deferred();
  const leaveHarness = createActivityHarness((payload) => (
    payload.event_type === 'started' ? confirmed(payload) : leaveGate.promise
  ));
  await waitFor(() => leaveHarness.predictedButton.disabled === false, 'leave case ready');
  leaveHarness.predictedButton.click();
  await waitFor(() => leaveHarness.calls.length === 2, 'leave case predicted call');
  const pendingPayload = leaveHarness.calls[1].payload;
  leaveHarness.controller.destroy();
  assert.equal(leaveHarness.host.isConnected, false);
  leaveGate.resolve({
    outcome: 'queued',
    client_event_id: pendingPayload.client_event_id,
    event_type: pendingPayload.event_type,
    state: 'local-pending',
  });
  await waitFor(
    () => leaveHarness.completions.some((item) => (
      item.payload.client_event_id === pendingPayload.client_event_id
      && item.result
      && item.result.state === 'local-pending'
    )),
    'leave case durable queue result',
  );
}

async function testQueuedCommandAcceptsPeerConfirmation() {
  let predictedPayload = null;
  const harness = createActivityHarness((payload) => {
    if (payload.event_type === 'started') return confirmed(payload);
    predictedPayload = payload;
    return {
      outcome: 'queued',
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
      state: 'local-pending',
    };
  });
  await waitFor(() => harness.predictedButton.disabled === false, 'queued peer ready');
  harness.predictedButton.click();
  await waitFor(
    () => harness.statusNode.dataset.evidenceState === 'local-pending'
      && harness.predictedButton.disabled === false,
    'queued local pending state',
  );
  assert.ok(predictedPayload);
  assert.equal(harness.predictedButton.disabled, false, 'queued terminal releases command lock');
  assert.equal(harness.explainedButton.disabled, false);
  assert.equal(harness.explainedTextButton.disabled, false);

  harness.emit({
    source: 'peer-tab',
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: predictedPayload.client_event_id,
    event_type: predictedPayload.event_type,
    projection: {
      class_id: predictedPayload.class_id,
      course_id: predictedPayload.course_id,
      course_unit_id: predictedPayload.course_unit_id,
      activity_key: predictedPayload.activity_key,
      rule_version: predictedPayload.rule_version,
      event_type: predictedPayload.event_type,
    },
  });
  await waitFor(
    () => harness.statusNode.dataset.evidenceState === 'confirmed'
      && /本次预测/.test(harness.statusNode.statusMessage),
    'queued exact peer confirmation',
  );
  harness.controller.destroy();
}

async function testTrackedPeerConfirmationIsMonotonic() {
  const predictionGate = deferred();
  let predictedPayload = null;
  const harness = createActivityHarness((payload) => {
    if (payload.event_type === 'started') return confirmed(payload);
    predictedPayload = payload;
    return predictionGate.promise;
  });
  await waitFor(() => harness.predictedButton.disabled === false, 'tracked monotonic ready');
  harness.predictedButton.click();
  await waitFor(() => predictedPayload, 'tracked monotonic prediction pending');
  harness.emit({
    source: 'peer-tab',
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: predictedPayload.client_event_id,
    event_type: predictedPayload.event_type,
    projection: {
      class_id: predictedPayload.class_id,
      course_id: predictedPayload.course_id,
      course_unit_id: predictedPayload.course_unit_id,
      activity_key: predictedPayload.activity_key,
      rule_version: predictedPayload.rule_version,
      event_type: predictedPayload.event_type,
    },
  });
  await waitFor(
    () => harness.statusNode.dataset.evidenceState === 'confirmed',
    'tracked exact peer confirmed before local terminal',
  );
  predictionGate.resolve({
    outcome: 'queued',
    client_event_id: predictedPayload.client_event_id,
    event_type: predictedPayload.event_type,
    state: 'local-pending',
  });
  await waitFor(
    () => harness.completions.some((item) => (
      item.payload.client_event_id === predictedPayload.client_event_id
    )) && harness.predictedButton.disabled === false,
    'tracked late local queue terminal',
  );
  assert.equal(harness.statusNode.dataset.evidenceState, 'confirmed');
  assert.match(harness.statusNode.statusMessage, /本次预测/);
  assert.deepEqual(harness.warnings, []);
  harness.controller.destroy();
}

async function testPeerTabQueueChangesKeepExactEventIdentity() {
  const bus = createControlledBroadcastBus();
  const namespace = 'peer-student-7';
  const producer = createPeerQueueRuntime(bus, namespace);
  const receiver = createPeerQueueRuntime(bus, namespace);
  const rawPeerChanges = [];
  receiver.AstraLearningEvidenceQueue.subscribe((change) => rawPeerChanges.push(change));
  const predictedGate = deferred();
  const harness = await createPeerActivityHarness(
    receiver.AstraLearningEvidenceQueue,
    predictedGate,
  );
  await waitFor(() => harness.predictedButton.disabled === false, 'peer activity ready');
  harness.predictedButton.click();
  const predictedCall = () => harness.apiCalls.find((call) => (
    call.pathname.endsWith('/events')
    && call.options.body
    && call.options.body.event_type === 'predicted'
  ));
  await waitFor(predictedCall, 'peer activity predicted request');
  const payload = predictedCall().options.body;
  assert.equal(harness.explainedButton.disabled, true);
  assert.equal(harness.explainedTextButton.disabled, true);

  const steps = [
    { type: 'enqueued', state: 'local-pending', expected: 'local-pending' },
    { type: 'state-changed', state: 'syncing', expected: 'syncing' },
    { type: 'confirmed', state: 'confirmed', expected: 'confirmed' },
  ];
  for (const step of steps) {
    producer.__queuePeerTest.emit({
      type: step.type,
      client_event_id: payload.client_event_id,
      state: step.state,
      projection: producer.__queuePeerTest.eventProjection(payload),
    });
    assert.equal(bus.pendingCount(), 1, `${step.type} must cross the tab channel`);
    bus.deliverNext();
    await settle();
    const raw = rawPeerChanges.at(-1);
    assert.equal(raw.source, 'peer-tab');
    assert.equal(raw.type, step.type);
    assert.equal(raw.client_event_id, payload.client_event_id);
    assert.equal(raw.projection.event_type, 'predicted');
    const mapped = harness.clientEvents.at(-1);
    assert.equal(mapped.client_event_id, payload.client_event_id);
    assert.equal(mapped.event_type, 'predicted');
    assert.equal(mapped.projection.event_type, 'predicted');
    assert.equal(harness.statusNode.dataset.evidenceState, step.expected);
    assert.match(harness.statusNode.statusMessage, /本次预测/);
  }
  assert.ok(harness.clientEvents.some((change) => (
    change.type === 'queue-capacity-released'
    && change.reason === 'confirmed'
    && !change.client_event_id
  )), 'peer queue confirmation must publish a non-identifying capacity release signal');
  assert.equal(
    harness.predictedButton.disabled,
    true,
    'peer confirmation does not end the still in-flight local request lock',
  );
  predictedGate.resolve(confirmed(payload).receipt);
  await waitFor(() => harness.predictedButton.disabled === false, 'peer predicted request terminal');
  assert.equal(harness.statusNode.dataset.evidenceState, 'confirmed');
  assert.match(harness.statusNode.statusMessage, /本次预测/);
  harness.controller.destroy();
  harness.client.destroy();
}

async function testStartedMustBeUsableBeforeControlsOpen() {
  for (const scenario of [
    {
      name: 'manual',
      handler(payload) {
        return {
          outcome: 'manual-intervention',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'manual-intervention',
        };
      },
    },
    {
      name: 'cancelled',
      handler() {
        return { outcome: 'cancelled', state: '' };
      },
    },
    {
      name: 'throw',
      handler() {
        const error = new Error('started transport failed');
        error.code = 'network';
        throw error;
      },
    },
  ]) {
    const harness = createActivityHarness(scenario.handler);
    await waitFor(
      () => harness.completions.length === 1,
      `${scenario.name} started terminal result`,
    );
    assert.equal(harness.calls[0].payload.event_type, 'started');
    assert.equal(harness.controls.hidden, true, `${scenario.name} controls hidden`);
    assert.equal(harness.predictedButton.disabled, true, `${scenario.name} prediction disabled`);
    assert.equal(harness.statusNode.dataset.evidenceState, 'manual-intervention');
    harness.predictedButton.click();
    await settle();
    assert.equal(harness.calls.length, 1, `${scenario.name} cannot submit a prediction`);
    harness.controller.destroy();
  }
}

async function testAuthorityInvalidatesTrackedCommand() {
  const lateOutcomes = [
    {
      name: 'confirmed',
      settle(gate, payload) { gate.resolve(confirmed(payload)); },
    },
    {
      name: 'queued',
      settle(gate, payload) {
        gate.resolve({
          outcome: 'queued',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'local-pending',
        });
      },
    },
    {
      name: 'cancelled',
      settle(gate) { gate.resolve({ outcome: 'cancelled', state: '' }); },
    },
    {
      name: 'throw',
      settle(gate) {
        const error = new Error('late old authority failure');
        error.code = 'network';
        gate.reject(error);
      },
    },
  ];

  for (const scenario of lateOutcomes) {
    const oldPrediction = deferred();
    let predictedPayload = null;
    const harness = createActivityHarness((payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'predicted') {
        predictedPayload = payload;
        return oldPrediction.promise;
      }
      throw new Error(`unexpected event ${payload.event_type}`);
    });
    await waitFor(() => harness.predictedButton.disabled === false, `${scenario.name} initial authority ready`);
    harness.predictedButton.click();
    await waitFor(() => predictedPayload, `${scenario.name} old prediction pending`);
    assert.equal(harness.explainedButton.disabled, true);

    harness.emit({ type: 'authority-cleared' });
    assert.equal(harness.controls.hidden, true);
    assert.equal(harness.predictedButton.disabled, true);
    assert.equal(harness.statusNode.dataset.evidenceState, 'manual-intervention');

    harness.emit({ type: 'identity-configured' });
    await waitFor(
      () => harness.calls.filter((call) => call.payload.event_type === 'started').length === 2
        && harness.predictedButton.disabled === false,
      `${scenario.name} replacement identity started`,
    );
    const replacementStatus = {
      state: harness.statusNode.dataset.evidenceState,
      message: harness.statusNode.statusMessage || harness.statusNode.textContent,
    };
    assert.equal(replacementStatus.state, 'confirmed');

    scenario.settle(oldPrediction, predictedPayload);
    await waitFor(
      () => harness.completions.some((item) => (
        item.payload.client_event_id === predictedPayload.client_event_id
      )),
      `${scenario.name} stale prediction completion`,
    );
    await settle();
    assert.equal(harness.statusNode.dataset.evidenceState, replacementStatus.state);
    assert.equal(
      harness.statusNode.statusMessage || harness.statusNode.textContent,
      replacementStatus.message,
      `${scenario.name} stale result must not overwrite replacement identity`,
    );
    assert.equal(harness.predictedButton.disabled, false);
    assert.equal(harness.explainedButton.disabled, false);
    assert.equal(harness.explainedTextButton.disabled, false);
    assert.deepEqual(
      harness.warnings,
      [],
      `${scenario.name} expected old-authority completion must not warn`,
    );
    harness.controller.destroy();
  }
}

async function testAuthorityInvalidatesUntrackedDomainRecords() {
  for (const scenario of [
    {
      name: 'confirmed',
      settle(gate, payload) {
        gate.resolve(confirmed(payload));
      },
    },
    {
      name: 'queued',
      settle(gate, payload) {
        gate.resolve({
          outcome: 'queued',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'local-pending',
        });
      },
    },
    {
      name: 'cancelled',
      settle(gate) {
        gate.resolve({ outcome: 'cancelled', state: '' });
      },
    },
    {
      name: 'throw',
      settle(gate) {
        const error = new Error('late untracked transport failure');
        error.code = 'network';
        gate.reject(error);
      },
    },
  ]) {
    const oldAttempt = deferred();
    let attemptedPayload = null;
    const harness = createActivityHarness((payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'attempted') {
        attemptedPayload = payload;
        return oldAttempt.promise;
      }
      throw new Error(`unexpected event ${payload.event_type}`);
    });
    await waitFor(
      () => harness.predictedButton.disabled === false,
      `${scenario.name} untracked authority ready`,
    );
    harness.emitDomain({
      galaxy_key: 'englab',
      activity_key: 'physics.mechanics',
      class_id: 41,
      course_id: 13,
      event_type: 'attempted',
      evidence: { operation: 'parameter-change', control: 'gravity-slider' },
    });
    await waitFor(() => attemptedPayload, `${scenario.name} old attempted pending`);

    harness.emit({ type: 'authority-cleared' });
    harness.emit({ type: 'identity-configured' });
    await waitFor(
      () => harness.calls.filter((call) => call.payload.event_type === 'started').length === 2
        && harness.predictedButton.disabled === false,
      `${scenario.name} new identity initialized`,
    );
    const replacement = {
      state: harness.statusNode.dataset.evidenceState,
      message: harness.statusNode.statusMessage || harness.statusNode.textContent,
      projectionText: harness.projectionNode.textContent,
      projectionStatus: harness.projectionNode.dataset.projectionStatus,
    };
    assert.equal(replacement.state, 'confirmed');

    scenario.settle(oldAttempt, attemptedPayload);
    await waitFor(
      () => harness.completions.some((item) => (
        item.payload.client_event_id === attemptedPayload.client_event_id
      )),
      `${scenario.name} old attempted settled`,
    );
    await settle();
    assert.equal(harness.statusNode.dataset.evidenceState, replacement.state);
    assert.equal(
      harness.statusNode.statusMessage || harness.statusNode.textContent,
      replacement.message,
      `${scenario.name} stale untracked result must not overwrite new identity`,
    );
    assert.equal(harness.projectionNode.textContent, replacement.projectionText);
    assert.equal(harness.projectionNode.dataset.projectionStatus, replacement.projectionStatus);
    assert.equal(harness.predictedButton.disabled, false);
    assert.equal(harness.explainedButton.disabled, false);
    assert.equal(harness.explainedTextButton.disabled, false);
    assert.deepEqual(harness.warnings, [], `${scenario.name} stale untracked result must not warn`);
    harness.controller.destroy();
  }
}

async function testUntrackedPeerConfirmationIsExactAndMonotonic() {
  for (const timing of ['after-queued', 'before-queued']) {
    const attemptGate = deferred();
    let attemptedPayload = null;
    const harness = createActivityHarness((payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'attempted') {
        attemptedPayload = payload;
        return attemptGate.promise;
      }
      throw new Error(`unexpected event ${payload.event_type}`);
    });
    await waitFor(
      () => harness.predictedButton.disabled === false,
      `${timing} untracked peer ready`,
    );
    harness.emitDomain({
      galaxy_key: 'englab',
      activity_key: 'physics.mechanics',
      class_id: 41,
      course_id: 13,
      event_type: 'attempted',
      evidence: { operation: 'parameter-change', control: 'gravity-slider' },
    });
    await waitFor(() => attemptedPayload, `${timing} attempted request`);

    if (timing === 'after-queued') {
      attemptGate.resolve({
        outcome: 'queued',
        client_event_id: attemptedPayload.client_event_id,
        event_type: attemptedPayload.event_type,
        state: 'local-pending',
      });
      await waitFor(
        () => harness.statusNode.dataset.evidenceState === 'local-pending',
        `${timing} local queue state`,
      );
      assert.equal(harness.domainStatusNode.dataset.evidenceDomainState, 'local-pending');
    }

    const peerChange = (clientEventId, eventType, projectionOverride = {}) => ({
      source: 'peer-tab',
      type: 'confirmed',
      state: 'confirmed',
      client_event_id: clientEventId,
      event_type: eventType,
      projection: Object.assign({
        class_id: attemptedPayload.class_id,
        course_id: attemptedPayload.course_id,
        course_unit_id: attemptedPayload.course_unit_id,
        activity_key: attemptedPayload.activity_key,
        rule_version: attemptedPayload.rule_version,
        event_type: eventType,
      }, projectionOverride),
    });
    const priorState = harness.statusNode.dataset.evidenceState;
    const priorDomainState = harness.domainStatusNode.dataset.evidenceDomainState;
    harness.emit(peerChange(attemptedPayload.client_event_id, 'corrected'));
    harness.emit(peerChange(`${attemptedPayload.client_event_id}-wrong`, 'attempted'));
    harness.emit(peerChange(attemptedPayload.client_event_id, 'attempted', { class_id: 99 }));
    await settle();
    assert.equal(
      harness.statusNode.dataset.evidenceState,
      priorState,
      `${timing} wrong ID/type/scope must not update the command state`,
    );
    assert.equal(
      harness.domainStatusNode.dataset.evidenceDomainState,
      priorDomainState,
      `${timing} wrong ID/type/scope must not update the domain status owner`,
    );

    harness.emit(peerChange(attemptedPayload.client_event_id, 'attempted'));
    await waitFor(
      () => harness.statusNode.dataset.evidenceState === 'confirmed'
        && /本次证据已由服务端确认/.test(harness.statusNode.statusMessage),
      `${timing} exact peer confirmation`,
    );
    assert.equal(harness.domainStatusNode.dataset.evidenceDomainState, 'confirmed');

    if (timing === 'before-queued') {
      attemptGate.resolve({
        outcome: 'queued',
        client_event_id: attemptedPayload.client_event_id,
        event_type: attemptedPayload.event_type,
        state: 'local-pending',
      });
      await waitFor(
        () => harness.completions.some((item) => (
          item.payload.client_event_id === attemptedPayload.client_event_id
        )),
        `${timing} late local queue completion`,
      );
      await settle();
      assert.equal(
        harness.statusNode.dataset.evidenceState,
        'confirmed',
        'late local-pending must not regress an exact peer confirmation',
      );
      assert.equal(
        harness.domainStatusNode.dataset.evidenceDomainState,
        'confirmed',
        'late local-pending must not regress the exact domain confirmation',
      );
    }
    assert.deepEqual(harness.warnings, []);
    harness.controller.destroy();
  }
}

async function testTrackedCommandRetainsQueuedDomainIdentity() {
  const mapInstances = [];
  class TrackingMap extends Map {
    constructor(...args) {
      super(...args);
      mapInstances.push(this);
    }
  }
  const timers = createControlledTimers();
  const predictedGate = deferred();
  let predictedPayload = null;
  let attemptedPayload = null;
  const harness = createActivityHarness(
    (payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'predicted') {
        predictedPayload = payload;
        return predictedGate.promise;
      }
      if (payload.event_type === 'attempted') {
        attemptedPayload = payload;
        return {
          outcome: 'queued',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'local-pending',
        };
      }
      throw new Error(`unexpected tracked/domain event ${payload.event_type}`);
    },
    {
      Map: TrackingMap,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );
  await waitFor(() => harness.predictedButton.disabled === false, 'tracked/domain ready');
  timers.clear();
  assert.equal(mapInstances.length, 1);
  const operationTable = mapInstances[0];

  harness.predictedButton.click();
  await waitFor(() => predictedPayload, 'tracked prediction pending');
  const trackedMessage = harness.statusNode.statusMessage || harness.statusNode.textContent;
  assert.equal(harness.statusNode.dataset.evidenceState, 'syncing');
  assert.match(trackedMessage, /本次预测/);

  assert.equal(harness.emitDomain({
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    class_id: 41,
    course_id: 13,
    event_type: 'attempted',
    evidence: { operation: 'parameter-change', control: 'gravity-slider', value: 1100 },
  }), true);
  await waitFor(
    () => attemptedPayload
      && harness.completions.some(item => (
        item.payload.client_event_id === attemptedPayload.client_event_id
      )),
    'queued domain during tracked prediction',
  );
  assert.equal(operationTable.size, 2, 'tracked in-flight and queued domain identities must coexist');
  assert.equal(harness.statusNode.dataset.evidenceState, 'syncing');
  assert.equal(
    harness.statusNode.statusMessage || harness.statusNode.textContent,
    trackedMessage,
    'domain queue status must not replace the tracked prediction owner',
  );
  assert.equal(harness.domainStatusNode.dataset.evidenceDomainState, 'local-pending');

  const peerChange = (clientEventId, eventType, projectionOverride = {}) => ({
    source: 'peer-tab',
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: clientEventId,
    event_type: eventType,
    projection: Object.assign({
      class_id: attemptedPayload.class_id,
      course_id: attemptedPayload.course_id,
      course_unit_id: attemptedPayload.course_unit_id,
      activity_key: attemptedPayload.activity_key,
      rule_version: attemptedPayload.rule_version,
      event_type: eventType,
    }, projectionOverride),
  });
  const recoveryBefore = harness.recoveryCalls();
  harness.emit(peerChange(attemptedPayload.client_event_id, 'corrected'));
  harness.emit(peerChange(`${attemptedPayload.client_event_id}-wrong`, 'attempted'));
  harness.emit(peerChange(attemptedPayload.client_event_id, 'attempted', { class_id: 99 }));
  await settle();
  assert.equal(operationTable.size, 2);
  assert.equal(timers.pendingCount(), 0);
  assert.equal(harness.recoveryCalls(), recoveryBefore);
  assert.equal(harness.statusNode.statusMessage || harness.statusNode.textContent, trackedMessage);

  harness.emit(peerChange(attemptedPayload.client_event_id, 'attempted'));
  assert.equal(operationTable.size, 1, 'exact domain confirmation must release only its identity');
  assert.equal(timers.pendingCount(), 1, 'exact domain confirmation must schedule projection recovery');
  assert.equal(harness.statusNode.dataset.evidenceState, 'syncing');
  assert.equal(
    harness.statusNode.statusMessage || harness.statusNode.textContent,
    trackedMessage,
    'domain peer confirmation must not steal the tracked status owner',
  );
  await timers.runNext();
  assert.equal(harness.recoveryCalls(), recoveryBefore + 1);
  assert.equal(harness.statusNode.dataset.evidenceState, 'syncing');

  predictedGate.resolve(confirmed(predictedPayload));
  await waitFor(
    () => harness.statusNode.dataset.evidenceState === 'confirmed'
      && /本次预测/.test(harness.statusNode.statusMessage),
    'tracked prediction terminal state',
  );
  assert.equal(operationTable.size, 0);
  assert.deepEqual(harness.warnings, []);
  harness.controller.destroy();
}

async function testEarlierQueuedDomainIdentityRemainsExact() {
  const mapInstances = [];
  class TrackingMap extends Map {
    constructor(...args) {
      super(...args);
      mapInstances.push(this);
    }
  }
  const timers = createControlledTimers();
  const attemptedPayloads = [];
  const harness = createActivityHarness(
    (payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'attempted') {
        attemptedPayloads.push(payload);
        return {
          outcome: 'queued',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'local-pending',
        };
      }
      throw new Error(`unexpected earlier queued event ${payload.event_type}`);
    },
    {
      Map: TrackingMap,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );
  await waitFor(() => harness.predictedButton.disabled === false, 'earlier queued domain ready');
  timers.clear();
  const operationTable = mapInstances[0];
  for (const value of [1200, 1250]) {
    assert.equal(harness.emitDomain({
      galaxy_key: 'englab',
      activity_key: 'physics.mechanics',
      class_id: 41,
      course_id: 13,
      event_type: 'attempted',
      evidence: { operation: 'parameter-change', control: 'gravity-slider', value },
    }), true);
    await waitFor(
      () => attemptedPayloads.length === (value === 1200 ? 1 : 2)
        && operationTable.size === attemptedPayloads.length,
      `queued domain ${value}`,
    );
  }
  assert.equal(operationTable.size, 2);
  assert.equal(harness.statusNode.dataset.evidenceState, 'local-pending');

  const peerChange = (payload, override = {}) => ({
    source: 'peer-tab',
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: override.client_event_id || payload.client_event_id,
    event_type: override.event_type || payload.event_type,
    projection: {
      class_id: override.class_id || payload.class_id,
      course_id: payload.course_id,
      course_unit_id: payload.course_unit_id,
      activity_key: payload.activity_key,
      rule_version: payload.rule_version,
      event_type: override.event_type || payload.event_type,
    },
  });
  const recoveryBefore = harness.recoveryCalls();
  const first = attemptedPayloads[0];
  harness.emit(peerChange(first, { event_type: 'corrected' }));
  harness.emit(peerChange(first, { client_event_id: `${first.client_event_id}-wrong` }));
  harness.emit(peerChange(first, { class_id: 99 }));
  await settle();
  assert.equal(operationTable.size, 2);
  assert.equal(timers.pendingCount(), 0);
  assert.equal(harness.recoveryCalls(), recoveryBefore);

  harness.emit(peerChange(first));
  assert.equal(operationTable.size, 1, 'earlier exact peer must release its retained identity');
  assert.equal(timers.pendingCount(), 1);
  assert.equal(
    harness.statusNode.dataset.evidenceState,
    'local-pending',
    'earlier peer confirmation must not replace the later visible owner',
  );
  assert.equal(
    harness.domainStatusNode.dataset.evidenceDomainState,
    'local-pending',
    'earlier peer confirmation must not replace the later domain status owner',
  );
  await timers.runNext();
  assert.equal(harness.recoveryCalls(), recoveryBefore + 1);

  harness.emit(peerChange(attemptedPayloads[1]));
  assert.equal(operationTable.size, 0);
  assert.equal(harness.statusNode.dataset.evidenceState, 'confirmed');
  assert.equal(harness.domainStatusNode.dataset.evidenceDomainState, 'confirmed');
  await timers.runNext();
  assert.equal(harness.recoveryCalls(), recoveryBefore + 2);
  assert.deepEqual(harness.warnings, []);
  harness.controller.destroy();
}

async function testQueuedDomainIdentityCapacityResumesExactly() {
  const mapInstances = [];
  let maximumOperationCount = 0;
  class TrackingMap extends Map {
    constructor(...args) {
      super(...args);
      mapInstances.push(this);
    }

    set(key, value) {
      super.set(key, value);
      maximumOperationCount = Math.max(maximumOperationCount, this.size);
      return this;
    }
  }
  const timers = createControlledTimers();
  const attemptedPayloads = [];
  const harness = createActivityHarness(
    (payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'attempted') {
        attemptedPayloads.push(payload);
        return {
          outcome: 'queued',
          client_event_id: payload.client_event_id,
          event_type: payload.event_type,
          state: 'local-pending',
        };
      }
      throw new Error(`unexpected identity capacity event ${payload.event_type}`);
    },
    {
      Map: TrackingMap,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );
  await waitFor(() => harness.predictedButton.disabled === false, 'identity capacity ready');
  timers.clear();
  const operationTable = mapInstances[0];

  for (let index = 0; index < 256; index += 1) {
    assert.equal(harness.emitDomain({
      galaxy_key: 'englab',
      activity_key: 'physics.mechanics',
      class_id: 41,
      course_id: 13,
      event_type: 'attempted',
      evidence: {
        operation: 'parameter-change',
        control: 'gravity-slider',
        value: 2000 + index,
      },
    }), true);
    await waitFor(
      () => attemptedPayloads.length === index + 1
        && operationTable.size === index + 1,
      `queued identity ${index + 1}`,
    );
  }
  assert.equal(operationTable.size, 256);
  assert.ok(maximumOperationCount <= 256, 'peer identity table must never exceed its fixed limit');

  assert.equal(harness.emitDomain({
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    class_id: 41,
    course_id: 13,
    event_type: 'attempted',
    evidence: {
      operation: 'parameter-change',
      control: 'gravity-slider',
      value: 3000,
    },
  }), true, 'the next event must remain in the bounded page queue');
  await waitFor(
    () => harness.domainStatusNode.dataset.evidenceDomainState === 'manual-intervention',
    'peer identity capacity backpressure',
  );
  assert.equal(attemptedPayloads.length, 256, 'a full identity table must not issue another request');
  assert.equal(operationTable.size, 256);
  assert.match(
    harness.domainStatusNode.statusMessage || harness.domainStatusNode.textContent,
    /跨标签确认的证据身份已达上限/,
  );

  const first = attemptedPayloads[0];
  const peerChange = (type, clientEventId, eventType, classId) => ({
    source: 'peer-tab',
    type,
    state: type === 'confirmed' ? 'confirmed' : 'manual-intervention',
    client_event_id: clientEventId,
    event_type: eventType,
    projection: {
      class_id: classId,
      course_id: first.course_id,
      course_unit_id: first.course_unit_id,
      activity_key: first.activity_key,
      rule_version: first.rule_version,
      event_type: eventType,
    },
  });
  harness.emit(peerChange('manual-intervention', first.client_event_id, 'corrected', first.class_id));
  harness.emit(peerChange('manual-intervention', `${first.client_event_id}-wrong`, first.event_type, first.class_id));
  harness.emit(peerChange('manual-intervention', first.client_event_id, first.event_type, 99));
  await settle();
  assert.equal(operationTable.size, 256);
  assert.equal(attemptedPayloads.length, 256, 'wrong peer terminal must not resume the stalled queue');
  assert.equal(timers.pendingCount(), 0);

  harness.emit(peerChange(
    'manual-intervention',
    first.client_event_id,
    first.event_type,
    first.class_id,
  ));
  await waitFor(
    () => attemptedPayloads.length === 257
      && operationTable.size === 256
      && harness.domainStatusNode.dataset.evidenceDomainState === 'local-pending',
    'exact terminal capacity release and automatic resume',
  );
  assert.equal(
    operationTable.has(`attempted:${first.client_event_id}`),
    false,
    'exact terminal must release the matching retained identity',
  );
  const resumed = attemptedPayloads[256];
  assert.equal(operationTable.has(`attempted:${resumed.client_event_id}`), true);
  assert.equal(harness.domainStatusNode.dataset.evidenceDomainState, 'local-pending');
  assert.ok(maximumOperationCount <= 256);

  harness.emit({ type: 'authority-cleared' });
  assert.equal(operationTable.size, 0, 'authority clear must release the full identity table');
  assert.equal(harness.domainStatusNode.hidden, true);
  assert.deepEqual(harness.warnings, []);
  harness.controller.destroy();
}

async function testSharedQueueFullBackpressureWaitsForCapacityRelease() {
  const mapInstances = [];
  class TrackingMap extends Map {
    constructor(...args) {
      super(...args);
      mapInstances.push(this);
    }
  }
  const timers = createControlledTimers();
  const attemptedPayloads = [];
  let sharedQueueFailures = 2;
  const harness = createActivityHarness(
    (payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'attempted') {
        attemptedPayloads.push(payload);
        if (sharedQueueFailures > 0) {
          sharedQueueFailures -= 1;
          const error = new Error('shared IndexedDB queue is full');
          error.code = 'queue_limit_reached';
          throw error;
        }
        return confirmed(payload);
      }
      throw new Error(`unexpected shared queue event ${payload.event_type}`);
    },
    {
      Map: TrackingMap,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );
  await waitFor(() => harness.predictedButton.disabled === false, 'shared queue backpressure ready');
  timers.clear();
  assert.equal(mapInstances.length, 1);
  const operationTable = mapInstances[0];
  const domainCommand = (value) => ({
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    class_id: 41,
    course_id: 13,
    event_type: 'attempted',
    evidence: { operation: 'parameter-change', control: 'gravity-slider', value },
  });

  assert.equal(harness.emitDomain(domainCommand(1100)), true);
  assert.equal(harness.emitDomain(domainCommand(1200)), true);
  await waitFor(
    () => attemptedPayloads.length === 1
      && harness.domainStatusNode.dataset.evidenceDomainState === 'manual-intervention'
      && /共享待同步证据队列已满/.test(
        harness.domainStatusNode.statusMessage || harness.domainStatusNode.textContent,
      ),
    'shared queue first full result',
  );
  const firstPayload = attemptedPayloads[0];
  assert.equal(operationTable.size, 1, 'the not-yet-queued command identity must remain retained');
  assert.match(
    harness.domainStatusNode.statusMessage || harness.domainStatusNode.textContent,
    /共享待同步证据队列已满/,
  );
  assert.doesNotMatch(
    harness.domainStatusNode.statusMessage || harness.domainStatusNode.textContent,
    /跨标签确认的证据身份已达上限/,
    'shared queue capacity and local identity capacity must remain distinguishable',
  );
  assert.deepEqual(harness.warnings, []);

  harness.emit({
    source: 'peer-tab',
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: `${firstPayload.client_event_id}-wrong`,
    event_type: firstPayload.event_type,
    projection: {
      class_id: firstPayload.class_id,
      course_id: firstPayload.course_id,
      course_unit_id: firstPayload.course_unit_id,
      activity_key: firstPayload.activity_key,
      rule_version: firstPayload.rule_version,
      event_type: firstPayload.event_type,
    },
  });
  await settle();
  assert.equal(attemptedPayloads.length, 1, 'a wrong peer terminal must not retry shared capacity');
  assert.equal(operationTable.size, 1);

  harness.emit({ type: 'queue-capacity-released', reason: 'confirmed' });
  await waitFor(
    () => attemptedPayloads.length === 2
      && /共享待同步证据队列已满/.test(
        harness.domainStatusNode.statusMessage || harness.domainStatusNode.textContent,
      ),
    'one shared capacity retry while still full',
  );
  assert.equal(
    attemptedPayloads[1].client_event_id,
    firstPayload.client_event_id,
    'shared queue retry must preserve the original idempotency identity',
  );
  assert.equal(operationTable.size, 1);
  assert.match(
    harness.domainStatusNode.statusMessage || harness.domainStatusNode.textContent,
    /共享待同步证据队列已满/,
  );
  for (let index = 0; index < 5; index += 1) await settle();
  assert.equal(
    attemptedPayloads.length,
    2,
    'a retry that still finds the shared queue full must stop without spinning',
  );

  harness.emit({ type: 'queue-capacity-released', reason: 'expired-pruned' });
  await waitFor(
    () => attemptedPayloads.length === 4 && operationTable.size === 0,
    'shared capacity release resumes the retained head and following command',
  );
  assert.equal(attemptedPayloads[2].client_event_id, firstPayload.client_event_id);
  assert.deepEqual(
    attemptedPayloads.map((payload) => payload.evidence.value),
    [1100, 1100, 1100, 1200],
    'the following command must not run until the retained head becomes durable',
  );
  assert.notEqual(
    attemptedPayloads[3].client_event_id,
    firstPayload.client_event_id,
    'the following command keeps its own stable identity',
  );

  sharedQueueFailures = 1;
  assert.equal(harness.emitDomain(domainCommand(1300)), true);
  await waitFor(
    () => attemptedPayloads.length === 5
      && harness.domainStatusNode.dataset.evidenceDomainState === 'manual-intervention',
    'authority shared queue block',
  );
  assert.equal(operationTable.size, 1);
  harness.emit({ type: 'authority-cleared' });
  assert.equal(operationTable.size, 0);
  assert.equal(harness.domainStatusNode.hidden, true);
  harness.emit({ type: 'identity-configured' });
  await waitFor(
    () => harness.calls.filter((call) => call.payload.event_type === 'started').length === 2
      && harness.predictedButton.disabled === false,
    'shared queue block reset after identity reconfiguration',
  );
  assert.equal(attemptedPayloads.length, 5, 'authority reset must discard the old blocked command');

  assert.equal(harness.emitDomain(domainCommand(1400)), true);
  await waitFor(() => attemptedPayloads.length === 6 && operationTable.size === 0, 'post-authority drain');

  sharedQueueFailures = 1;
  assert.equal(harness.emitDomain(domainCommand(1500)), true);
  await waitFor(
    () => attemptedPayloads.length === 7
      && harness.domainStatusNode.dataset.evidenceDomainState === 'manual-intervention',
    'destroy shared queue block',
  );
  assert.equal(operationTable.size, 1);
  harness.controller.destroy();
  assert.equal(operationTable.size, 0);
  harness.emit({ type: 'queue-capacity-released', reason: 'removed' });
  await settle();
  assert.equal(attemptedPayloads.length, 7, 'destroyed activity must not retry a blocked command');
  assert.deepEqual(harness.warnings, []);
}

async function testConfirmedWritesSurviveProjectionRecoveryFailure() {
  const recoverySnapshot = {
    rule_version: 1,
    activities: [{
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
      status: 'in_progress',
    }],
  };
  for (const eventType of ['predicted', 'explained']) {
    const timers = createControlledTimers();
    const harness = createActivityHarness(
      (payload) => confirmed(payload),
      {
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        recoveryHandler(scope, callCount) {
          if (callCount === 1) return recoverySnapshot;
          const error = new Error('projection refresh unavailable');
          error.code = 'projection_refresh_failed';
          throw error;
        },
      },
    );
    await waitFor(
      () => harness.predictedButton.disabled === false,
      `${eventType} recovery failure ready`,
    );
    timers.clear();
    const button = eventType === 'predicted'
      ? harness.predictedButton
      : harness.explainedButton;
    button.click();
    if (eventType === 'predicted') {
      await waitFor(
        () => timers.pendingCount() === 1,
        `${eventType} projection refresh scheduled`,
      );
      await timers.runNext();
    } else {
      await waitFor(
        () => harness.recoveryCalls() === 2
          && harness.projectionNode.dataset.projectionStatus === 'refresh-failed',
        `${eventType} direct projection refresh failure`,
      );
    }
    assert.equal(harness.recoveryCalls(), 2);
    assert.equal(harness.projectionNode.dataset.projectionStatus, 'refresh-failed');
    assert.equal(harness.statusNode.dataset.evidenceState, 'confirmed');
    assert.match(
      harness.statusNode.statusMessage || harness.statusNode.textContent,
      eventType === 'predicted' ? /本次预测.*确认/ : /本次解释已确认/,
    );
    assert.doesNotMatch(
      harness.statusNode.statusMessage || harness.statusNode.textContent,
      /未保存/,
    );
    assert.match(harness.projectionNode.textContent, /本次事件已确认/);
    assert.match(harness.projectionNode.textContent, /投影暂不可刷新/);
    assert.deepEqual(harness.warnings, []);
    harness.controller.destroy();
  }
}

async function testSupersededRecoveryCannotWriteProjection() {
  const snapshot = (ruleVersion, status) => ({
    rule_version: ruleVersion,
    activities: [{
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: ruleVersion,
      status,
    }],
  });
  const genericConfirmation = () => ({
    type: 'confirmed',
    state: 'confirmed',
    projection: {
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
    },
  });

  {
    const recoveryA = deferred();
    const recoveryB = deferred();
    const timers = createControlledTimers();
    let signalA = null;
    let signalB = null;
    const harness = createActivityHarness(
      (payload) => confirmed(payload),
      {
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        recoveryHandler(scope, callCount, requestOptions) {
          if (callCount === 1) return snapshot(1, 'in_progress');
          if (callCount === 2) {
            signalA = requestOptions.signal;
            return recoveryA.promise;
          }
          if (callCount === 3) {
            signalB = requestOptions.signal;
            return recoveryB.promise;
          }
          throw new Error(`unexpected recovery call ${callCount}`);
        },
      },
    );
    await waitFor(() => harness.predictedButton.disabled === false, 'superseded recovery ready');
    timers.clear();

    harness.emit(genericConfirmation());
    assert.equal(timers.pendingCount(), 1);
    const taskA = timers.runNext();
    await waitFor(() => harness.recoveryCalls() === 2, 'recovery A pending');
    assert.equal(signalA.aborted, false);

    harness.emit(genericConfirmation());
    assert.equal(timers.pendingCount(), 1);
    const taskB = timers.runNext();
    await waitFor(() => harness.recoveryCalls() === 3, 'recovery B pending');
    assert.equal(signalA.aborted, true, 'recovery B must abort recovery A');
    assert.equal(signalB.aborted, false);

    recoveryB.resolve(snapshot(3, 'transferred'));
    await taskB;
    assert.equal(harness.projectionNode.dataset.projectionStatus, 'transferred');
    assert.match(harness.projectionNode.textContent, /规则版本 3/);

    recoveryA.resolve(snapshot(2, 'completed'));
    await taskA;
    await settle();
    assert.equal(
      harness.projectionNode.dataset.projectionStatus,
      'transferred',
      'an aborted recovery that ignores its signal must not regress the DOM',
    );
    assert.match(harness.projectionNode.textContent, /规则版本 3/);

    harness.predictedButton.click();
    await waitFor(
      () => harness.calls.some((call) => call.payload.event_type === 'predicted'),
      'post-race predicted command',
    );
    const predicted = harness.calls.find((call) => call.payload.event_type === 'predicted');
    assert.equal(predicted.payload.rule_version, 3, 'late recovery A must not regress rule state');
    assert.deepEqual(harness.warnings, []);
    harness.controller.destroy();
  }

  {
    const staleRecovery = deferred();
    const timers = createControlledTimers();
    let staleSignal = null;
    const harness = createActivityHarness(
      (payload) => confirmed(payload),
      {
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        recoveryHandler(scope, callCount, requestOptions) {
          if (callCount === 1) return snapshot(1, 'in_progress');
          if (callCount === 2) {
            staleSignal = requestOptions.signal;
            return staleRecovery.promise;
          }
          if (callCount === 3) return snapshot(4, 'transferred');
          throw new Error(`unexpected identity recovery call ${callCount}`);
        },
      },
    );
    await waitFor(() => harness.predictedButton.disabled === false, 'identity recovery ready');
    timers.clear();
    harness.emit(genericConfirmation());
    const staleTask = timers.runNext();
    await waitFor(() => harness.recoveryCalls() === 2, 'identity stale recovery pending');

    harness.emit({ type: 'identity-configured' });
    await waitFor(
      () => harness.recoveryCalls() === 3
        && harness.predictedButton.disabled === false,
      'replacement identity recovery',
    );
    assert.equal(staleSignal.aborted, true);
    assert.equal(harness.projectionNode.dataset.projectionStatus, 'transferred');
    assert.match(harness.projectionNode.textContent, /规则版本 4/);

    staleRecovery.resolve(snapshot(2, 'completed'));
    await staleTask;
    await settle();
    assert.equal(harness.projectionNode.dataset.projectionStatus, 'transferred');
    assert.match(harness.projectionNode.textContent, /规则版本 4/);
    assert.deepEqual(harness.warnings, []);
    harness.controller.destroy();
  }

  {
    const staleRecovery = deferred();
    const timers = createControlledTimers();
    let staleSignal = null;
    const harness = createActivityHarness(
      (payload) => confirmed(payload),
      {
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        recoveryHandler(scope, callCount, requestOptions) {
          if (callCount === 1) return snapshot(1, 'in_progress');
          staleSignal = requestOptions.signal;
          return staleRecovery.promise;
        },
      },
    );
    await waitFor(() => harness.predictedButton.disabled === false, 'destroy recovery ready');
    timers.clear();
    harness.emit(genericConfirmation());
    const staleTask = timers.runNext();
    await waitFor(() => harness.recoveryCalls() === 2, 'destroy stale recovery pending');
    harness.controller.destroy();
    assert.equal(staleSignal.aborted, true);
    assert.equal(harness.projectionNode.hidden, true);
    assert.equal(harness.projectionNode.textContent, '');

    staleRecovery.resolve(snapshot(2, 'completed'));
    await staleTask;
    await settle();
    assert.equal(
      harness.projectionNode.textContent,
      '',
      'a recovery that resolves after destroy must not revive detached projection DOM',
    );
    assert.deepEqual(harness.warnings, []);
  }
}

async function testDomainCommandBackpressureIsBounded() {
  const mapInstances = [];
  let maximumOperationCount = 0;
  class TrackingMap extends Map {
    constructor(...args) {
      super(...args);
      mapInstances.push(this);
    }

    set(key, value) {
      super.set(key, value);
      maximumOperationCount = Math.max(maximumOperationCount, this.size);
      return this;
    }
  }

  const timers = createControlledTimers();
  const firstAttempt = deferred();
  let heldAttempt = firstAttempt;
  const harness = createActivityHarness(
    (payload) => {
      if (payload.event_type === 'started') return confirmed(payload);
      if (payload.event_type === 'attempted') {
        if (heldAttempt) {
          const pending = heldAttempt;
          heldAttempt = null;
          return pending.promise;
        }
        if (payload.evidence && payload.evidence.value === 1015) {
          return {
            outcome: 'queued',
            client_event_id: payload.client_event_id,
            event_type: payload.event_type,
            state: 'local-pending',
          };
        }
        return confirmed(payload);
      }
      throw new Error(`unexpected bounded domain event ${payload.event_type}`);
    },
    {
      Map: TrackingMap,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );
  await waitFor(() => harness.predictedButton.disabled === false, 'bounded domain ready');
  timers.clear();
  assert.equal(mapInstances.length, 1, 'activity must use one record operation table');
  const operationTable = mapInstances[0];

  let acceptedCount = 0;
  for (let index = 0; index < 300; index += 1) {
    const accepted = harness.emitDomain({
      galaxy_key: 'englab',
      activity_key: 'physics.mechanics',
      class_id: 41,
      course_id: 13,
      event_type: 'attempted',
      evidence: {
        operation: 'parameter-change',
        control: 'gravity-slider',
        value: 1000 + index,
      },
    });
    if (accepted) acceptedCount += 1;
    if (index === 0) {
      assert.equal(accepted, true);
      assert.match(
        harness.statusNode.statusMessage || harness.statusNode.textContent,
        /正在按顺序保存操作证据/,
        'initialized domain buffering must not claim that scope is still initializing',
      );
    }
  }
  assert.equal(acceptedCount, 16, 'mounted domain owner must retain at most sixteen commands');
  assert.equal(
    harness.calls.filter(call => call.payload.event_type === 'attempted').length,
    1,
    'a burst must create only one in-flight domain request',
  );
  assert.equal(operationTable.size, 1);
  assert.ok(maximumOperationCount <= 1, 'serialized domain requests must bound the operation table');
  assert.equal(harness.statusNode.dataset.evidenceState, 'manual-intervention');
  assert.match(
    harness.statusNode.statusMessage || harness.statusNode.textContent,
    /暂存已满/,
    'overflow must be visible rather than silently discarded',
  );
  assert.deepEqual(harness.warnings, []);

  const firstPayload = harness.calls.find(call => call.payload.event_type === 'attempted').payload;
  firstAttempt.resolve(confirmed(firstPayload));
  await waitFor(
    () => harness.calls.filter(call => call.payload.event_type === 'attempted').length === 16
      && operationTable.size === 1,
    'bounded domain queue terminal drain',
  );
  assert.equal(harness.statusNode.dataset.evidenceState, 'local-pending');
  const lastQueuedPayload = harness.calls.filter(
    call => call.payload.event_type === 'attempted',
  ).at(-1).payload;
  harness.emit({
    source: 'peer-tab',
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: lastQueuedPayload.client_event_id,
    event_type: lastQueuedPayload.event_type,
    projection: {
      class_id: lastQueuedPayload.class_id,
      course_id: lastQueuedPayload.course_id,
      course_unit_id: lastQueuedPayload.course_unit_id,
      activity_key: lastQueuedPayload.activity_key,
      rule_version: lastQueuedPayload.rule_version,
      event_type: lastQueuedPayload.event_type,
    },
  });
  await waitFor(
    () => harness.statusNode.dataset.evidenceState === 'confirmed',
    'bounded queue last visible owner peer confirmation',
  );
  assert.equal(operationTable.size, 0, 'exact peer terminal must release queued identity');
  const recovered = harness.emitDomain({
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    class_id: 41,
    course_id: 13,
    event_type: 'attempted',
    evidence: { operation: 'parameter-change', control: 'gravity-slider', value: 1400 },
  });
  assert.equal(recovered, true, 'capacity must recover after terminal outcomes');
  await waitFor(
    () => harness.calls.filter(call => call.payload.event_type === 'attempted').length === 17
      && operationTable.size === 0,
    'bounded domain capacity recovery',
  );

  const authorityAttempt = deferred();
  heldAttempt = authorityAttempt;
  assert.equal(harness.emitDomain({
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    class_id: 41,
    course_id: 13,
    event_type: 'attempted',
    evidence: { operation: 'parameter-change', control: 'gravity-slider', value: 1450 },
  }), true);
  await waitFor(() => operationTable.size === 1, 'authority domain operation pending');
  const authorityPayload = harness.calls[harness.calls.length - 1].payload;
  harness.emit({ type: 'authority-cleared' });
  assert.equal(operationTable.size, 0, 'authority clear must release operation state immediately');
  authorityAttempt.resolve(confirmed(authorityPayload));
  await waitFor(
    () => harness.completions.some(item => (
      item.payload.client_event_id === authorityPayload.client_event_id
    )),
    'stale authority domain operation settled',
  );

  harness.emit({ type: 'identity-configured' });
  await waitFor(
    () => harness.calls.filter(call => call.payload.event_type === 'started').length === 2
      && harness.predictedButton.disabled === false,
    'bounded domain replacement identity ready',
  );
  timers.clear();
  const destroyAttempt = deferred();
  heldAttempt = destroyAttempt;
  assert.equal(harness.emitDomain({
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    class_id: 41,
    course_id: 13,
    event_type: 'attempted',
    evidence: { operation: 'parameter-change', control: 'gravity-slider', value: 1500 },
  }), true);
  await waitFor(() => operationTable.size === 1, 'destroy domain operation pending');
  const destroyPayload = harness.calls[harness.calls.length - 1].payload;
  harness.controller.destroy();
  assert.equal(operationTable.size, 0, 'destroy must release operation state immediately');
  destroyAttempt.resolve(confirmed(destroyPayload));
  await waitFor(
    () => harness.completions.some(item => (
      item.payload.client_event_id === destroyPayload.client_event_id
    )),
    'destroyed domain operation settled',
  );
  assert.deepEqual(harness.warnings, []);
}

async function testAuthorityClearsProjectionImmediately() {
  const completedProjection = {
    rule_version: 1,
    activities: [{
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
      status: 'completed',
    }],
  };
  const timers = createControlledTimers();
  const harness = createActivityHarness(
    (payload) => confirmed(payload),
    {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      recoveryHandler(scope, callCount) {
        if (callCount === 1) return completedProjection;
        const error = new Error('replacement identity recovery unavailable');
        error.code = 'projection_refresh_failed';
        throw error;
      },
    },
  );
  await waitFor(() => harness.predictedButton.disabled === false, 'authority projection ready');
  timers.clear();
  assert.equal(harness.projectionNode.hidden, false);
  assert.equal(harness.projectionNode.dataset.projectionStatus, 'completed');

  harness.emit({ type: 'authority-cleared' });
  assert.equal(harness.projectionNode.hidden, true, 'authority clear must hide the old projection');
  assert.equal(harness.projectionNode.textContent, '');
  assert.equal(harness.projectionNode.dataset.projectionStatus, undefined);

  harness.emit({ type: 'identity-configured' });
  await waitFor(
    () => harness.recoveryCalls() === 2
      && harness.statusNode.dataset.evidenceState === 'manual-intervention',
    'replacement identity recovery failure',
  );
  assert.equal(harness.projectionNode.hidden, true);
  assert.equal(harness.projectionNode.textContent, '');
  assert.equal(
    harness.projectionNode.dataset.projectionStatus,
    undefined,
    'failed replacement recovery must not expose the old identity projection',
  );
  assert.deepEqual(harness.warnings, []);
  harness.controller.destroy();
}

async function testClientTransientFailureQueuesAndAutoFlushesExactEvent() {
  const records = [];
  const queueListeners = new Set();
  const clientEvents = [];
  const apiCalls = [];
  const timers = new Map();
  let timerId = 0;
  let firstSingle = true;
  const queue = {
    async configureIdentity() {},
    async clearAuthority() { records.length = 0; },
    subscribe(listener) {
      queueListeners.add(listener);
      return () => queueListeners.delete(listener);
    },
    async enqueue(payload) {
      const record = {
        client_event_id: payload.client_event_id,
        payload,
        state: 'local-pending',
        attempts: 0,
        next_attempt_at: 0,
      };
      records.push(record);
      return record;
    },
    async updateState(clientEventId, state, details = {}) {
      const record = records.find((item) => item.client_event_id === clientEventId);
      record.state = state;
      record.attempts += state === 'syncing' ? 1 : 0;
      if (details.next_attempt_at !== undefined) record.next_attempt_at = details.next_attempt_at;
      return record;
    },
    async remove(clientEventId, confirmedReceipt) {
      const index = records.findIndex((item) => item.client_event_id === clientEventId);
      if (index < 0) return;
      const [record] = records.splice(index, 1);
      queueListeners.forEach((listener) => listener({
        source: 'queue',
        type: confirmedReceipt ? 'confirmed' : 'removed',
        client_event_id: clientEventId,
        state: confirmedReceipt ? 'confirmed' : undefined,
        projection: {
          class_id: record.payload.class_id,
          course_id: record.payload.course_id,
          course_unit_id: record.payload.course_unit_id,
          activity_key: record.payload.activity_key,
          rule_version: record.payload.rule_version,
          event_type: record.payload.event_type,
        },
      }));
    },
    async list(options = {}) {
      return records.filter((record) => (
        !options.states || options.states.includes(record.state)
      ));
    },
    async stats() { return { count: records.length, bytes: 0, oldest_at: null }; },
    async acquireLease() { return true; },
    async renewLease() { return true; },
    async releaseLease() {},
  };
  const context = {
    window: null,
    console: { log() {}, error() {}, warn() {} },
    TextEncoder,
    AbortController,
    crypto: webcrypto,
    AstraLearningEvidenceQueue: queue,
    AstraLearningEvidenceLoader: { isAuthorityClearPending: () => false },
    AstraApiClient: {
      isOffline: () => false,
      async request(pathname, options) {
        apiCalls.push({ pathname, options });
        if (pathname.endsWith('/events') && firstSingle) {
          firstSingle = false;
          const error = new Error('temporary network failure');
          error.code = 'network';
          throw error;
        }
        if (pathname.endsWith('/events/batch')) {
          const payload = options.body.items[0];
          return {
            items: [{
              client_event_id: payload.client_event_id,
              outcome: 'accepted',
              status_code: 201,
              receipt: {
                event_id: 501,
                client_event_id: payload.client_event_id,
                event_type: payload.event_type,
                outcome: 'accepted',
                received_at: '2026-07-29T08:00:00Z',
              },
            }],
            accepted_count: 1,
            duplicate_count: 0,
            rejected_count: 0,
            conflict_count: 0,
          };
        }
        throw new Error(`unexpected API path ${pathname}`);
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setInterval,
    clearInterval,
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.cleared = true;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context, {
    filename: 'shared/js/learning-evidence-client.js',
  });
  const client = context.AstraLearningEvidenceClient;
  client.subscribe((change) => clientEvents.push(change));
  await client.configureIdentity({ id: 7, role: 'student' });
  const initialFlush = Array.from(timers.values()).find((timer) => timer.delay === 0 && !timer.cleared);
  assert.ok(initialFlush);
  initialFlush.callback();
  await settle();

  const command = {
    client_event_id: 'predicted-v7710-event-0001',
    class_id: 41,
    course_id: 13,
    course_unit_id: 37,
    activity_key: 'physics.mechanics',
    rule_version: 1,
    event_type: 'predicted',
    evidence: {
      prediction: { choice: 'expect-change' },
      cursor: { stage: 'predicted' },
    },
    occurred_at: '2026-07-29T08:00:00Z',
  };
  const queued = await client.record(command);
  assert.equal(queued.outcome, 'queued');
  assert.equal(queued.client_event_id, command.client_event_id);
  assert.equal(queued.event_type, 'predicted');
  assert.equal(records.length, 1);
  assert.equal(records[0].payload.client_event_id, command.client_event_id);
  assert.equal(records[0].payload.event_type, 'predicted');
  const retryTimer = Array.from(timers.values()).find((timer) => timer.delay === 1500 && !timer.cleared);
  assert.ok(retryTimer, 'online transient failure must schedule automatic queue flush');
  retryTimer.callback();
  await waitFor(() => records.length === 0, 'automatic exact-event flush');
  const batch = apiCalls.find((call) => call.pathname.endsWith('/events/batch'));
  assert.equal(batch.options.body.items[0].client_event_id, command.client_event_id);
  assert.equal(batch.options.body.items[0].event_type, 'predicted');
  assert.ok(clientEvents.some((change) => (
    change.type === 'confirmed'
    && change.client_event_id === command.client_event_id
    && change.event_type === 'predicted'
  )));
  assert.ok(clientEvents.some((change) => (
    change.type === 'queue-capacity-released'
    && change.reason === 'confirmed'
    && !change.client_event_id
  )), 'the client must signal capacity only after the physical queue removal');
  const capacitySignalsBefore = clientEvents.filter(
    (change) => change.type === 'queue-capacity-released',
  ).length;
  queueListeners.forEach((listener) => listener({
    source: 'queue',
    type: 'expired-pruned',
    count: 1,
  }));
  queueListeners.forEach((listener) => listener({
    source: 'queue',
    type: 'removed',
  }));
  assert.deepEqual(
    clientEvents
      .filter((change) => change.type === 'queue-capacity-released')
      .slice(capacitySignalsBefore)
      .map((change) => change.reason),
    ['expired-pruned', 'removed'],
    'only real shared queue capacity changes may publish capacity release signals',
  );
  client.destroy();
}

function createFabHarness() {
  const document = new MiniDocument();
  const timers = new Map();
  let timerId = 0;
  const storage = new Map([['englab-fab-discovered', '1']]);
  const MutationObserver = createMutationObserverClass(document);
  const context = {
    window: null,
    document,
    MutationObserver,
    console,
    sessionStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { id, callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.cleared = true;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fabSource, context, { filename: 'shared/js/fab-trigger.js' });
  return {
    context,
    document,
    fab: context.FabTrigger,
    timers,
    create(tag, className) {
      const element = document.createElement(tag);
      element.className = className;
      return element;
    },
    runTimer(id) {
      const timer = timers.get(id);
      if (timer && !timer.cleared) {
        timer.cleared = true;
        timer.callback();
      }
    },
  };
}

function assertUnavailable(element, label) {
  assert.equal(element.getAttribute('tabindex'), '-1', `${label} tabindex`);
  assert.equal(element.getAttribute('aria-hidden'), 'true', `${label} aria-hidden`);
  assert.equal(element.inert, true, `${label} inert`);
}

function focusSnapshot(element) {
  return {
    hadTabIndex: element.hasAttribute('tabindex'),
    tabIndex: element.getAttribute('tabindex'),
    hadAriaHidden: element.hasAttribute('aria-hidden'),
    ariaHidden: element.getAttribute('aria-hidden'),
    hadInert: element.hasAttribute('inert'),
    inert: Boolean(element.inert),
  };
}

function assertRestored(element, label, expected = {
  hadTabIndex: false,
  tabIndex: null,
  hadAriaHidden: false,
  ariaHidden: null,
  hadInert: false,
  inert: false,
}) {
  assert.equal(element.hasAttribute('tabindex'), expected.hadTabIndex, `${label} tabindex presence`);
  assert.equal(element.getAttribute('tabindex'), expected.tabIndex, `${label} tabindex restored`);
  assert.equal(element.hasAttribute('aria-hidden'), expected.hadAriaHidden, `${label} aria-hidden presence`);
  assert.equal(element.getAttribute('aria-hidden'), expected.ariaHidden, `${label} aria-hidden restored`);
  assert.equal(element.hasAttribute('inert'), expected.hadInert, `${label} inert attribute restored`);
  assert.equal(element.inert, expected.inert, `${label} inert property restored`);
}

function testFabFocusLifecycle() {
  const harness = createFabHarness();
  const { fab, document } = harness;
  const actions = [
    harness.create('button', 'experiment-guide-help-btn'),
    harness.create('button', 'favorite-fab'),
    harness.create('button', 'back-to-top-fab'),
    harness.create('button', 'experiment-export-btn'),
  ];
  actions[1].setAttribute('tabindex', '-1');
  actions[1].setAttribute('aria-hidden', 'false');
  actions[2].setAttribute('tabindex', '4');
  actions[2].setAttribute('aria-hidden', 'true');
  actions[2].setAttribute('inert', '');
  actions[2].inert = true;
  actions[3].setAttribute('tabindex', '7');
  const actionSnapshots = actions.map(focusSnapshot);
  actions.forEach((action) => document.body.appendChild(action));

  const menu = harness.create('div', 'experiment-export-menu');
  const menuItems = ['screenshot', 'csv', 'share'].map((action) => {
    const item = harness.create('button', 'experiment-export-menu__item');
    item.dataset.action = action;
    menu.appendChild(item);
    return item;
  });
  menuItems[1].setAttribute('tabindex', '-1');
  menuItems[1].setAttribute('aria-hidden', 'false');
  menuItems[2].setAttribute('tabindex', '2');
  menuItems[2].setAttribute('aria-hidden', 'true');
  menuItems[2].setAttribute('inert', '');
  menuItems[2].inert = true;
  const menuSnapshots = menuItems.map(focusSnapshot);
  document.body.appendChild(menu);
  fab.show();
  const main = document.querySelector('.fab-trigger');
  assert.equal(main.getAttribute('aria-expanded'), 'false');
  assert.equal(document.body.getAttribute('data-fab-expanded'), 'false');
  assert.equal(fab._focusObserver.options.childList, true);
  assert.equal(fab._focusObserver.options.subtree, true);
  assert.equal(Boolean(fab._focusObserver.options.attributes), false);
  assert.equal(fab._exportMenuObserver.target, menu);
  assert.equal(Array.from(fab._exportMenuObserver.options.attributeFilter).join(','), 'class');
  actions.forEach((action) => assertUnavailable(action, action.className));
  assertUnavailable(menu, 'closed export menu');
  menuItems.forEach((item) => assertUnavailable(item, `closed ${item.dataset.action}`));
  harness.context.ExperimentExport = {
    _closeMenu() { menu.classList.remove('open'); },
  };

  main.click();
  assert.equal(main.getAttribute('aria-expanded'), 'true');
  actions.forEach((action, index) => assertRestored(action, action.className, actionSnapshots[index]));
  menuItems.forEach((item) => assertUnavailable(item, `still closed ${item.dataset.action}`));
  assert.equal(actions[3].getAttribute('aria-controls'), 'experiment-export-menu');
  assert.equal(actions[3].getAttribute('aria-expanded'), 'false');
  menu.classList.add('open');
  menuItems.forEach((item) => assertUnavailable(item, `open pending ${item.dataset.action}`));
  assert.ok(document.flushMutations() > 0, 'menu class observer must flush asynchronously');
  menuItems.forEach((item, index) => assertRestored(item, `open ${item.dataset.action}`, menuSnapshots[index]));
  assert.equal(actions[3].getAttribute('aria-expanded'), 'true');
  menuItems[0].focus();
  menu.classList.remove('open');
  assert.equal(document.activeElement, menuItems[0], 'menu close is delivered in an observer batch');
  document.flushMutations();
  assert.equal(document.activeElement, actions[3], 'closing export menu returns focus to export action');
  menuItems.forEach((item) => assertUnavailable(item, `reclosed ${item.dataset.action}`));
  assert.equal(actions[3].getAttribute('aria-expanded'), 'false');

  actions[0].focus();
  fab.collapse();
  assert.equal(document.activeElement, main, 'collapsing a focused action returns focus to main FAB');
  assert.equal(main.getAttribute('aria-expanded'), 'false');
  actions.forEach((action) => assertUnavailable(action, action.className));
  const firstCollapseTimer = Array.from(harness.timers.values()).find(
    (timer) => timer.delay === 450 && !timer.cleared,
  );
  assert.ok(firstCollapseTimer);

  fab.toggle();
  assert.equal(firstCollapseTimer.cleared, true, 're-expanding clears the old collapse timer');
  fab.collapse();
  const secondCollapseTimer = Array.from(harness.timers.values()).find(
    (timer) => timer.delay === 450 && !timer.cleared && timer.id !== firstCollapseTimer.id,
  );
  assert.ok(secondCollapseTimer);
  harness.runTimer(firstCollapseTimer.id);
  assert.equal(document.body.hasAttribute('data-fab-collapsing'), true);
  harness.runTimer(secondCollapseTimer.id);
  assert.equal(document.body.hasAttribute('data-fab-collapsing'), false);

  fab.toggle();
  const lateFavorite = harness.create('button', 'favorite-fab');
  lateFavorite.setAttribute('tabindex', '5');
  lateFavorite.setAttribute('aria-hidden', 'false');
  const lateSnapshot = focusSnapshot(lateFavorite);
  document.body.appendChild(lateFavorite);
  assertRestored(lateFavorite, 'expanded late favorite before observer', lateSnapshot);
  assert.ok(document.flushMutations() > 0, 'expanded late owner is scanned in an async childList batch');
  assertRestored(lateFavorite, 'expanded late favorite after observer', lateSnapshot);
  lateFavorite._notifyAttribute('style');
  lateFavorite._notifyAttribute('hidden');
  assert.equal(
    document.flushMutations(),
    0,
    'body focus observer must not subscribe to animation style/class/hidden attributes',
  );
  fab.collapse();
  assertUnavailable(lateFavorite, 'late favorite');
  fab.toggle();
  assertRestored(lateFavorite, 'late favorite exact restore', lateSnapshot);

  const firstExportObserver = fab._exportMenuObserver;
  menu.remove();
  const replacementMenu = harness.create('div', 'experiment-export-menu');
  const replacementItem = harness.create('button', 'experiment-export-menu__item');
  replacementMenu.appendChild(replacementItem);
  document.body.appendChild(replacementMenu);
  document.flushMutations();
  assert.equal(firstExportObserver.disconnected, true, 'replaced export menu observer is released');
  assert.notEqual(fab._exportMenuObserver, firstExportObserver);
  assert.equal(fab._exportMenuObserver.target, replacementMenu);
  assertUnavailable(replacementItem, 'replacement closed export item');

  fab.collapse();
  const pendingHideTimer = Array.from(harness.timers.values()).find(
    (timer) => timer.delay === 450 && !timer.cleared,
  );
  assert.ok(pendingHideTimer);
  const observer = fab._focusObserver;
  const exportObserver = fab._exportMenuObserver;
  fab.hide();
  assert.equal(observer.disconnected, true);
  assert.equal(exportObserver.disconnected, true);
  assert.equal(pendingHideTimer.cleared, true, 'hide clears pending collapse timer');
  harness.runTimer(pendingHideTimer.id);
  assert.equal(fab._collapseTimer, 0);
  assert.equal(document.body.hasAttribute('data-fab-expanded'), false);
  assert.equal(document.body.hasAttribute('data-fab-collapsing'), false);
  assert.equal((document.listeners.get('click') || []).length, 0);
  assert.equal((document.listeners.get('keydown') || []).length, 0);
  assertUnavailable(lateFavorite, 'late favorite after hide');

  const hiddenLifetimeFavorite = harness.create('button', 'favorite-fab');
  const hiddenLifetimeSnapshot = focusSnapshot(hiddenLifetimeFavorite);
  document.body.appendChild(hiddenLifetimeFavorite);
  assert.equal(document.flushMutations(), 0, 'disconnected observers ignore hidden-lifetime additions');
  assertRestored(
    hiddenLifetimeFavorite,
    'hidden-lifetime favorite untouched by old observer',
    hiddenLifetimeSnapshot,
  );

  fab.show();
  const recreatedMain = document.querySelector('.fab-trigger');
  assert.notEqual(recreatedMain, main);
  assert.notEqual(fab._focusObserver, observer);
  assert.notEqual(fab._exportMenuObserver, exportObserver);
  assert.equal(recreatedMain.getAttribute('aria-expanded'), 'false');
  assertUnavailable(lateFavorite, 'late favorite after show rescan');
  assertUnavailable(hiddenLifetimeFavorite, 'hidden-lifetime favorite claimed by new owner');
  const afterReshowFavorite = harness.create('button', 'favorite-fab');
  document.body.appendChild(afterReshowFavorite);
  assertRestored(afterReshowFavorite, 'post-show favorite before async batch');
  document.flushMutations();
  assertUnavailable(afterReshowFavorite, 'post-show favorite managed by new observer');
  fab.hide();
}

(async () => {
  await testActivityClickUsesExactPredictedCommand();
  await testActivityOutcomesAndLeaveAreHonest();
  await testQueuedCommandAcceptsPeerConfirmation();
  await testTrackedPeerConfirmationIsMonotonic();
  await testPeerTabQueueChangesKeepExactEventIdentity();
  await testStartedMustBeUsableBeforeControlsOpen();
  await testAuthorityInvalidatesTrackedCommand();
  await testAuthorityInvalidatesUntrackedDomainRecords();
  await testUntrackedPeerConfirmationIsExactAndMonotonic();
  await testTrackedCommandRetainsQueuedDomainIdentity();
  await testEarlierQueuedDomainIdentityRemainsExact();
  await testQueuedDomainIdentityCapacityResumesExactly();
  await testSharedQueueFullBackpressureWaitsForCapacityRelease();
  await testConfirmedWritesSurviveProjectionRecoveryFailure();
  await testSupersededRecoveryCannotWriteProjection();
  await testDomainCommandBackpressureIsBounded();
  await testAuthorityClearsProjectionImmediately();
  await testClientTransientFailureQueuesAndAutoFlushesExactEvent();
  testFabFocusLifecycle();
  console.log('learning evidence V7.7.10 interaction contract passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
