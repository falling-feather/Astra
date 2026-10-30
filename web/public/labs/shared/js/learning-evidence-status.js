(function (global) {
    'use strict';

    if (global.AstraLearningEvidenceStatus) return;

    const COPY = Object.freeze({
        'local-pending': Object.freeze({
            label: '尚未同步',
            message: '证据已安全保存在本机，联网后将使用同一事件编号对账。'
        }),
        syncing: Object.freeze({
            label: '正在同步',
            message: '正在与权威学习记录对账，请保持当前页面打开。'
        }),
        confirmed: Object.freeze({
            label: '已确认',
            message: '该证据已由服务端确认。完成与迁移状态以服务端投影为准。'
        }),
        'manual-intervention': Object.freeze({
            label: '需要处理',
            message: '自动对账无法确认这条证据；本页不会伪装重试成功，请联系教师核对。'
        })
    });

    function normalize(value) {
        const state = typeof value === 'string' ? value : value && value.state;
        return COPY[state] ? state : '';
    }

    function render(node, value, options) {
        if (!(node instanceof Element)) return false;
        const state = normalize(value);
        const settings = options || {};
        if (!state) {
            node.hidden = true;
            node.replaceChildren();
            node.removeAttribute('data-evidence-state');
            return true;
        }
        const copy = COPY[state];
        const status = document.createElement('span');
        const label = document.createElement('strong');
        const message = document.createElement('span');
        status.className = 'astra-evidence-status__signal';
        status.setAttribute('aria-hidden', 'true');
        label.textContent = copy.label;
        message.textContent = settings.message || copy.message;
        node.className = `astra-evidence-status astra-evidence-status--${state}`;
        node.dataset.evidenceState = state;
        node.setAttribute('role', state === 'manual-intervention' ? 'alert' : 'status');
        node.setAttribute('aria-live', state === 'manual-intervention' ? 'assertive' : 'polite');
        node.replaceChildren(status, label, message);
        if (settings.retry && state === 'local-pending') {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'astra-evidence-status__retry';
            retry.dataset.evidenceRetry = 'true';
            retry.textContent = '重新对账';
            retry.addEventListener('click', settings.retry);
            node.appendChild(retry);
        }
        node.hidden = false;
        return true;
    }

    global.AstraLearningEvidenceStatus = Object.freeze({
        render,
        copy: COPY,
        states: Object.freeze(Object.keys(COPY))
    });
})(window);
