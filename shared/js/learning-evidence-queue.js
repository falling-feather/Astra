(function (global) {
    'use strict';

    if (global.AstraLearningEvidenceQueue) return;

    const DB_NAME = 'astra-learning-evidence';
    const DB_VERSION = 1;
    const EVENT_STORE = 'events';
    const LEASE_STORE = 'leases';
    const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const MAX_EVENTS = 256;
    const MAX_BYTES = 1024 * 1024;
    const MAX_EVIDENCE_BYTES = 16 * 1024;
    const MAX_EVENT_BYTES = 32 * 1024;
    const LEASE_MS = 12 * 1000;
    const EVENT_TYPES = new Set(['started', 'predicted', 'attempted', 'corrected', 'explained']);
    const CLIENT_EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
    const ACTIVITY_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
    const EVENT_FIELDS = Object.freeze({
        started: new Set(['cursor']),
        predicted: new Set(['prediction', 'cursor']),
        attempted: new Set(['operation', 'reported_correct', 'cursor']),
        corrected: new Set(['correction', 'cursor']),
        explained: new Set(['artifact', 'cursor'])
    });
    const ALLOWED_STATES = new Set([
        'local-pending',
        'syncing',
        'manual-intervention'
    ]);
    const OFFLINE_ENUM_VALUES = new Set([
        'englab', 'code-space', 'future-galaxy',
        'entered', 'predicted', 'explained', 'before-browser-precheck', 'after-repair',
        'after-observation',
        'expect-change', 'expect-stable', 'prediction-recorded',
        'claim-evidence-link', 'claim-supported', 'claim-needs-review',
        'browser_precheck', 'runner_unavailable', 'browser_precheck_finished',
        'formal_oj_submission', 'judge_result_received', 'judge_result_unconfirmed',
        'code-revision', 'public-check-pass', 'public-check-needs-review',
        'gravity_adjustment', 'restitution_adjustment', 'friction_adjustment',
        'radius_adjustment', 'simulation_launch', 'simulation-revision',
        'gravity', 'restitution', 'friction', 'radius',
        'low', 'medium', 'high', 'small', 'large',
        'B', 'C', 'D', 'tension', 'compression', 'zero',
        'more-balanced', 'more-unbalanced', 'no-change', 'insufficient',
        'absolute-increase', 'absolute-decrease', 'run-fixed-load-case',
        'load-redistributes-by-equilibrium', 'equilibrium-redistribution',
        'single-load-path', 'color-means-compression', 'no-redistribution',
        'ideal-2d-pin-jointed-truss', 'load-path-conclusion',
        'joint-equilibrium-redistribution', 'b-c-reactions-gh-cd',
        'ideal-truss-not-safety'
    ]);
    const FORBIDDEN_NORMALIZED_KEY = /(?:authorization|credential|password|secret|token|cookie|email|phone|username|accountname|displayname|studentname|teachername|userid|accountid|studentid|teacherid|subjectuserid|actorid|memberid|personid|apikey|sessionid|sessionkey|accesskey|clientsecret|grade|score|mark|comment|feedback|source(?:code)?|fullanswer|answertext|freetext|pagesnapshot|html|screenshot)/;
    const encoder = new TextEncoder();
    const listeners = new Set();
    const ownerId = global.crypto && typeof global.crypto.randomUUID === 'function'
        ? global.crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const channel = typeof global.BroadcastChannel === 'function'
        ? new global.BroadcastChannel('astra-learning-evidence')
        : null;

    let databasePromise = null;
    let activeNamespace = '';
    let authorityEpoch = 0;
    let peerAuthorityEpoch = 0;
    let configuringCount = 0;

    function queueError(code, message, details) {
        const error = new Error(message || code);
        error.name = 'AstraLearningEvidenceQueueError';
        error.code = code;
        error.details = details || null;
        return error;
    }

    function requestResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || queueError('indexeddb_request_failed'));
        });
    }

    function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error || queueError('indexeddb_transaction_aborted'));
            transaction.onerror = () => reject(transaction.error || queueError('indexeddb_transaction_failed'));
        });
    }

    function openDatabase() {
        if (databasePromise) return databasePromise;
        if (!global.indexedDB) {
            return Promise.reject(queueError('indexeddb_unavailable', '当前浏览器无法保存待同步学习证据，请联网后重试。'));
        }
        databasePromise = new Promise((resolve, reject) => {
            const request = global.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(EVENT_STORE)) {
                    const events = db.createObjectStore(EVENT_STORE, { keyPath: 'key' });
                    events.createIndex('namespace', 'namespace', { unique: false });
                    events.createIndex('expires_at', 'expires_at', { unique: false });
                }
                if (!db.objectStoreNames.contains(LEASE_STORE)) {
                    db.createObjectStore(LEASE_STORE, { keyPath: 'namespace' });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    databasePromise = null;
                };
                resolve(db);
            };
            request.onerror = () => {
                databasePromise = null;
                reject(request.error || queueError('indexeddb_open_failed'));
            };
            request.onblocked = () => {
                databasePromise = null;
                reject(queueError('indexeddb_upgrade_blocked'));
            };
        });
        return databasePromise;
    }

    function stableValue(value) {
        if (Array.isArray(value)) return value.map(stableValue);
        if (value && typeof value === 'object') {
            return Object.keys(value).sort().reduce((result, key) => {
                result[key] = stableValue(value[key]);
                return result;
            }, {});
        }
        return value;
    }

    function stableJson(value) {
        return JSON.stringify(stableValue(value));
    }

    function normalizedEvidenceKey(value) {
        return String(value || '')
            .normalize('NFKC')
            .replace(/[^a-z0-9]/gi, '')
            .toLowerCase();
    }

    async function sha256(value) {
        if (!global.crypto || !global.crypto.subtle) {
            throw queueError('crypto_unavailable', '当前环境无法建立安全的本地证据命名空间。');
        }
        const digest = await global.crypto.subtle.digest('SHA-256', encoder.encode(value));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function byteLength(value) {
        return encoder.encode(typeof value === 'string' ? value : stableJson(value)).byteLength;
    }

    function measuredRecordBytes(record) {
        const copy = Object.assign({}, record);
        let measured = 0;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            copy.bytes = measured;
            const next = byteLength(copy);
            if (next === measured) return next;
            measured = next;
        }
        copy.bytes = measured;
        return byteLength(copy);
    }

    function exactPositiveInteger(value, field) {
        if (!Number.isInteger(value) || value <= 0) {
            throw queueError('invalid_event', `学习证据缺少有效的 ${field}。`, { field });
        }
        return value;
    }

    function isPlainObject(value) {
        if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === null || Object.getPrototypeOf(prototype) === null;
    }

    function validOccurredAt(value) {
        if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return false;
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return false;
        const year = date.getUTCFullYear();
        return year >= 1000 && year <= 9999;
    }

    function assertFactArtifact(value, field, maxLength) {
        if (typeof value === 'string') {
            const normalized = value.trim();
            if (!normalized || normalized.length > maxLength) {
                throw queueError('invalid_evidence', `${field} 必须是非空且有界的字符串。`, { field });
            }
            return;
        }
        if ((Array.isArray(value) || isPlainObject(value))
            && Object.keys(value).length > 0) return;
        throw queueError('invalid_evidence', `${field} 必须是非空结构。`, { field });
    }

    function assertEvidenceContract(eventType, evidence) {
        if (!isPlainObject(evidence)) {
            throw queueError('invalid_evidence', '学习证据必须是普通对象。');
        }
        const allowedFields = EVENT_FIELDS[eventType];
        const unknown = Object.keys(evidence).filter(key => !allowedFields.has(key));
        if (unknown.length) {
            throw queueError('invalid_evidence', '学习证据包含未登记字段。', { fields: unknown });
        }
        if ('cursor' in evidence && (
            !evidence.cursor
            || !isPlainObject(evidence.cursor)
            || Object.keys(evidence.cursor).length === 0
        )) {
            throw queueError('invalid_evidence', 'evidence.cursor 必须是非空对象。', { field: 'cursor' });
        }
        if (eventType === 'predicted') assertFactArtifact(evidence.prediction, 'prediction', 2000);
        if (eventType === 'attempted') {
            const operation = evidence.operation;
            if (typeof operation !== 'string' || !operation.trim() || operation.trim().length > 80) {
                throw queueError('invalid_evidence', 'attempted.operation 必须是 1—80 个字符。', { field: 'operation' });
            }
            if ('reported_correct' in evidence && typeof evidence.reported_correct !== 'boolean') {
                throw queueError('invalid_evidence', 'reported_correct 必须是布尔值。', { field: 'reported_correct' });
            }
        }
        if (eventType === 'corrected') assertFactArtifact(evidence.correction, 'correction', 4000);
        if (eventType === 'explained') assertFactArtifact(evidence.artifact, 'artifact', 8000);
    }

    function assertBoundedStructured(value, path, depth) {
        const currentPath = path || 'evidence';
        const currentDepth = depth || 0;
        if (currentDepth > 6) throw queueError('evidence_too_deep', '待同步证据结构过深。', { path: currentPath });
        if (value === null || typeof value === 'boolean') return;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw queueError('evidence_not_finite', '待同步证据不能包含 NaN 或 Infinity。', { path: currentPath });
            return;
        }
        if (typeof value === 'string') {
            if (!OFFLINE_ENUM_VALUES.has(value)) {
                throw queueError('evidence_enum_not_queueable', '待同步证据字符串必须是前端合同登记的稳定枚举；其他文本只能联网提交。', {
                    path: currentPath
                });
            }
            return;
        }
        if (Array.isArray(value)) {
            if (value.length > 32) throw queueError('evidence_too_large', '待同步证据数组超出上限。', { path: currentPath });
            value.forEach((item, index) => assertBoundedStructured(item, `${currentPath}[${index}]`, currentDepth + 1));
            return;
        }
        if (!isPlainObject(value)) {
            throw queueError('evidence_not_structured', '仅可暂存有界结构化证据。', { path: currentPath });
        }
        const keys = Object.keys(value);
        if (keys.length > 32) throw queueError('evidence_too_large', '待同步证据字段超出上限。', { path: currentPath });
        keys.forEach(key => {
            if (FORBIDDEN_NORMALIZED_KEY.test(normalizedEvidenceKey(key))) {
                throw queueError('sensitive_evidence_rejected', '该证据包含禁止离线保存的字段，必须联网提交。', { path: `${currentPath}.${key}` });
            }
            assertBoundedStructured(value[key], `${currentPath}.${key}`, currentDepth + 1);
        });
    }

    function assertReplayPayload(payload) {
        if (!isPlainObject(payload)) {
            throw queueError('invalid_event', '学习证据事件格式无效。');
        }
        const allowed = new Set([
            'client_event_id', 'class_id', 'course_id', 'course_unit_id', 'assignment_id',
            'activity_key', 'rule_version', 'event_type', 'evidence', 'occurred_at'
        ]);
        const unknown = Object.keys(payload).filter(key => !allowed.has(key));
        if (unknown.length) throw queueError('invalid_event', '学习证据事件包含未登记字段。', { fields: unknown });
        const required = [
            'client_event_id',
            'class_id',
            'course_id',
            'course_unit_id',
            'activity_key',
            'rule_version',
            'event_type',
            'evidence',
            'occurred_at'
        ];
        required.forEach(key => {
            if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
                throw queueError('invalid_event', `学习证据缺少 ${key}。`, { field: key });
            }
        });
        if (payload.event_type === 'completed' || payload.event_type === 'transferred') {
            throw queueError('server_projection_only', '完成与迁移状态只能由服务端投影。');
        }
        if (!EVENT_TYPES.has(payload.event_type)) {
            throw queueError('invalid_event_type', '学习证据事件类型未登记。');
        }
        if (!CLIENT_EVENT_ID_PATTERN.test(payload.client_event_id)) {
            throw queueError('invalid_event', 'client_event_id 不符合稳定标识合同。', { field: 'client_event_id' });
        }
        exactPositiveInteger(payload.class_id, 'class_id');
        exactPositiveInteger(payload.course_id, 'course_id');
        exactPositiveInteger(payload.course_unit_id, 'course_unit_id');
        exactPositiveInteger(payload.rule_version, 'rule_version');
        if (payload.assignment_id !== undefined && payload.assignment_id !== null) {
            exactPositiveInteger(payload.assignment_id, 'assignment_id');
        }
        if (
            typeof payload.activity_key !== 'string'
            || payload.activity_key.length > 120
            || !ACTIVITY_KEY_PATTERN.test(payload.activity_key)
        ) {
            throw queueError('invalid_event', 'activity_key 必须是稳定小写分段键。', { field: 'activity_key' });
        }
        if (!validOccurredAt(payload.occurred_at)) {
            throw queueError('invalid_event', 'occurred_at 必须含时区且处于支持范围。', { field: 'occurred_at' });
        }
        assertEvidenceContract(payload.event_type, payload.evidence);
        if (payload.event_type === 'explained' && containsFreeText(payload.evidence.artifact, 'artifact')) {
            throw queueError('evidence_text_not_queueable', '自由文本解释必须联网提交，不能写入本地队列。');
        }
        assertBoundedStructured(payload.evidence, 'evidence', 0);
        if (byteLength(payload.evidence) > MAX_EVIDENCE_BYTES) {
            throw queueError('evidence_too_large', '单条 evidence 超过 16 KiB 服务端上限。');
        }
        if (byteLength(payload) > MAX_EVENT_BYTES) {
            throw queueError('event_too_large', '单条待同步证据超过 32 KiB 上限。');
        }
    }

    function containsFreeText(value, key) {
        if (typeof value === 'string') {
            return /(?:text|explanation|comment|answer|narrative|free.?text)/i.test(String(key || ''))
                || !/^[a-z0-9_.:/-]{1,80}$/i.test(value);
        }
        if (Array.isArray(value)) return value.some(item => containsFreeText(item, key));
        if (value && typeof value === 'object') {
            return Object.entries(value).some(([childKey, child]) => containsFreeText(child, childKey));
        }
        return false;
    }

    function eventProjection(payload) {
        if (!payload) return null;
        const eventType = String(payload.event_type || '');
        if (!EVENT_TYPES.has(eventType)) return null;
        return Object.freeze({
            class_id: payload.class_id,
            course_id: payload.course_id,
            course_unit_id: payload.course_unit_id,
            activity_key: payload.activity_key,
            rule_version: payload.rule_version,
            event_type: eventType
        });
    }

    function peerChange(detail) {
        if (!detail) return null;
        if (detail.type === 'authority-cleared') {
            return Object.freeze({
                type: 'authority-cleared',
                namespace: String(detail.namespace || '')
            });
        }
        if (!['enqueued', 'state-changed', 'confirmed'].includes(detail.type) || !detail.projection) {
            return null;
        }
        const projection = eventProjection(detail.projection);
        if (!projection) return null;
        return Object.freeze({
            type: detail.type,
            namespace: String(detail.namespace || ''),
            client_event_id: String(detail.client_event_id || ''),
            state: detail.state,
            projection
        });
    }

    function emit(change) {
        const detail = Object.freeze(Object.assign({
            namespace: activeNamespace,
            source: 'queue'
        }, change || {}));
        listeners.forEach(listener => {
            try {
                listener(detail);
            } catch (error) {
                global.console && global.console.error('[LearningEvidenceQueue] listener failed', error);
            }
        });
        const peerDetail = peerChange(detail);
        if (channel && peerDetail) channel.postMessage(peerDetail);
    }

    function receivePeerChange(detail) {
        detail = peerChange(detail);
        if (!detail) return;
        const authorityClear = detail.type === 'authority-cleared';
        if (
            detail.namespace
            && detail.namespace !== activeNamespace
            && !(authorityClear && configuringCount > 0)
        ) return;
        if (authorityClear) {
            activeNamespace = '';
            authorityEpoch += 1;
            peerAuthorityEpoch += 1;
            clearStoredAuthorityData().catch(error => {
                global.console && global.console.warn('[LearningEvidenceQueue] peer clear failed', error.code || error.message);
            });
        }
        listeners.forEach(listener => {
            try {
                listener(Object.freeze(Object.assign({}, detail, { source: 'peer-tab' })));
            } catch (error) {
                global.console && global.console.error('[LearningEvidenceQueue] peer listener failed', error);
            }
        });
    }

    if (channel) {
        channel.addEventListener('message', event => {
            receivePeerChange(event.data);
        });
    }

    async function deleteOtherNamespaces(namespace) {
        const db = await openDatabase();
        const transaction = db.transaction([EVENT_STORE, LEASE_STORE], 'readwrite');
        const events = transaction.objectStore(EVENT_STORE);
        const leases = transaction.objectStore(LEASE_STORE);
        const eventCursor = events.openCursor();
        eventCursor.onsuccess = () => {
            const cursor = eventCursor.result;
            if (!cursor) return;
            if (cursor.value.namespace !== namespace) cursor.delete();
            cursor.continue();
        };
        const leaseCursor = leases.openCursor();
        leaseCursor.onsuccess = () => {
            const cursor = leaseCursor.result;
            if (!cursor) return;
            if (cursor.value.namespace !== namespace) cursor.delete();
            cursor.continue();
        };
        await transactionDone(transaction);
    }

    async function configureIdentity(identity) {
        const accountId = identity && (identity.id || identity.user_id || identity.account_id);
        const role = identity && identity.role;
        if (accountId === undefined || accountId === null || !String(role || '').trim()) {
            await clearAuthority();
            throw queueError('identity_required', '登录身份未就绪，不能保存学习证据。');
        }
        const configurePeerEpoch = peerAuthorityEpoch;
        configuringCount += 1;
        try {
            const namespace = await sha256(`${global.location.origin}\n${String(accountId)}\n${String(role).toLowerCase()}`);
            if (peerAuthorityEpoch !== configurePeerEpoch) {
                throw queueError('identity_required', '身份配置已被另一个标签页撤销。');
            }
            if (activeNamespace && activeNamespace !== namespace) await clearAuthority();
            if (peerAuthorityEpoch !== configurePeerEpoch) {
                throw queueError('identity_required', '身份配置已被另一个标签页撤销。');
            }
            if (activeNamespace !== namespace) {
                activeNamespace = namespace;
                authorityEpoch += 1;
            }
            const configureEpoch = authorityEpoch;
            await deleteOtherNamespaces(namespace);
            if (
                activeNamespace !== namespace
                || authorityEpoch !== configureEpoch
                || peerAuthorityEpoch !== configurePeerEpoch
            ) {
                throw queueError('identity_required', '身份配置已被另一个标签页撤销。');
            }
            await purgeExpired();
            if (
                activeNamespace !== namespace
                || authorityEpoch !== configureEpoch
                || peerAuthorityEpoch !== configurePeerEpoch
            ) {
                throw queueError('identity_required', '身份配置已被另一个标签页撤销。');
            }
            emit({ type: 'identity-configured' });
            return namespace;
        } finally {
            configuringCount = Math.max(0, configuringCount - 1);
        }
    }

    function requireNamespace() {
        if (!activeNamespace) throw queueError('identity_required', '登录身份未就绪，不能访问本地证据队列。');
        return activeNamespace;
    }

    async function recordsForNamespace(namespace) {
        const db = await openDatabase();
        const transaction = db.transaction(EVENT_STORE, 'readonly');
        const index = transaction.objectStore(EVENT_STORE).index('namespace');
        const records = await requestResult(index.getAll(namespace));
        await transactionDone(transaction);
        return records || [];
    }

    async function purgeExpired() {
        if (!activeNamespace) return 0;
        const namespace = activeNamespace;
        const now = Date.now();
        const records = await recordsForNamespace(namespace);
        const expired = records.filter(record => Number(record.expires_at) <= now);
        if (!expired.length) return 0;
        const db = await openDatabase();
        const transaction = db.transaction(EVENT_STORE, 'readwrite');
        const store = transaction.objectStore(EVENT_STORE);
        expired.forEach(record => store.delete(record.key));
        await transactionDone(transaction);
        emit({ type: 'expired-pruned', count: expired.length });
        return expired.length;
    }

    async function enqueue(payload) {
        const namespace = requireNamespace();
        const enqueueEpoch = authorityEpoch;
        assertReplayPayload(payload);
        await purgeExpired();
        const requestHash = await sha256(stableJson(payload));
        if (activeNamespace !== namespace || authorityEpoch !== enqueueEpoch) {
            throw queueError('identity_required', '登录身份已变化，不能保存旧身份的学习证据。');
        }
        const key = `${namespace}:${payload.client_event_id}`;
        const now = Date.now();
        const db = await openDatabase();
        const writeTransaction = db.transaction(EVENT_STORE, 'readwrite');
        const store = writeTransaction.objectStore(EVENT_STORE);
        const existingRequest = store.get(key);
        const recordsRequest = store.index('namespace').getAll(namespace);
        const [existing, records] = await Promise.all([
            requestResult(existingRequest),
            requestResult(recordsRequest)
        ]);
        if (activeNamespace !== namespace || authorityEpoch !== enqueueEpoch) {
            writeTransaction.abort();
            throw queueError('identity_required', '登录身份已变化，不能保存旧身份的学习证据。');
        }
        if (existing) {
            await transactionDone(writeTransaction);
            if (existing.request_hash !== requestHash) {
                throw queueError('client_event_id_conflict', '相同 client_event_id 不能对应不同证据。');
            }
            return Object.freeze(Object.assign({}, existing));
        }
        const record = {
            key,
            namespace,
            client_event_id: payload.client_event_id,
            request_hash: requestHash,
            payload: stableValue(payload),
            state: 'local-pending',
            attempts: 0,
            created_at: now,
            updated_at: now,
            next_attempt_at: now,
            expires_at: now + MAX_AGE_MS,
            bytes: 0,
            last_error: null
        };
        record.bytes = measuredRecordBytes(record);
        const totalBytes = records.reduce((total, item) => total + measuredRecordBytes(item), 0);
        if (records.length >= MAX_EVENTS || totalBytes + record.bytes > MAX_BYTES) {
            await transactionDone(writeTransaction);
            throw queueError('queue_limit_reached', '待同步证据已达本机上限，请联网完成同步后继续。', {
                count: records.length,
                bytes: totalBytes
            });
        }
        let constrained = false;
        const addRequest = store.add(record);
        addRequest.onerror = event => {
            if (addRequest.error && addRequest.error.name === 'ConstraintError') {
                constrained = true;
                event.preventDefault();
                event.stopPropagation();
            }
        };
        await transactionDone(writeTransaction);
        if (constrained) {
            const winner = await get(payload.client_event_id);
            if (winner && winner.request_hash === requestHash) return winner;
            throw queueError('client_event_id_conflict', '相同 client_event_id 不能对应不同证据。');
        }
        emit({
            type: 'enqueued',
            client_event_id: payload.client_event_id,
            state: record.state,
            projection: eventProjection(record.payload)
        });
        return Object.freeze(Object.assign({}, record));
    }

    async function list(options) {
        const namespace = requireNamespace();
        await purgeExpired();
        const settings = options || {};
        const now = Date.now();
        return (await recordsForNamespace(namespace))
            .filter(record => !settings.dueOnly || Number(record.next_attempt_at || 0) <= now)
            .filter(record => !settings.states || settings.states.includes(record.state))
            .sort((left, right) => left.created_at - right.created_at)
            .map(record => Object.freeze(Object.assign({}, record)));
    }

    async function get(clientEventId) {
        const namespace = requireNamespace();
        const db = await openDatabase();
        const transaction = db.transaction(EVENT_STORE, 'readonly');
        const record = await requestResult(transaction.objectStore(EVENT_STORE).get(`${namespace}:${clientEventId}`));
        await transactionDone(transaction);
        return record ? Object.freeze(Object.assign({}, record)) : null;
    }

    async function updateState(clientEventId, state, details) {
        if (!ALLOWED_STATES.has(state)) throw queueError('invalid_queue_state', `不支持的队列状态：${state}`);
        const namespace = requireNamespace();
        const updateEpoch = authorityEpoch;
        const db = await openDatabase();
        const transaction = db.transaction(EVENT_STORE, 'readwrite');
        const store = transaction.objectStore(EVENT_STORE);
        const key = `${namespace}:${clientEventId}`;
        const record = await requestResult(store.get(key));
        if (activeNamespace !== namespace || authorityEpoch !== updateEpoch) {
            transaction.abort();
            throw queueError('identity_required', '身份已变化，不能更新旧身份的证据。');
        }
        if (!record) {
            transaction.abort();
            throw queueError('queued_event_not_found', '待同步证据不存在。');
        }
        const data = details || {};
        record.state = state;
        record.updated_at = Date.now();
        if (state === 'syncing') record.attempts = Number(record.attempts || 0) + 1;
        if (data.next_attempt_at !== undefined) record.next_attempt_at = Number(data.next_attempt_at);
        if (data.error !== undefined) record.last_error = data.error === null
            ? null
            : String(data.error).slice(0, 128);
        record.bytes = measuredRecordBytes(record);
        const records = await requestResult(store.index('namespace').getAll(namespace));
        const totalBytes = (records || []).reduce((total, item) => (
            total + (item.key === record.key ? record.bytes : measuredRecordBytes(item))
        ), 0);
        if (totalBytes > MAX_BYTES) {
            transaction.abort();
            throw queueError('queue_limit_reached', '待同步证据已达本机上限，请联网完成同步后继续。', {
                count: records.length,
                bytes: totalBytes
            });
        }
        store.put(record);
        await transactionDone(transaction);
        emit({
            type: 'state-changed',
            client_event_id: clientEventId,
            state,
            projection: eventProjection(record.payload)
        });
        return Object.freeze(Object.assign({}, record));
    }

    async function remove(clientEventId, confirmedReceipt) {
        const namespace = requireNamespace();
        const removeEpoch = authorityEpoch;
        const db = await openDatabase();
        const transaction = db.transaction(EVENT_STORE, 'readwrite');
        const store = transaction.objectStore(EVENT_STORE);
        const key = `${namespace}:${clientEventId}`;
        const record = await requestResult(store.get(key));
        if (activeNamespace !== namespace || authorityEpoch !== removeEpoch) {
            transaction.abort();
            throw queueError('identity_required', '身份已变化，不能删除旧身份的证据。');
        }
        store.delete(key);
        await transactionDone(transaction);
        emit({
            type: confirmedReceipt ? 'confirmed' : 'removed',
            client_event_id: clientEventId,
            state: confirmedReceipt ? 'confirmed' : undefined,
            receipt: confirmedReceipt || null,
            projection: record ? eventProjection(record.payload) : null
        });
    }

    async function stats() {
        if (!activeNamespace) return Object.freeze({ count: 0, bytes: 0, oldest_at: null });
        await purgeExpired();
        const records = await recordsForNamespace(activeNamespace);
        return Object.freeze({
            count: records.length,
            bytes: records.reduce((total, item) => total + measuredRecordBytes(item), 0),
            oldest_at: records.length ? Math.min(...records.map(item => item.created_at)) : null
        });
    }

    async function acquireLease() {
        const namespace = requireNamespace();
        const leaseEpoch = authorityEpoch;
        const db = await openDatabase();
        const transaction = db.transaction(LEASE_STORE, 'readwrite');
        const store = transaction.objectStore(LEASE_STORE);
        const current = await requestResult(store.get(namespace));
        const now = Date.now();
        if (activeNamespace !== namespace || authorityEpoch !== leaseEpoch) {
            transaction.abort();
            throw queueError('identity_required', '身份已变化，不能获取旧身份的同步租约。');
        }
        if (current && current.owner_id !== ownerId && Number(current.expires_at) > now) {
            await transactionDone(transaction);
            return false;
        }
        store.put({ namespace, owner_id: ownerId, expires_at: now + LEASE_MS });
        await transactionDone(transaction);
        emit({ type: 'lease-acquired' });
        return true;
    }

    async function renewLease() {
        if (!activeNamespace) return false;
        const namespace = activeNamespace;
        const leaseEpoch = authorityEpoch;
        const db = await openDatabase();
        const transaction = db.transaction(LEASE_STORE, 'readwrite');
        const store = transaction.objectStore(LEASE_STORE);
        const current = await requestResult(store.get(namespace));
        if (activeNamespace !== namespace || authorityEpoch !== leaseEpoch) {
            transaction.abort();
            return false;
        }
        if (!current || current.owner_id !== ownerId) {
            await transactionDone(transaction);
            return false;
        }
        current.expires_at = Date.now() + LEASE_MS;
        store.put(current);
        await transactionDone(transaction);
        return true;
    }

    async function releaseLease() {
        if (!activeNamespace) return;
        const namespace = activeNamespace;
        const leaseEpoch = authorityEpoch;
        const db = await openDatabase();
        const transaction = db.transaction(LEASE_STORE, 'readwrite');
        const store = transaction.objectStore(LEASE_STORE);
        const current = await requestResult(store.get(namespace));
        if (activeNamespace !== namespace || authorityEpoch !== leaseEpoch) {
            transaction.abort();
            return;
        }
        if (current && current.owner_id === ownerId) store.delete(namespace);
        await transactionDone(transaction);
        emit({ type: 'lease-released' });
    }

    async function clearStoredAuthorityData() {
        const db = await openDatabase();
        const transaction = db.transaction([EVENT_STORE, LEASE_STORE], 'readwrite');
        transaction.objectStore(EVENT_STORE).clear();
        transaction.objectStore(LEASE_STORE).clear();
        await transactionDone(transaction);
    }

    async function clearAuthority() {
        const previousNamespace = activeNamespace;
        activeNamespace = '';
        authorityEpoch += 1;
        await clearStoredAuthorityData();
        emit({ type: 'authority-cleared', namespace: previousNamespace || '' });
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    global.AstraLearningEvidenceQueue = Object.freeze({
        configureIdentity,
        enqueue,
        list,
        get,
        updateState,
        remove,
        stats,
        acquireLease,
        renewLease,
        releaseLease,
        purgeExpired,
        clearAuthority,
        subscribe,
        limits: Object.freeze({
            maxAgeMs: MAX_AGE_MS,
            maxEvents: MAX_EVENTS,
            maxBytes: MAX_BYTES,
            maxEvidenceBytes: MAX_EVIDENCE_BYTES,
            maxBatch: 50
        }),
        offlineEnumValues: Object.freeze(Array.from(OFFLINE_ENUM_VALUES))
    });
})(window);
