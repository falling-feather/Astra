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
const moduleSelectorSource = read('shared/js/module-selector.js');
const physicsZoomSource = read('pages/physics/physics-zoom.js');

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
    this.append(scope, status, domainStatus, projection);
    if (this._innerHTML.includes('data-evidence-controls')) {
      const controls = create('div', 'data-evidence-controls');
      controls.hidden = true;
      if (this._innerHTML.includes('data-evidence-command="predicted"')) {
        const prediction = create('select', 'data-evidence-value', 'prediction');
        prediction.value = 'expect-change';
        const predicted = create('button', 'data-evidence-command', 'predicted');
        controls.append(prediction, predicted);
      }
      if (this._innerHTML.includes('data-evidence-command="explained"')) {
        const explanation = create('select', 'data-evidence-value', 'explanation');
        explanation.value = 'claim-supported';
        const explained = create('button', 'data-evidence-command', 'explained');
        controls.append(explanation, explained);
      }
      this.appendChild(controls);
    }
    if (this._innerHTML.includes('data-evidence-free-text')) {
      const freeText = create('textarea', 'data-evidence-free-text');
      const explainedText = create('button', 'data-evidence-command', 'explained-text');
      this.append(freeText, explainedText);
    }
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
    if (normalized.startsWith('.')) {
      return normalized
        .slice(1)
        .split('.')
        .every((className) => this.classList.contains(className));
    }
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
    if (!actual.stopImmediatePropagation) {
      actual.stopImmediatePropagation = () => {
        actual.immediatePropagationStopped = true;
        actual.propagationStopped = true;
      };
    }
    if (!actual.preventDefault) actual.preventDefault = () => { actual.defaultPrevented = true; };
    if (this.ownerDocument) this.ownerDocument._dispatch(actual.type, actual, true);
    let current = this;
    while (current && !actual.propagationStopped) {
      const values = (current.listeners.get(actual.type) || []).slice();
      for (const item of values) {
        item.listener(actual);
        if (item.once) current.removeEventListener(actual.type, item.listener);
        if (actual.immediatePropagationStopped) break;
      }
      if (actual.propagationStopped) break;
      current = current.parentNode;
    }
    if (!actual.propagationStopped && this.ownerDocument) {
      this.ownerDocument._dispatch(actual.type, actual, false);
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
    this.listenerOperations = [];
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

  addEventListener(type, listener, options = false) {
    const capture = options === true || Boolean(options && options.capture);
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ listener, capture });
    this.listenerOperations.push({ action: 'add', type, listener, capture });
  }

  removeEventListener(type, listener, options = false) {
    const capture = options === true || Boolean(options && options.capture);
    const values = this.listeners.get(type) || [];
    this.listeners.set(type, values.filter((value) => (
      value.listener !== listener || value.capture !== capture
    )));
    this.listenerOperations.push({ action: 'remove', type, listener, capture });
  }

  _dispatch(type, event, capture) {
    for (const item of (this.listeners.get(type) || []).slice()) {
      if (item.capture !== capture) continue;
      item.listener(event);
      if (event.immediatePropagationStopped) break;
    }
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
    async record(payload, requestOptions) {
      calls.push({ payload, options: requestOptions });
      emit({
        type: 'syncing',
        state: 'syncing',
        client_event_id: payload.client_event_id,
        event_type: payload.event_type,
        ...payload,
      });
      let result;
      try {
        result = await recordHandler(payload, requestOptions, calls);
        if (options.emitRecordState !== false && result && result.state) {
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
    ...(options.mountOptions || {}),
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
    listenerCount: () => listeners.size,
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

async function testRecoverySkipsDuplicateStartedAndDrainsPending() {
  const recoveredProjection = (status) => ({
    rule_version: 1,
    activities: [{
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
      status,
      first_started_at: '2026-07-29T08:00:00Z',
    }],
  });

  const harness = createActivityHarness(
    (payload) => confirmed(payload),
    {
      recoveryHandler: () => recoveredProjection('in_progress'),
    },
  );
  assert.equal(harness.emitDomain({
    galaxy_key: 'englab',
    activity_key: 'physics.mechanics',
    event_type: 'attempted',
    evidence: {
      operation: 'restitution_adjustment',
      cursor: {
        stage: 'after-observation',
        preset: { restitution: 0.4 },
      },
    },
  }), true, 'a real pending course command must buffer during recovery');
  await waitFor(
    () => harness.calls.some((call) => call.payload.event_type === 'attempted')
      && harness.predictedButton.disabled === false,
    'recovered activity drains the pending command',
  );
  assert.deepEqual(
    harness.calls.map((call) => call.payload.event_type),
    ['attempted'],
    'exact first_started_at recovery must not append started before draining pending work',
  );

  await harness.controller.refresh();
  assert.deepEqual(
    harness.calls.map((call) => call.payload.event_type),
    ['attempted'],
    'same-scope explicit refresh must not append started'
  );

  harness.emit({ type: 'identity-configured' });
  await waitFor(
    () => harness.calls.filter((call) => call.payload.event_type === 'started').length === 1
      && harness.predictedButton.disabled === false,
    'replacement authority writes its own started event',
  );
  assert.deepEqual(
    harness.calls.map((call) => call.payload.event_type),
    ['attempted', 'started'],
    'authority replacement must not inherit the recovered started suppression'
  );
  harness.controller.destroy();

  const completed = createActivityHarness(
    (payload) => {
      throw new Error(`completed recovery must not record ${payload.event_type}`);
    },
    {
      recoveryHandler: () => recoveredProjection('completed'),
    },
  );
  await waitFor(
    () => completed.predictedButton.disabled === false,
    'completed projection recovers without a write',
  );
  assert.deepEqual(completed.calls, [], 'completed recovery must not append started');
  completed.controller.destroy();
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
  const windowListeners = new Map();
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
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const values = windowListeners.get(type) || [];
      windowListeners.set(type, values.filter((value) => value !== listener));
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
    windowListeners,
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

function testFabEscapeStopsModuleOwnerOnSameDocumentTarget() {
  const harness = createFabHarness();
  const { context, document, fab } = harness;
  const page = harness.create('section', 'page page-physics');
  page.id = 'page-physics';
  const module = harness.create('section', 'content-section module-active');
  module.setAttribute('data-module', 'mechanics');
  page.appendChild(module);
  document.body.appendChild(page);
  const gallery = harness.create('div', 'module-gallery');
  gallery.id = 'gallery-physics';
  gallery.style.display = 'none';
  document.body.appendChild(gallery);
  const sidebarToggle = harness.create('button', 'module-sidebar-toggle');
  sidebarToggle.id = 'sidebar-toggle-physics';
  document.body.appendChild(sidebarToggle);
  const favorite = harness.create('button', 'favorite-fab');
  document.body.appendChild(favorite);
  const exportButton = harness.create('button', 'experiment-export-btn');
  document.body.appendChild(exportButton);
  const exportMenu = harness.create('div', 'experiment-export-menu');
  const exportMenuItem = harness.create('button', 'experiment-export-menu__item');
  exportMenu.appendChild(exportMenuItem);
  document.body.appendChild(exportMenu);

  context.location = { hash: '#physics/mechanics' };
  context.history = {
    replaceState(_state, _title, hash) {
      context.location.hash = hash;
    },
  };
  context.Router = { currentPage: 'physics' };
  context.AstraExperimentRegistry = {
    get(pageName, moduleId) {
      return pageName === 'physics' && moduleId === 'mechanics'
        ? { cleanup: { verified: false } }
        : null;
    },
  };
  context.scrollTo = () => {};
  vm.runInContext(moduleSelectorSource, context, { filename: 'shared/js/module-selector.js' });
  const moduleSelector = vm.runInContext('ModuleSelector', context);
  moduleSelector.activeModule.physics = 'mechanics';
  moduleSelector._transitionGeneration.physics = 0;
  moduleSelector._transitionTimers.physics = [];
  moduleSelector._sidebarOpen.physics = false;
  moduleSelector._sidebars.physics = null;

  fab.show();
  const firstFabKeydown = fab._onKeyDown;
  moduleSelector._initKeyboardNav();
  fab.hide();
  assert.equal(
    (document.listeners.get('keydown') || []).length,
    1,
    'hide removes only the first FAB lifetime and leaves the module owner registered',
  );
  const firstFabRemove = document.listenerOperations.find((operation) => (
    operation.action === 'remove'
    && operation.type === 'keydown'
    && operation.listener === firstFabKeydown
  ));
  assert.equal(firstFabRemove?.capture, true, 'the first FAB lifetime removes its capture listener symmetrically');

  fab.show();
  fab.show();
  assert.equal(
    (document.listeners.get('keydown') || []).length,
    2,
    're-show registers one FAB owner alongside the already-registered module owner',
  );
  const keydownOwners = document.listeners.get('keydown') || [];
  assert.equal(
    keydownOwners.filter((owner) => owner.capture).length,
    1,
    'the FAB owner arbitrates Escape in capture phase regardless of registration order',
  );
  assert.equal(
    keydownOwners.filter((owner) => !owner.capture).length,
    1,
    'the real module owner remains a bubble listener',
  );
  const main = document.querySelector('.fab-trigger');
  main.click();

  let exportCloseCalls = 0;
  context.ExperimentExport = {
    _menuOpen: true,
    _closeMenu() {
      exportCloseCalls += 1;
      this._menuOpen = false;
      exportMenu.classList.remove('open');
    },
  };
  exportMenu.classList.add('open');
  document.flushMutations();
  exportMenuItem.focus();
  const exportEscape = {
    type: 'keydown',
    key: 'Escape',
    target: exportMenuItem,
  };
  exportMenuItem.dispatchEvent(exportEscape);
  assert.equal(exportCloseCalls, 1, 'the export owner keeps first priority over dock collapse');
  assert.equal(document.body.getAttribute('data-fab-expanded'), 'true');
  assert.equal(context.location.hash, '#physics/mechanics');
  assert.equal(moduleSelector.activeModule.physics, 'mechanics');
  assert.equal(exportEscape.defaultPrevented, true);
  assert.equal(Boolean(exportEscape.immediatePropagationStopped), false);
  document.flushMutations();

  const guideOverlay = harness.create('div', 'experiment-guide-overlay active');
  guideOverlay.id = 'experiment-guide-overlay';
  const guideAction = harness.create('button', 'experiment-guide-action');
  guideOverlay.appendChild(guideAction);
  document.body.appendChild(guideOverlay);
  let guideDismissCalls = 0;
  guideOverlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    guideDismissCalls += 1;
    event.preventDefault();
    event.stopPropagation();
    guideOverlay.classList.remove('active');
  });
  guideAction.focus();
  const guideEscape = {
    type: 'keydown',
    key: 'Escape',
    target: guideAction,
  };
  guideAction.dispatchEvent(guideEscape);
  assert.equal(guideDismissCalls, 1, 'the guide overlay keeps first priority over dock collapse');
  assert.equal(document.body.getAttribute('data-fab-expanded'), 'true');
  assert.equal(context.location.hash, '#physics/mechanics');
  assert.equal(moduleSelector.activeModule.physics, 'mechanics');
  assert.equal(guideEscape.defaultPrevented, true);
  guideOverlay.remove();

  vm.runInContext(physicsZoomSource, context, { filename: 'pages/physics/physics-zoom.js' });
  const physicsZoom = context.PhysicsZoom;
  const zoomModal = harness.create('div', 'physics-zoom-modal open');
  zoomModal.id = 'physics-zoom-modal';
  const zoomClose = harness.create('button', 'physics-zoom-modal__close');
  zoomModal.appendChild(zoomClose);
  document.body.appendChild(zoomModal);
  physicsZoom.modal = zoomModal;
  physicsZoom.closeBtn = zoomClose;
  let zoomCloseCalls = 0;
  physicsZoom.close = function closeForContract() {
    zoomCloseCalls += 1;
    this.modal.classList.remove('open');
    this._detachModalListeners();
  };
  physicsZoom._attachModalListeners();
  zoomClose.focus();
  const zoomEscape = {
    type: 'keydown',
    key: 'Escape',
    target: zoomClose,
  };
  zoomClose.dispatchEvent(zoomEscape);
  assert.equal(zoomCloseCalls, 1, 'the real zoom key owner keeps first priority over dock collapse');
  assert.equal(document.body.getAttribute('data-fab-expanded'), 'true');
  assert.equal(context.location.hash, '#physics/mechanics');
  assert.equal(moduleSelector.activeModule.physics, 'mechanics');
  assert.equal(zoomEscape.defaultPrevented, true);
  assert.equal(zoomEscape.immediatePropagationStopped, true);

  favorite.focus();
  const collapseEscape = {
    type: 'keydown',
    key: 'Escape',
    target: favorite,
  };
  favorite.dispatchEvent(collapseEscape);

  assert.equal(document.body.getAttribute('data-fab-expanded'), 'false');
  assert.equal(document.activeElement, main, 'consumed Escape returns focus to the main FAB');
  assert.equal(context.location.hash, '#physics/mechanics', 'the same Escape must not escape the course route');
  assert.equal(moduleSelector.activeModule.physics, 'mechanics', 'the same Escape keeps the active module');
  assert.equal(collapseEscape.defaultPrevented, true, 'the FAB owner marks its Escape as consumed');
  assert.equal(
    collapseEscape.immediatePropagationStopped,
    true,
    'the FAB owner blocks later listeners registered on the same document target',
  );

  const moduleEscape = {
    type: 'keydown',
    key: 'Escape',
    target: main,
  };
  main.dispatchEvent(moduleEscape);
  assert.equal(context.location.hash, '#physics', 'a later Escape still executes the real module close path');
  assert.equal(moduleSelector.activeModule.physics, null, 'the module owner remains registered and functional');
  assert.equal(moduleEscape.defaultPrevented, true);
  assert.equal(Boolean(moduleEscape.immediatePropagationStopped), false);

  const secondFabKeydown = fab._onKeyDown;
  fab.hide();
  const secondFabRemove = document.listenerOperations.find((operation) => (
    operation.action === 'remove'
    && operation.type === 'keydown'
    && operation.listener === secondFabKeydown
  ));
  assert.equal(secondFabRemove?.capture, true, 'the re-shown FAB removes the same capture registration');
  assert.equal(
    (document.listeners.get('keydown') || []).length,
    1,
    'hiding the re-shown FAB leaves no leaked FAB key owner',
  );
  fab.show();
  const thirdFabKeydown = fab._onKeyDown;
  fab.show();
  assert.equal(
    (document.listeners.get('keydown') || []).filter((owner) => owner.capture).length,
    1,
    'repeated show does not duplicate the capture owner',
  );
  fab.hide();
  const thirdFabRemove = document.listenerOperations.find((operation) => (
    operation.action === 'remove'
    && operation.type === 'keydown'
    && operation.listener === thirdFabKeydown
  ));
  assert.equal(thirdFabRemove?.capture, true, 'the repeated lifecycle keeps add/remove capture options symmetric');
  assert.equal(
    (document.listeners.get('keydown') || []).length,
    1,
    'repeated show/hide does not leak a document key owner',
  );
}

async function testPhysicsStructuredOwnerCommandOptIn() {
  let enabled = false;
  let ownerBusy = false;
  let authorizeCalls = 0;
  let resultCalls = 0;
  let activityController = null;
  const harness = createActivityHarness(
    (payload) => confirmed(payload),
    {
      recoveryHandler: () => ({
        rule_version: 1,
        activities: [{
          course_unit_id: 37,
          activity_key: 'physics.mechanics',
          rule_version: 1,
          status: 'in_progress',
          first_started_at: '2026-08-09T08:00:00Z',
        }],
      }),
      mountOptions: {
        integrated: true,
        structuredOnly: true,
        authorizeAfterRecord: true,
        requireAuthoritativeResult: true,
        commandEnabled: command => command === 'explained' && enabled && !ownerBusy,
        authorizeRecord: async ({ context }) => {
          authorizeCalls += 1;
          return context;
        },
        beforeCommand: ({ event_type }) => {
          if (event_type !== 'explained' || ownerBusy) return null;
          ownerBusy = true;
          return Object.freeze({
            client_event_id: 'physics-explained-fixed',
            owner_generation: 9,
            binding_generation: 17,
            authority_generation: 5,
          });
        },
        onCommandResult: detail => {
          const accepted = activityController.consumeCommandReceipt(detail.receipt, {
            permit: detail.permit,
            result: detail.result,
            evidence: detail.evidence,
            event_type: detail.event_type,
            client_event_id: detail.client_event_id,
            owner_generation: detail.permit.owner_generation,
            binding_generation: detail.permit.binding_generation,
            authority_generation: detail.permit.authority_generation,
          });
          assert.ok(accepted, 'the owner receives a one-use receipt from the actual record operation');
          resultCalls += 1;
          ownerBusy = false;
        },
        onCommandError: () => { ownerBusy = false; },
      },
    }
  );
  activityController = harness.controller;
  await harness.controller.ready();
  assert.equal(harness.freeText, null, 'structuredOnly must remove the online free-text shortcut');
  assert.equal(harness.explainedTextButton, null);
  assert.equal(harness.predictedButton, null, 'integrated Physics keeps prediction in its domain owner');
  assert.equal(harness.explainedButton.disabled, true);
  assert.equal(harness.explainedButton.getAttribute('aria-disabled'), 'true');
  enabled = true;
  harness.controller.refreshCommands();
  assert.equal(harness.explainedButton.disabled, false);
  assert.equal(harness.explainedButton.getAttribute('aria-disabled'), 'false');
  harness.explainedButton.click();
  harness.explainedButton.click();
  await waitFor(() => resultCalls === 1, 'Physics structured explanation result');
  assert.equal(harness.calls.length, 1, 'the atomic owner hook must collapse a double click');
  assert.equal(harness.calls[0].payload.client_event_id, 'physics-explained-fixed');
  assert.equal(harness.calls[0].payload.event_type, 'explained');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls[0].payload.evidence)), {
    artifact: { kind: 'claim-evidence-link', value: 'claim-supported' },
    cursor: { stage: 'explained' },
  });
  assert.equal(authorizeCalls, 2, 'explicit Physics opt-in must authorize before and after the request');
}

function createPhysicsAuthoritativeHarness(recordHandler, options = {}) {
  const mapInstances = [];
  class TrackingMap extends Map {
    constructor(...args) {
      super(...args);
      mapInstances.push(this);
    }
  }
  const results = [];
  const errors = [];
  const authorizeCalls = [];
  let ownerBusy = false;
  let commandId = options.commandId || 'physics-authoritative-fixed';
  let commandEvidence = null;
  let activityController = null;
  const harness = createActivityHarness(recordHandler, {
    Map: TrackingMap,
    emitRecordState: options.emitRecordState,
    recoveryHandler: () => ({
      rule_version: 1,
      activities: [{
        course_unit_id: 37,
        activity_key: 'physics.mechanics',
        rule_version: 1,
        status: 'in_progress',
        first_started_at: '2026-08-09T08:00:00Z',
      }],
    }),
    mountOptions: {
      integrated: true,
      structuredOnly: true,
      reusePendingStarted: true,
      authorizeAfterRecord: true,
      requireAuthoritativeResult: true,
      commandEnabled: command => command === 'explained' && !ownerBusy,
      authorizeRecord: async request => {
        authorizeCalls.push(request);
        if (typeof options.authorizeHandler === 'function') {
          return options.authorizeHandler(request, authorizeCalls.length);
        }
        return request.context;
      },
      beforeCommand: detail => {
        if (detail.event_type !== 'explained' || ownerBusy) return null;
        ownerBusy = true;
        commandEvidence = detail.evidence;
        return Object.freeze({
          client_event_id: commandId,
          owner_generation: 31,
          binding_generation: 37,
          authority_generation: 5,
        });
      },
      onCommandResult: detail => {
        const accepted = activityController.consumeCommandReceipt(detail.receipt, {
          permit: detail.permit,
          result: detail.result,
          evidence: detail.evidence,
          event_type: detail.event_type,
          client_event_id: detail.client_event_id,
          owner_generation: detail.permit.owner_generation,
          binding_generation: detail.permit.binding_generation,
          authority_generation: detail.permit.authority_generation,
        });
        results.push({ detail, accepted });
        ownerBusy = false;
      },
      onCommandError: error => {
        errors.push(error);
        ownerBusy = false;
      },
    },
  });
  activityController = harness.controller;
  return {
    ...harness,
    results,
    errors,
    authorizeCalls,
    get ownerBusy() { return ownerBusy; },
    get commandId() { return commandId; },
    set commandId(value) { commandId = String(value); },
    get commandEvidence() { return commandEvidence; },
    operationTable() {
      assert.equal(mapInstances.length, 1, 'the activity owns one operation identity table');
      return mapInstances[0];
    },
  };
}

function exactPhysicsChange(type, state, clientEventId, overrides = {}) {
  return {
    type,
    state,
    client_event_id: clientEventId,
    event_type: 'explained',
    projection: {
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
      last_event_type: 'explained',
      ...(overrides.projection || {}),
    },
    ...overrides,
  };
}

function createHeldRecordTransport({ honorSignal = false } = {}) {
  const records = [];
  return {
    records,
    handler(payload, requestOptions = {}) {
      const gate = deferred();
      const signal = requestOptions.signal;
      const record = { payload, requestOptions, signal, gate };
      records.push(record);
      if (honorSignal) {
        const rejectCancelled = () => {
          const error = new Error('held transport cancelled');
          error.code = 'cancelled';
          gate.reject(error);
        };
        if (signal && signal.aborted) rejectCancelled();
        else if (signal) signal.addEventListener('abort', rejectCancelled, { once: true });
      }
      return gate.promise;
    },
    resolve(index, result) {
      const record = records[index];
      record.gate.resolve(result || confirmed(record.payload));
    },
  };
}

function createCountingAbortSource() {
  const listeners = new Set();
  let removeCalls = 0;
  const signal = {
    aborted: false,
    addEventListener(type, listener) {
      if (type === 'abort') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type !== 'abort') return;
      removeCalls += 1;
      listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      const pending = [...listeners];
      listeners.clear();
      pending.forEach(listener => listener({ type: 'abort', target: signal }));
    },
    listenerCount: () => listeners.size,
    removeCalls: () => removeCalls,
  };
}

function captureDisposition(promise) {
  const disposition = { value: null };
  promise.then(
    value => { disposition.value = { outcome: 'resolved', value }; },
    error => { disposition.value = { outcome: 'rejected', error }; },
  );
  return disposition;
}

function armSameIdentityReentry(harness, change, evidence, clientEventId) {
  let disposition = null;
  let attempts = 0;
  const unsubscribe = harness.client.subscribe(value => {
    if (value !== change || attempts) return;
    attempts += 1;
    disposition = captureDisposition(harness.controller.record('explained', evidence, {
      client_event_id: clientEventId,
    }));
  });
  return {
    unsubscribe,
    attempts: () => attempts,
    disposition: () => disposition,
  };
}

function earlyTerminalVariant(kind, clientEventId) {
  if (kind === 'confirmed') {
    return {
      change: exactPhysicsChange('confirmed', 'confirmed', clientEventId),
      expected: { outcome: 'resolved', result: 'confirmed' },
    };
  }
  if (kind === 'manual') {
    return {
      change: exactPhysicsChange('manual-intervention', 'manual-intervention', clientEventId),
      expected: { outcome: 'resolved', result: 'manual-intervention' },
    };
  }
  return {
    change: exactPhysicsChange('manual-intervention', 'confirmed', clientEventId),
    expected: { outcome: 'rejected', result: 'evidence_terminal_invalid' },
  };
}

function queuedFor(record) {
  return {
    outcome: 'queued',
    state: 'local-pending',
    client_event_id: record.payload.client_event_id,
    event_type: record.payload.event_type,
  };
}

function assertTerminalDisposition(disposition, expected) {
  assert.ok(disposition && disposition.value, 'the first record must settle once');
  assert.equal(disposition.value.outcome, expected.outcome);
  if (expected.outcome === 'resolved') {
    assert.equal(disposition.value.value.outcome, expected.result);
  } else {
    assert.equal(disposition.value.error.code, expected.result);
  }
}

async function testPhysicsEarlyTerminalCannotReleaseAuthoritativeFence() {
  for (const phase of ['pre-authorize', 'initial-transport']) {
    for (const terminal of ['confirmed', 'manual', 'invalid']) {
      const authorization = deferred();
      const transport = createHeldRecordTransport();
      const clientEventId = `physics-${phase}-${terminal}`;
      const harness = createPhysicsAuthoritativeHarness(
        transport.handler,
        {
          emitRecordState: false,
          commandId: clientEventId,
          authorizeHandler: phase === 'pre-authorize'
            ? (request, callNumber) => (callNumber === 1 ? authorization.promise : request.context)
            : undefined,
        },
      );
      await harness.controller.ready();
      const evidence = { cursor: { stage: 'explained' } };
      const first = captureDisposition(harness.controller.record('explained', evidence, {
        client_event_id: clientEventId,
      }));
      if (phase === 'pre-authorize') {
        await waitFor(() => harness.authorizeCalls.length === 1, `${phase} ${terminal} authorization held`);
        assert.equal(harness.calls.length, 0);
      } else {
        await waitFor(() => harness.calls.length === 1, `${phase} ${terminal} transport held`);
      }
      assert.equal(harness.operationTable().size, 1);

      const variant = earlyTerminalVariant(terminal, clientEventId);
      const reentry = armSameIdentityReentry(harness, variant.change, evidence, clientEventId);
      harness.emit(variant.change);
      await settle();
      assert.equal(reentry.attempts(), 1, 'the peer subscriber must run in the same notification stack');
      assert.equal(
        harness.calls.length,
        phase === 'pre-authorize' ? 0 : 1,
        'an exact early terminal cannot admit a second real transport',
      );
      assert.ok(reentry.disposition() && reentry.disposition().value);
      assert.equal(reentry.disposition().value.outcome, 'rejected');
      assert.equal(reentry.disposition().value.error.code, 'evidence_operation_in_flight');
      assert.equal(harness.operationTable().size, 1, 'the first outer record remains the fence owner');
      reentry.unsubscribe();

      if (phase === 'pre-authorize') {
        authorization.resolve(harness.authorizeCalls[0].context);
        await waitFor(() => harness.calls.length === 1, `${phase} ${terminal} first transport`);
      }
      transport.resolve(0, queuedFor(transport.records[0]));
      await waitFor(() => first.value !== null, `${phase} ${terminal} first settlement`);
      assertTerminalDisposition(first, variant.expected);
      assert.equal(harness.operationTable().size, 0);

      const retry = captureDisposition(harness.controller.record('explained', evidence, {
        client_event_id: clientEventId,
      }));
      await waitFor(() => harness.calls.length === 2, `${phase} ${terminal} safe retry`);
      transport.resolve(1);
      await waitFor(() => retry.value !== null, `${phase} ${terminal} retry settlement`);
      assert.equal(retry.value.outcome, 'resolved');
      assert.equal(retry.value.value.outcome, 'confirmed');
      assert.equal(harness.operationTable().size, 0);
      harness.controller.destroy();
      assert.equal(harness.listenerCount(), 0);
    }
  }
}

async function testPhysicsEarlyTerminalCancellationSettlesOnce() {
  const unhandled = [];
  const onUnhandled = reason => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const cases = [
      {
        ending: 'destroy',
        terminal: 'confirmed',
        lateResult: record => queuedFor(record),
      },
      {
        ending: 'authority-cleared',
        terminal: 'manual',
        lateResult: record => confirmed(record.payload),
      },
    ];
    for (const item of cases) {
      const transport = createHeldRecordTransport();
      const clientEventId = `physics-early-${item.ending}`;
      const harness = createPhysicsAuthoritativeHarness(
        transport.handler,
        { emitRecordState: false, commandId: clientEventId },
      );
      await harness.controller.ready();
      harness.controller.refreshCommands();
      harness.explainedButton.click();
      await waitFor(() => harness.calls.length === 1 && harness.ownerBusy, `${item.ending} early terminal held`);
      const evidence = harness.calls[0].payload.evidence;
      const variant = earlyTerminalVariant(item.terminal, clientEventId);
      const reentry = armSameIdentityReentry(harness, variant.change, evidence, clientEventId);
      harness.emit(variant.change);
      await settle();
      assert.equal(reentry.disposition().value.outcome, 'rejected');
      assert.equal(reentry.disposition().value.error.code, 'evidence_operation_in_flight');
      assert.equal(harness.calls.length, 1);
      assert.equal(harness.operationTable().size, 1);
      reentry.unsubscribe();

      if (item.ending === 'destroy') harness.controller.destroy();
      else harness.emit({ type: 'authority-cleared' });
      await waitFor(() => harness.errors.length === 1, `${item.ending} early terminal cancellation`);
      assert.equal(harness.errors[0].code, 'cancelled');
      assert.equal(harness.results.length, 0);
      assert.equal(harness.ownerBusy, false);
      assert.equal(harness.operationTable().size, 0);
      transport.resolve(0, item.lateResult(transport.records[0]));
      await settle();
      assert.equal(harness.errors.length, 1, 'late transport cannot call the owner twice');
      assert.equal(harness.results.length, 0, 'late transport cannot mint a receipt');
      if (item.ending === 'authority-cleared') harness.controller.destroy();
      assert.equal(harness.listenerCount(), 0);
    }

    const callerTransport = createHeldRecordTransport();
    const caller = createPhysicsAuthoritativeHarness(
      callerTransport.handler,
      { emitRecordState: false, commandId: 'physics-early-caller' },
    );
    await caller.controller.ready();
    const source = createCountingAbortSource();
    const evidence = { cursor: { stage: 'explained' } };
    const first = captureDisposition(caller.controller.record('explained', evidence, {
      client_event_id: 'physics-early-caller',
      signal: source.signal,
    }));
    await waitFor(() => caller.calls.length === 1, 'caller early terminal held');
    const variant = earlyTerminalVariant('invalid', 'physics-early-caller');
    const reentry = armSameIdentityReentry(caller, variant.change, evidence, 'physics-early-caller');
    caller.emit(variant.change);
    await settle();
    assert.equal(reentry.disposition().value.outcome, 'rejected');
    assert.equal(reentry.disposition().value.error.code, 'evidence_operation_in_flight');
    assert.equal(caller.calls.length, 1);
    assert.equal(caller.operationTable().size, 1);
    reentry.unsubscribe();
    source.abort();
    await waitFor(() => first.value !== null, 'caller early terminal cancellation');
    assert.equal(first.value.outcome, 'rejected');
    assert.equal(first.value.error.code, 'cancelled');
    assert.equal(source.listenerCount(), 0);
    assert.equal(caller.operationTable().size, 0);
    callerTransport.resolve(0, {
      outcome: 'manual-intervention',
      state: 'manual-intervention',
      client_event_id: 'physics-early-caller',
      event_type: 'explained',
    });
    await settle();
    assert.equal(first.value.error.code, 'cancelled');
    caller.controller.destroy();
    assert.equal(caller.listenerCount(), 0);

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'early terminal cancellation cannot leak unhandled rejections');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

async function testPhysicsHeldAuthorizationLifecycleIsCancellable() {
  const unhandled = [];
  const onUnhandled = reason => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const ending of ['destroy', 'authority-cleared']) {
      const authorization = deferred();
      const harness = createPhysicsAuthoritativeHarness(
        async payload => confirmed(payload),
        {
          emitRecordState: false,
          commandId: `physics-held-authorize-${ending}`,
          authorizeHandler: (request, callNumber) => (
            callNumber === 1 ? authorization.promise : request.context
          ),
        },
      );
      await harness.controller.ready();
      harness.controller.refreshCommands();
      harness.explainedButton.click();
      await waitFor(
        () => harness.authorizeCalls.length === 1 && harness.ownerBusy,
        `${ending} held initial authorization`,
      );
      const authorizationSignal = harness.authorizeCalls[0].signal;
      assert.ok(authorizationSignal, 'initial authorization receives the composed request signal');
      assert.equal(authorizationSignal.aborted, false);
      assert.equal(harness.operationTable().size, 1, 'identity fence exists before authorization settles');
      assert.equal(harness.calls.length, 0, 'held authorization cannot enter client.record');

      if (ending === 'destroy') harness.controller.destroy();
      else harness.emit({ type: 'authority-cleared' });
      await waitFor(() => harness.errors.length === 1, `${ending} authorization cancellation`);
      assert.equal(authorizationSignal.aborted, true);
      assert.equal(harness.errors[0].code, 'cancelled');
      assert.equal(harness.results.length, 0);
      assert.equal(harness.calls.length, 0);
      assert.equal(harness.ownerBusy, false);
      assert.equal(harness.explainedButton.disabled, true);
      assert.equal(harness.operationTable().size, 0);

      authorization.resolve(harness.authorizeCalls[0].context);
      await settle();
      assert.equal(harness.calls.length, 0, 'late authorization cannot start a record');
      assert.equal(harness.results.length, 0, 'late authorization cannot mint a receipt');
      assert.equal(harness.errors.length, 1, 'late authorization cannot call the owner twice');
      if (ending === 'authority-cleared') harness.controller.destroy();
      assert.equal(harness.listenerCount(), 0);
    }

    const authorization = deferred();
    const caller = createPhysicsAuthoritativeHarness(
      async payload => confirmed(payload),
      {
        emitRecordState: false,
        commandId: 'physics-held-authorize-caller',
        authorizeHandler: (request, callNumber) => (
          callNumber === 1 ? authorization.promise : request.context
        ),
      },
    );
    await caller.controller.ready();
    const callerSource = createCountingAbortSource();
    const evidence = { cursor: { stage: 'explained' } };
    const first = captureDisposition(caller.controller.record('explained', evidence, {
      client_event_id: 'physics-held-authorize-caller',
      signal: callerSource.signal,
    }));
    await waitFor(() => caller.authorizeCalls.length === 1, 'caller-held initial authorization');
    const mergedSignal = caller.authorizeCalls[0].signal;
    assert.ok(mergedSignal && mergedSignal !== callerSource.signal);
    assert.equal(caller.operationTable().size, 1);

    const duplicate = captureDisposition(caller.controller.record('explained', evidence, {
      client_event_id: 'physics-held-authorize-caller',
    }));
    await waitFor(() => duplicate.value !== null, 'held authorization duplicate rejection');
    assert.equal(duplicate.value.outcome, 'rejected');
    assert.equal(duplicate.value.error.code, 'evidence_operation_in_flight');
    assert.equal(caller.authorizeCalls.length, 1, 'duplicate is fenced before a second authorization');
    assert.equal(caller.calls.length, 0);

    callerSource.abort();
    await waitFor(() => first.value !== null, 'caller abort settles held authorization');
    assert.equal(first.value.outcome, 'rejected');
    assert.equal(first.value.error.code, 'cancelled');
    assert.equal(mergedSignal.aborted, true);
    assert.equal(callerSource.listenerCount(), 0);
    assert.equal(callerSource.removeCalls(), 1);
    assert.equal(caller.operationTable().size, 0);
    assert.equal(caller.calls.length, 0);
    authorization.resolve(caller.authorizeCalls[0].context);
    await settle();
    assert.equal(caller.calls.length, 0);
    assert.equal(caller.results.length, 0);
    caller.controller.destroy();
    assert.equal(caller.listenerCount(), 0);

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'authorization cancellation cannot leak unhandled rejections');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

async function testPhysicsInitialTransportFenceSurvivesQueueLoss() {
  for (const reason of ['expired-pruned', 'removed']) {
    const transport = createHeldRecordTransport();
    const harness = createPhysicsAuthoritativeHarness(
      transport.handler,
      { emitRecordState: false, commandId: `physics-initial-${reason}` },
    );
    await harness.controller.ready();
    harness.controller.refreshCommands();
    harness.explainedButton.click();
    await waitFor(() => harness.calls.length === 1 && harness.ownerBusy, `${reason} held initial transport`);
    const original = harness.calls[0];
    assert.equal(harness.operationTable().size, 1);
    harness.emit(exactPhysicsChange('confirmed', 'confirmed', 'wrong-initial-id'));
    harness.emit(exactPhysicsChange('confirmed', 'confirmed', original.payload.client_event_id, {
      event_type: 'corrected',
    }));
    harness.emit({ type: 'removed', state: 'removed' });
    harness.emit({ type: 'queue-capacity-released', reason });
    await settle();
    assert.equal(harness.errors.length, 0, 'queue loss cannot release an initial transport prematurely');
    assert.equal(harness.results.length, 0);
    assert.equal(harness.ownerBusy, true);
    assert.equal(original.options.signal.aborted, false);
    assert.equal(harness.operationTable().size, 1, 'initial transport keeps its identity fence');

    const duplicate = captureDisposition(harness.controller.record(
      original.payload.event_type,
      original.payload.evidence,
      { client_event_id: original.payload.client_event_id },
    ));
    await waitFor(() => duplicate.value !== null, `${reason} initial duplicate rejection`);
    assert.equal(duplicate.value.outcome, 'rejected');
    assert.equal(duplicate.value.error.code, 'evidence_operation_in_flight');
    assert.equal(harness.calls.length, 1, 'same identity cannot start a second real transport');

    transport.resolve(0, {
      outcome: 'queued',
      state: 'local-pending',
      client_event_id: original.payload.client_event_id,
      event_type: original.payload.event_type,
    });
    await waitFor(() => harness.errors.length === 1, `${reason} queued result consumes latched queue loss`);
    assert.equal(harness.errors[0].code, 'evidence_pending_unavailable');
    assert.equal(harness.ownerBusy, false);
    assert.equal(harness.operationTable().size, 0);
    assert.equal(harness.results.length, 0);

    harness.explainedButton.click();
    await waitFor(() => harness.calls.length === 2, `${reason} safe retry transport`);
    assert.equal(harness.calls[1].payload.client_event_id, original.payload.client_event_id);
    transport.resolve(1);
    await waitFor(() => harness.results.length === 1, `${reason} safe retry confirmation`);
    assert.ok(harness.results[0].accepted);
    assert.equal(harness.operationTable().size, 0);
    harness.controller.destroy();
    assert.equal(harness.listenerCount(), 0);
  }

  const sameTickTransport = createHeldRecordTransport();
  const sameTick = createPhysicsAuthoritativeHarness(
    sameTickTransport.handler,
    { emitRecordState: false, commandId: 'physics-initial-queue-loss-same-tick' },
  );
  await sameTick.controller.ready();
  sameTick.controller.refreshCommands();
  sameTick.explainedButton.click();
  await waitFor(() => sameTick.calls.length === 1 && sameTick.ownerBusy, 'same-tick initial transport');
  const request = sameTick.calls[0];
  sameTickTransport.resolve(0, {
    outcome: 'queued',
    state: 'local-pending',
    client_event_id: request.payload.client_event_id,
    event_type: request.payload.event_type,
  });
  sameTick.emit({ type: 'queue-capacity-released', reason: 'removed' });
  await waitFor(() => sameTick.errors.length === 1, 'same-tick queued queue-loss settlement');
  assert.equal(sameTick.errors[0].code, 'evidence_pending_unavailable');
  assert.equal(sameTick.results.length, 0);
  assert.equal(sameTick.ownerBusy, false);
  assert.equal(sameTick.operationTable().size, 0);
  sameTick.controller.destroy();
  assert.equal(sameTick.listenerCount(), 0);
}

async function testPhysicsHeldRecordLifecycleIsCancellable() {
  const unhandled = [];
  const onUnhandled = reason => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const destroyTransport = createHeldRecordTransport();
    const destroyed = createPhysicsAuthoritativeHarness(
      destroyTransport.handler,
      { emitRecordState: false, commandId: 'physics-held-destroy' },
    );
    await destroyed.controller.ready();
    destroyed.controller.refreshCommands();
    destroyed.explainedButton.click();
    await waitFor(() => destroyed.calls.length === 1 && destroyed.ownerBusy, 'held record before destroy');
    const destroySignal = destroyed.calls[0].options.signal;
    assert.ok(destroySignal, 'the evidence client receives a session-bound request signal');
    assert.equal(destroySignal.aborted, false);
    destroyed.controller.destroy();
    await waitFor(() => destroyed.errors.length === 1, 'held record destroy cancellation');
    assert.equal(destroySignal.aborted, true);
    assert.equal(destroyed.results.length, 0);
    assert.equal(destroyed.errors[0].code, 'cancelled');
    assert.equal(destroyed.ownerBusy, false);
    assert.equal(destroyed.explainedButton.disabled, true);
    assert.equal(destroyed.operationTable().size, 0);
    assert.equal(destroyed.listenerCount(), 0);
    assert.equal(destroyed.completions.length, 0, 'an ignoring transport can remain held without holding the activity chain');
    destroyTransport.resolve(0);
    await settle();
    assert.equal(destroyed.completions.length, 1, 'the ignored late transport may finish only inside the stub');
    assert.equal(destroyed.results.length, 0, 'late confirmed cannot mint a receipt after destroy');
    assert.equal(destroyed.errors.length, 1, 'late confirmed cannot call the owner twice');

    const authorityTransport = createHeldRecordTransport({ honorSignal: true });
    const revoked = createPhysicsAuthoritativeHarness(
      authorityTransport.handler,
      { emitRecordState: false, commandId: 'physics-held-authority' },
    );
    await revoked.controller.ready();
    revoked.controller.refreshCommands();
    revoked.explainedButton.click();
    await waitFor(() => revoked.calls.length === 1 && revoked.ownerBusy, 'first held authority request');
    const secondDisposition = { value: null };
    revoked.controller.record('corrected', { cursor: { stage: 'corrected' } }, {
      client_event_id: 'physics-held-authority-second',
    }).then(
      value => { secondDisposition.value = { outcome: 'resolved', value }; },
      error => { secondDisposition.value = { outcome: 'rejected', error }; },
    );
    await waitFor(() => revoked.calls.length === 2, 'second held authority request');
    const authoritySignals = revoked.calls.map(call => call.options.signal);
    assert.ok(authoritySignals.every(signal => signal && !signal.aborted));
    assert.equal(revoked.operationTable().size, 2);
    revoked.emit({ type: 'authority-cleared' });
    await waitFor(
      () => revoked.errors.length === 1 && secondDisposition.value !== null,
      'all held authority requests cancelled',
    );
    assert.ok(authoritySignals.every(signal => signal.aborted));
    assert.equal(revoked.results.length, 0);
    assert.equal(revoked.errors[0].code, 'cancelled');
    assert.equal(revoked.ownerBusy, false);
    assert.equal(revoked.operationTable().size, 0);
    assert.equal(secondDisposition.value.outcome, 'resolved');
    assert.equal(secondDisposition.value.value.outcome, 'cancelled');
    assert.equal(revoked.completions.length, 2, 'a signal-aware client terminates both transports');
    revoked.controller.destroy();
    assert.equal(revoked.listenerCount(), 0);

    const callerTransport = createHeldRecordTransport();
    const caller = createPhysicsAuthoritativeHarness(
      callerTransport.handler,
      { emitRecordState: false, commandId: 'physics-held-caller' },
    );
    await caller.controller.ready();
    const callerSource = createCountingAbortSource();
    const callerDispositions = Array.from({ length: 3 }, () => ({ value: null }));
    callerDispositions.forEach((disposition, index) => {
      caller.controller.record('explained', { cursor: { stage: 'explained' } }, {
        client_event_id: `physics-held-caller-${index + 1}`,
        signal: callerSource.signal,
      }).then(
        value => { disposition.value = { outcome: 'resolved', value }; },
        error => { disposition.value = { outcome: 'rejected', error }; },
      );
    });
    await waitFor(() => caller.calls.length === 3, 'held caller requests');
    const mergedCallerSignals = caller.calls.map(call => call.options.signal);
    assert.ok(mergedCallerSignals.every(signal => signal));
    assert.ok(mergedCallerSignals.every(signal => signal !== callerSource.signal), 'caller signal is composed, not discarded or passed alone');
    callerSource.abort();
    await waitFor(() => callerDispositions.every(item => item.value !== null), 'caller cancellation');
    assert.equal(callerSource.signal.aborted, true);
    assert.ok(mergedCallerSignals.every(signal => signal.aborted));
    callerDispositions.forEach(disposition => {
      assert.equal(disposition.value.outcome, 'rejected');
      assert.equal(disposition.value.error.code, 'cancelled');
    });
    assert.equal(caller.operationTable().size, 0);
    assert.equal(callerSource.listenerCount(), 0);
    assert.equal(callerSource.removeCalls(), 3, 'each composed caller listener is removed after settlement');
    callerTransport.resolve(0, confirmed(callerTransport.records[0].payload));
    callerTransport.resolve(1, {
      outcome: 'queued',
      state: 'local-pending',
      client_event_id: callerTransport.records[1].payload.client_event_id,
      event_type: callerTransport.records[1].payload.event_type,
    });
    callerTransport.resolve(2, {
      outcome: 'manual-intervention',
      state: 'manual-intervention',
      client_event_id: callerTransport.records[2].payload.client_event_id,
      event_type: callerTransport.records[2].payload.event_type,
    });
    await settle();
    assert.ok(callerDispositions.every(item => item.value.outcome === 'rejected'), 'late confirmed/queued/manual cannot replace caller cancellation');
    caller.controller.destroy();
    assert.equal(caller.listenerCount(), 0);

    const raceTransport = createHeldRecordTransport();
    const raced = createPhysicsAuthoritativeHarness(
      raceTransport.handler,
      { emitRecordState: false, commandId: 'physics-held-race' },
    );
    await raced.controller.ready();
    raced.controller.refreshCommands();
    raced.explainedButton.click();
    await waitFor(() => raced.calls.length === 1 && raced.ownerBusy, 'held same-tick race');
    const raceSignal = raced.calls[0].options.signal;
    raceTransport.resolve(0);
    raced.controller.destroy();
    await waitFor(() => raced.errors.length === 1, 'same-tick resolve/destroy cancellation');
    assert.equal(raceSignal.aborted, true);
    assert.equal(raced.results.length, 0);
    assert.equal(raced.errors[0].code, 'cancelled');
    assert.equal(raced.ownerBusy, false);
    assert.equal(raced.operationTable().size, 0);
    assert.equal(raced.listenerCount(), 0);
    await settle();
    assert.equal(raced.results.length, 0, 'same-tick confirmed remains stale after destroy');

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'held request cancellation cannot leak unhandled rejections');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

async function testPhysicsAuthoritativeIdentityCannotBeOverwritten() {
  const harness = createPhysicsAuthoritativeHarness(
    async payload => ({
      outcome: 'queued',
      state: 'local-pending',
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
    }),
    { emitRecordState: false, commandId: 'physics-same-operation' },
  );
  await harness.controller.ready();
  harness.controller.refreshCommands();
  harness.explainedButton.click();
  await waitFor(() => harness.calls.length === 1 && harness.ownerBusy, 'first authoritative operation');
  assert.equal(harness.operationTable().size, 1);
  const duplicateState = { value: null };
  harness.controller.record('explained', harness.commandEvidence, {
    client_event_id: harness.commandId,
  }).then(
    value => { duplicateState.value = { outcome: 'resolved', value }; },
    error => { duplicateState.value = { outcome: 'rejected', error }; },
  );
  await waitFor(
    () => duplicateState.value !== null || harness.calls.length > 1,
    'duplicate authoritative disposition',
  );
  assert.equal(harness.calls.length, 1, 'same identity cannot start or overwrite a second real record');
  assert.equal(duplicateState.value.outcome, 'rejected');
  assert.equal(duplicateState.value.error.code, 'evidence_operation_in_flight');
  assert.equal(harness.operationTable().size, 1, 'the first waiter remains addressable');
  harness.emit(exactPhysicsChange('confirmed', 'confirmed', harness.commandId));
  await waitFor(() => harness.results.length === 1, 'first waiter exact confirmation');
  assert.ok(harness.results[0].accepted);
  assert.equal(harness.ownerBusy, false);
  assert.equal(harness.explainedButton.disabled, false);
  assert.equal(harness.operationTable().size, 0);
  harness.controller.destroy();
  assert.equal(harness.listenerCount(), 0);
}

async function testPhysicsAuthoritativeResultDtoIsBound() {
  const scenarios = [
    ['wrong client id', payload => ({ ...confirmed(payload), client_event_id: `${payload.client_event_id}-wrong` })],
    ['missing client id', payload => {
      const result = confirmed(payload);
      delete result.client_event_id;
      return result;
    }],
    ['wrong event type', payload => ({ ...confirmed(payload), event_type: 'corrected' })],
    ['missing event type', payload => {
      const result = confirmed(payload);
      delete result.event_type;
      return result;
    }],
    ['contradictory outcome/state', payload => ({
      outcome: 'queued',
      state: 'confirmed',
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
    })],
  ];
  for (const [label, invalidResult] of scenarios) {
    let attempt = 0;
    const harness = createPhysicsAuthoritativeHarness(
      async payload => attempt++ === 0 ? invalidResult(payload) : confirmed(payload),
      { emitRecordState: false, commandId: `physics-dto-${label.replace(/\s+/g, '-')}` },
    );
    await harness.controller.ready();
    harness.controller.refreshCommands();
    harness.explainedButton.click();
    await waitFor(
      () => harness.errors.length === 1 || harness.results.length === 1,
      `${label} rejection`,
    );
    assert.equal(harness.results.length, 0, `${label} cannot mint a receipt`);
    assert.equal(harness.errors.length, 1);
    assert.match(harness.errors[0].code, /^evidence_result_/);
    assert.equal(harness.ownerBusy, false);
    assert.equal(harness.explainedButton.disabled, false);
    assert.equal(harness.operationTable().size, 0);
    const firstId = harness.calls[0].payload.client_event_id;
    harness.explainedButton.click();
    await waitFor(() => harness.results.length === 1, `${label} correct retry`);
    assert.ok(harness.results[0].accepted);
    assert.equal(harness.calls[1].payload.client_event_id, firstId, `${label} retry keeps the client id`);
    assert.equal(harness.operationTable().size, 0);
    harness.controller.destroy();
    assert.equal(harness.listenerCount(), 0);
  }

  const reconciled = createPhysicsAuthoritativeHarness(
    async payload => ({
      outcome: 'reconciled',
      state: 'confirmed',
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
    }),
    { emitRecordState: false, commandId: 'physics-dto-reconciled' },
  );
  await reconciled.controller.ready();
  reconciled.controller.refreshCommands();
  reconciled.explainedButton.click();
  await waitFor(() => reconciled.results.length === 1, 'consistent reconciled result');
  assert.ok(reconciled.results[0].accepted);
  assert.equal(reconciled.results[0].accepted.result.outcome, 'reconciled');
  reconciled.controller.destroy();
  assert.equal(reconciled.listenerCount(), 0);
}

async function testPhysicsAuthoritativeTerminalMatrixIsStrict() {
  const contradictions = [
    ['manual with confirmed state', 'manual-intervention', 'confirmed'],
    ['confirmed with manual state', 'confirmed', 'manual-intervention'],
    ['state-changed with confirmed state', 'state-changed', 'confirmed'],
    ['unknown terminal', 'unexpected-terminal', 'unexpected-state'],
  ];
  for (const [label, type, state] of contradictions) {
    let queued = true;
    const harness = createPhysicsAuthoritativeHarness(
      async payload => queued
        ? {
            outcome: 'queued',
            state: 'local-pending',
            client_event_id: payload.client_event_id,
            event_type: payload.event_type,
          }
        : confirmed(payload),
      { emitRecordState: false, commandId: `physics-terminal-${type}` },
    );
    await harness.controller.ready();
    harness.controller.refreshCommands();
    harness.explainedButton.click();
    await waitFor(() => harness.calls.length === 1 && harness.ownerBusy, `${label} queued`);
    harness.emit(exactPhysicsChange(type, state, harness.commandId));
    await waitFor(
      () => harness.errors.length === 1 || harness.results.length === 1,
      `${label} disposition`,
    );
    assert.equal(harness.results.length, 0, `${label} cannot confirm the waiter`);
    assert.equal(harness.errors[0].code, 'evidence_terminal_invalid');
    assert.equal(harness.operationTable().size, 0);
    assert.equal(harness.ownerBusy, false);
    assert.equal(harness.explainedButton.disabled, false);
    queued = false;
    harness.explainedButton.click();
    await waitFor(() => harness.results.length === 1, `${label} retry`);
    assert.ok(harness.results[0].accepted);
    assert.equal(harness.calls[1].payload.client_event_id, harness.calls[0].payload.client_event_id);
    harness.controller.destroy();
    assert.equal(harness.listenerCount(), 0);
  }

  const reconciled = createPhysicsAuthoritativeHarness(
    async payload => ({
      outcome: 'queued',
      state: 'local-pending',
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
    }),
    { emitRecordState: false, commandId: 'physics-terminal-reconciled' },
  );
  await reconciled.controller.ready();
  reconciled.controller.refreshCommands();
  reconciled.explainedButton.click();
  await waitFor(() => reconciled.calls.length === 1 && reconciled.ownerBusy, 'reconciled terminal queued');
  reconciled.emit(exactPhysicsChange('reconciled', 'confirmed', reconciled.commandId));
  await waitFor(() => reconciled.results.length === 1, 'consistent reconciled peer terminal');
  assert.ok(reconciled.results[0].accepted);
  assert.equal(reconciled.operationTable().size, 0);
  reconciled.controller.destroy();
  assert.equal(reconciled.listenerCount(), 0);

  const mismatched = createPhysicsAuthoritativeHarness(
    async payload => ({
      outcome: 'queued',
      state: 'local-pending',
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
    }),
    { emitRecordState: false, commandId: 'physics-terminal-mismatch' },
  );
  await mismatched.controller.ready();
  mismatched.controller.refreshCommands();
  mismatched.explainedButton.click();
  await waitFor(() => mismatched.calls.length === 1 && mismatched.ownerBusy, 'mismatched terminal queued');
  mismatched.emit(exactPhysicsChange('confirmed', 'confirmed', mismatched.commandId, {
    projection: { course_id: 99 },
  }));
  mismatched.emit(exactPhysicsChange('confirmed', 'confirmed', mismatched.commandId, {
    event_type: 'corrected',
  }));
  await settle();
  assert.equal(mismatched.results.length, 0);
  assert.equal(mismatched.errors.length, 0);
  assert.equal(mismatched.operationTable().size, 1, 'wrong scope/type cannot consume the exact waiter');
  mismatched.controller.destroy();
  await waitFor(() => mismatched.errors.length === 1, 'mismatched waiter destroy cancellation');
  assert.equal(mismatched.errors[0].code, 'cancelled');
  assert.equal(mismatched.operationTable().size, 0);
  assert.equal(mismatched.ownerBusy, false);
  assert.equal(mismatched.listenerCount(), 0);
}

async function testPhysicsAuthoritativeWaitersReleaseOnQueueLoss() {
  for (const reason of ['expired-pruned', 'removed']) {
    let queued = true;
    const harness = createPhysicsAuthoritativeHarness(
      async payload => queued
        ? {
            outcome: 'queued',
            state: 'local-pending',
            client_event_id: payload.client_event_id,
            event_type: payload.event_type,
          }
        : confirmed(payload),
      { emitRecordState: false, commandId: `physics-queue-${reason}` },
    );
    await harness.controller.ready();
    harness.controller.refreshCommands();
    harness.explainedButton.click();
    await waitFor(() => harness.calls.length === 1 && harness.ownerBusy, `${reason} queued`);
    const originalId = harness.calls[0].payload.client_event_id;
    const queueLoss = { type: 'queue-capacity-released', reason };
    const reentry = armSameIdentityReentry(
      harness,
      queueLoss,
      harness.calls[0].payload.evidence,
      originalId,
    );
    harness.emit(queueLoss);
    await settle();
    assert.equal(reentry.disposition().value.outcome, 'rejected');
    assert.equal(reentry.disposition().value.error.code, 'evidence_operation_in_flight');
    assert.equal(harness.calls.length, 1, 'queue-loss subscriber cannot release the fence in its own stack');
    reentry.unsubscribe();
    await waitFor(() => harness.errors.length === 1, `${reason} waiter release`);
    assert.equal(harness.results.length, 0);
    assert.equal(harness.errors[0].code, 'evidence_pending_unavailable');
    assert.equal(harness.operationTable().size, 0);
    assert.equal(harness.ownerBusy, false);
    assert.equal(harness.explainedButton.disabled, false);
    queued = false;
    harness.explainedButton.click();
    await waitFor(() => harness.results.length === 1, `${reason} safe retry`);
    assert.equal(harness.calls[1].payload.client_event_id, originalId);
    assert.ok(harness.results[0].accepted);
    harness.controller.destroy();
    assert.equal(harness.listenerCount(), 0);
  }

  for (const ending of ['authority-cleared', 'destroy']) {
    const harness = createPhysicsAuthoritativeHarness(
      async payload => ({
        outcome: 'queued',
        state: 'local-pending',
        client_event_id: payload.client_event_id,
        event_type: payload.event_type,
      }),
      { emitRecordState: false, commandId: `physics-ending-${ending}` },
    );
    await harness.controller.ready();
    harness.controller.refreshCommands();
    harness.explainedButton.click();
    await waitFor(() => harness.calls.length === 1 && harness.ownerBusy, `${ending} queued`);
    if (ending === 'authority-cleared') harness.emit({ type: 'authority-cleared' });
    else harness.controller.destroy();
    await waitFor(() => harness.errors.length === 1, `${ending} waiter cancellation`);
    assert.equal(harness.results.length, 0);
    assert.equal(harness.errors[0].code, 'cancelled');
    assert.equal(harness.operationTable().size, 0);
    assert.equal(harness.ownerBusy, false);
    assert.equal(harness.explainedButton.disabled, true);
    if (ending === 'authority-cleared') harness.controller.destroy();
    assert.equal(harness.listenerCount(), 0);
  }
}

async function testPhysicsAuthoritativeResultWaitsForPeerTerminal() {
  let ownerBusy = false;
  let resultCalls = 0;
  let errorCalls = 0;
  let lastError = null;
  let commandId = 'physics-explained-queued';
  const acceptedRecords = [];
  let activityController = null;
  const harness = createActivityHarness(
    async payload => ({
      outcome: 'queued',
      state: 'local-pending',
      client_event_id: payload.client_event_id,
      event_type: payload.event_type,
    }),
    {
      recoveryHandler: () => ({
        rule_version: 1,
        activities: [{
          course_unit_id: 37,
          activity_key: 'physics.mechanics',
          rule_version: 1,
          status: 'in_progress',
          first_started_at: '2026-08-09T08:00:00Z',
        }],
      }),
      mountOptions: {
        integrated: true,
        structuredOnly: true,
        reusePendingStarted: true,
        authorizeAfterRecord: true,
        requireAuthoritativeResult: true,
        commandEnabled: command => command === 'explained' && !ownerBusy,
        authorizeRecord: async ({ context }) => context,
        beforeCommand: ({ event_type }) => {
          if (event_type !== 'explained' || ownerBusy) return null;
          ownerBusy = true;
          return Object.freeze({
            client_event_id: commandId,
            owner_generation: 11,
            binding_generation: 19,
            authority_generation: 5,
          });
        },
        onCommandResult: detail => {
          acceptedRecords.push(activityController.consumeCommandReceipt(detail.receipt, {
            permit: detail.permit,
            result: detail.result,
            evidence: detail.evidence,
            event_type: detail.event_type,
            client_event_id: detail.client_event_id,
            owner_generation: detail.permit.owner_generation,
            binding_generation: detail.permit.binding_generation,
            authority_generation: detail.permit.authority_generation,
          }));
          resultCalls += 1;
          ownerBusy = false;
        },
        onCommandError: error => {
          errorCalls += 1;
          lastError = error;
          ownerBusy = false;
        },
      },
    }
  );
  activityController = harness.controller;
  await harness.controller.ready();
  harness.controller.refreshCommands();
  harness.explainedButton.click();
  await waitFor(() => harness.calls.length === 1, 'Physics queued explanation record');
  await waitFor(
    () => harness.statusNode.dataset.evidenceState === 'local-pending',
    'Physics queued explanation status'
  );
  assert.equal(resultCalls, 0, 'local-pending cannot reach the Physics completion callback');
  assert.equal(harness.explainedButton.disabled, true, 'the same queued command remains in flight');

  harness.emit({
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: 'physics-explained-queued',
    event_type: 'explained',
    projection: {
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
      last_event_type: 'explained',
    },
  });
  await waitFor(() => resultCalls === 1, 'Physics peer terminal explanation result');
  assert.ok(acceptedRecords[0], 'the exact peer terminal resolves the original record operation');
  assert.equal(acceptedRecords[0].client_event_id, 'physics-explained-queued');
  harness.emit({
    type: 'confirmed',
    state: 'confirmed',
    client_event_id: 'physics-explained-queued',
    event_type: 'explained',
    projection: {
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
      last_event_type: 'explained',
    },
  });
  await Promise.resolve();
  assert.equal(resultCalls, 1, 'duplicate peer terminal cannot complete the owner twice');

  commandId = 'physics-explained-manual';
  harness.controller.refreshCommands();
  harness.explainedButton.click();
  await waitFor(() => harness.calls.length === 2, 'Physics manual explanation record');
  harness.emit({
    type: 'manual-intervention',
    state: 'manual-intervention',
    client_event_id: commandId,
    event_type: 'explained',
    projection: {
      class_id: 41,
      course_id: 13,
      course_unit_id: 37,
      activity_key: 'physics.mechanics',
      rule_version: 1,
      last_event_type: 'explained',
    },
  });
  await waitFor(() => resultCalls === 2, 'Physics peer manual explanation result');
  assert.equal(acceptedRecords[1].result.outcome, 'manual-intervention');
  assert.equal(acceptedRecords[1].result.state, 'manual-intervention');

  commandId = 'physics-explained-stale';
  harness.controller.refreshCommands();
  harness.explainedButton.click();
  await waitFor(() => harness.calls.length === 3, 'Physics stale explanation record');
  harness.emit({ type: 'identity-configured' });
  await waitFor(() => errorCalls === 1, 'Physics queued identity invalidation');
  assert.equal(resultCalls, 2, 'identity invalidation cannot mint an authoritative receipt');
  assert.equal(lastError && lastError.code, 'cancelled');
  harness.controller.destroy();
}

(async () => {
  await testRecoverySkipsDuplicateStartedAndDrainsPending();
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
  await testPhysicsStructuredOwnerCommandOptIn();
  await testPhysicsEarlyTerminalCannotReleaseAuthoritativeFence();
  await testPhysicsEarlyTerminalCancellationSettlesOnce();
  await testPhysicsHeldAuthorizationLifecycleIsCancellable();
  await testPhysicsInitialTransportFenceSurvivesQueueLoss();
  await testPhysicsHeldRecordLifecycleIsCancellable();
  await testPhysicsAuthoritativeIdentityCannotBeOverwritten();
  await testPhysicsAuthoritativeResultDtoIsBound();
  await testPhysicsAuthoritativeTerminalMatrixIsStrict();
  await testPhysicsAuthoritativeWaitersReleaseOnQueueLoss();
  await testPhysicsAuthoritativeResultWaitsForPeerTerminal();
  testFabFocusLifecycle();
  testFabEscapeStopsModuleOwnerOnSameDocumentTarget();
  console.log('learning evidence V7.7.10 interaction contract passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
