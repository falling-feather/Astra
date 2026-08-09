(function (global) {
    'use strict';

    if (global.AstraLearningEvidenceClient) return;

    const EVENT_TYPES = new Set(['started', 'predicted', 'attempted', 'corrected', 'explained']);
    const SERVER_PROJECTION_TYPES = new Set(['completed', 'transferred']);
    const DISCOVERABLE_EVENT_TYPES = new Set([...EVENT_TYPES, ...SERVER_PROJECTION_TYPES]);
    const DISCOVERABLE_PRODUCER_TYPES = new Set(['learner', 'trusted_assessment']);
    const WRITE_OUTCOMES = new Set(['accepted', 'duplicate', 'rejected', 'conflict']);
    const CLIENT_EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
    const ACTIVITY_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
    const MAX_EVIDENCE_BYTES = 16 * 1024;
    const PENDING_RECOVERY_LIMIT = 16;
    const PENDING_FORBIDDEN_KEY = /(?:authorization|credential|password|secret|token|cookie|email|phone|username|accountname|displayname|studentname|teachername|userid|accountid|studentid|teacherid|subjectuserid|actorid|memberid|personid|apikey|sessionid|sessionkey|accesskey|clientsecret|grade|score|mark|comment|feedback|source(?:code)?|fullanswer|answertext|freetext|pagesnapshot|html|screenshot)/;
    const EVENT_FIELDS = Object.freeze({
        started: new Set(['cursor']),
        predicted: new Set(['prediction', 'cursor']),
        attempted: new Set(['operation', 'reported_correct', 'cursor']),
        corrected: new Set(['correction', 'cursor']),
        explained: new Set(['artifact', 'cursor'])
    });
    const IDEMPOTENCY_CONFLICTS = new Set(['idempotency_payload_conflict', 'idempotency_scope_mismatch', 'client_event_id_conflict']);
    const API_ROOT = '/api/learning-evidence';
    const listeners = new Set();
    const activityProjection = new Map();
    const confirmedReceipts = new Map();
    const PEER_QUEUE_STATES = new Set([
        'local-pending',
        'syncing',
        'manual-intervention'
    ]);
    let configured = false;
    let flushing = null;
    let destroyed = false;
    let flushTimer = 0;
    let flushDueAt = 0;
    let leaseTimer = 0;
    let flushAbortController = null;
    let queueUnsubscribe = null;
    let authorityClearPromise = null;
    let authorityGeneration = 0;
    let authorityAbortController = null;
    let configuredIdentityKey = '';
    let configuredSubjectId = 0;

    function clientError(code, message, details) {
        const error = new Error(message || code);
        error.name = 'AstraLearningEvidenceClientError';
        error.code = code;
        error.details = details || null;
        return error;
    }

    function api() {
        if (!global.AstraApiClient || typeof global.AstraApiClient.request !== 'function') {
            throw clientError('api_client_unavailable', '共享 API 客户端尚未加载。');
        }
        return global.AstraApiClient;
    }

    function queue() {
        if (!global.AstraLearningEvidenceQueue) {
            throw clientError('evidence_queue_unavailable', '学习证据队列尚未加载。');
        }
        return global.AstraLearningEvidenceQueue;
    }

    function createEventId() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
        return `evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function isoTime(value) {
        const date = value ? new Date(value) : new Date();
        if (!Number.isFinite(date.getTime())) throw clientError('invalid_occurred_at', '学习证据时间无效。');
        const year = date.getUTCFullYear();
        if (year < 1000 || year > 9999) {
            throw clientError('invalid_occurred_at', '学习证据时间必须处于 UTC 1000—9999 年。');
        }
        return date.toISOString();
    }

    function positiveInteger(value, field) {
        if (!Number.isInteger(value) || value <= 0) {
            throw clientError('invalid_scope', `学习证据缺少有效的 ${field}。`, { field });
        }
        return value;
    }

    function validUnicodeScalar(value) {
        for (let index = 0; index < value.length; index += 1) {
            const code = value.charCodeAt(index);
            if (code >= 0xD800 && code <= 0xDBFF) {
                const next = value.charCodeAt(index + 1);
                if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
                index += 1;
            } else if (code >= 0xDC00 && code <= 0xDFFF) {
                return false;
            }
        }
        return true;
    }

    function isPlainObject(value) {
        if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === null || Object.getPrototypeOf(prototype) === null;
    }

    function cloneJson(value, path, seen) {
        const currentPath = path || 'evidence';
        const visited = seen || new Set();
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw clientError('invalid_evidence', `${currentPath} 不能包含 NaN 或 Infinity。`);
            return value;
        }
        if (typeof value === 'string') {
            if (!validUnicodeScalar(value)) throw clientError('invalid_evidence', `${currentPath} 包含无效 Unicode。`);
            return value;
        }
        if (!value || typeof value !== 'object' || visited.has(value)) {
            throw clientError('invalid_evidence', `${currentPath} 必须是可序列化 JSON。`);
        }
        visited.add(value);
        let result;
        if (Array.isArray(value)) {
            result = value.map((item, index) => cloneJson(item, `${currentPath}[${index}]`, visited));
        } else {
            if (!isPlainObject(value)) {
                throw clientError('invalid_evidence', `${currentPath} 必须是普通对象。`);
            }
            result = {};
            Object.keys(value).forEach(key => {
                const item = value[key];
                if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
                    throw clientError('invalid_evidence', `${currentPath}.${key} 不是 JSON 值。`);
                }
                result[key] = cloneJson(item, `${currentPath}.${key}`, visited);
            });
        }
        visited.delete(value);
        return result;
    }

    function deepFreezeJson(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        Object.keys(value).forEach(key => deepFreezeJson(value[key]));
        return Object.freeze(value);
    }

    function containsPendingForbiddenKey(value) {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(containsPendingForbiddenKey);
        return Object.entries(value).some(([key, child]) => (
            PENDING_FORBIDDEN_KEY.test(String(key).normalize('NFKC').replace(/[^a-z0-9]/gi, '').toLowerCase())
            || containsPendingForbiddenKey(child)
        ));
    }

    function assertFactArtifact(value, eventType, field, maxLength) {
        if (typeof value === 'string') {
            const normalized = value.trim();
            if (!normalized || normalized.length > maxLength) {
                throw clientError('invalid_evidence', `${eventType}.${field} 必须是非空且有界的字符串。`, { field });
            }
            return normalized;
        }
        if ((Array.isArray(value) || isPlainObject(value))
            && Object.keys(value).length > 0) return value;
        throw clientError('invalid_evidence', `${eventType}.${field} 必须是非空结构。`, { field });
    }

    function normalizeEvidence(eventType, rawEvidence) {
        const evidence = cloneJson(rawEvidence, 'evidence');
        if (!isPlainObject(evidence)) {
            throw clientError('invalid_evidence', '学习证据必须是结构化对象。');
        }
        const unknown = Object.keys(evidence).filter(key => !EVENT_FIELDS[eventType].has(key));
        if (unknown.length) {
            throw clientError('invalid_evidence', '学习证据包含未登记字段。', { fields: unknown });
        }
        if ('cursor' in evidence && (
            !evidence.cursor
            || Array.isArray(evidence.cursor)
            || !isPlainObject(evidence.cursor)
            || Object.keys(evidence.cursor).length === 0
        )) {
            throw clientError('invalid_evidence', 'evidence.cursor 必须是非空对象。', { field: 'cursor' });
        }
        if (eventType === 'predicted') {
            evidence.prediction = assertFactArtifact(evidence.prediction, eventType, 'prediction', 2000);
        } else if (eventType === 'attempted') {
            if (typeof evidence.operation !== 'string' || !evidence.operation.trim() || evidence.operation.trim().length > 80) {
                throw clientError('attempt_operation_required', '尝试事件必须包含 1—80 字符的 evidence.operation。');
            }
            evidence.operation = evidence.operation.trim();
            if ('reported_correct' in evidence && typeof evidence.reported_correct !== 'boolean') {
                throw clientError('invalid_evidence', 'evidence.reported_correct 必须是布尔值。');
            }
        } else if (eventType === 'corrected') {
            evidence.correction = assertFactArtifact(evidence.correction, eventType, 'correction', 4000);
        } else if (eventType === 'explained') {
            evidence.artifact = assertFactArtifact(evidence.artifact, eventType, 'artifact', 8000);
        }
        const bytes = new TextEncoder().encode(JSON.stringify(evidence)).byteLength;
        if (bytes > MAX_EVIDENCE_BYTES) {
            throw clientError('evidence_too_large', '单条 evidence 超过 16 KiB 服务端上限。');
        }
        return Object.freeze(evidence);
    }

    function normalizeEvent(command) {
        if (!isPlainObject(command)) {
            throw clientError('invalid_event', '学习证据命令无效。');
        }
        const eventType = String(command.event_type || command.type || '').trim();
        if (SERVER_PROJECTION_TYPES.has(eventType)) {
            throw clientError('server_projection_only', 'completed/transferred 只能消费服务端投影。');
        }
        if (!EVENT_TYPES.has(eventType)) throw clientError('invalid_event_type', `不支持的学习证据事件：${eventType || 'empty'}`);
        const activityKey = String(command.activity_key || '').trim().toLowerCase();
        const ruleVersion = command.rule_version;
        if (!ACTIVITY_KEY_PATTERN.test(activityKey) || activityKey.length > 120) {
            throw clientError('activity_key_required', '学习活动标识必须是稳定小写分段键。');
        }
        if (!Number.isInteger(ruleVersion) || ruleVersion <= 0) {
            throw clientError('rule_binding_missing', '当前活动尚未绑定有效的学习证据规则。');
        }
        const eventId = String(command.client_event_id || createEventId());
        if (!CLIENT_EVENT_ID_PATTERN.test(eventId)) {
            throw clientError('invalid_client_event_id', 'client_event_id 不符合稳定标识合同。');
        }
        const evidence = normalizeEvidence(eventType, command.evidence);
        return Object.freeze({
            client_event_id: eventId,
            class_id: positiveInteger(command.class_id, 'class_id'),
            course_id: positiveInteger(command.course_id, 'course_id'),
            course_unit_id: positiveInteger(command.course_unit_id, 'course_unit_id'),
            assignment_id: command.assignment_id === undefined || command.assignment_id === null
                ? undefined
                : positiveInteger(command.assignment_id, 'assignment_id'),
            activity_key: activityKey,
            rule_version: ruleVersion,
            event_type: eventType,
            evidence,
            occurred_at: isoTime(command.occurred_at)
        });
    }

    function scopeKey(value) {
        return [
            value.class_id,
            value.course_id,
            value.course_unit_id || '',
            value.activity_key || ''
        ].join(':');
    }

    function eventScope(payload) {
        const scope = {
            class_id: payload.class_id,
            course_id: payload.course_id,
            course_unit_id: payload.course_unit_id,
            activity_key: payload.activity_key,
            rule_version: payload.rule_version
        };
        const eventType = payload.event_type || payload.last_event_type;
        if (eventType) scope.event_type = eventType;
        return scope;
    }

    function emit(change) {
        const snapshot = Object.freeze(Object.assign({ source: 'client' }, change || {}));
        listeners.forEach(listener => {
            try {
                listener(snapshot);
            } catch (error) {
                global.console && global.console.error('[LearningEvidenceClient] listener failed', error);
            }
        });
    }

    function normalizeError(error) {
        if (error && error.name === 'AstraLearningEvidenceClientError') return error;
        const detail = error && error.payload && error.payload.detail;
        const backendCode = detail && typeof detail === 'object' && detail.code
            ? String(detail.code)
            : '';
        const code = backendCode || String(error && error.code || 'learning_evidence_failed');
        const normalized = clientError(code, (detail && detail.message) || (error && error.message) || '学习证据请求失败。', {
            status: Number(error && error.status || 0) || null,
            ambiguous: Boolean(error && (
                error.ambiguous
                || error.confirmed && error.mutation
            )),
            offline: Boolean(error && error.offline) || code === 'offline',
            confirmed: Boolean(error && error.confirmed),
            mutation: Boolean(error && error.mutation),
            request_id: error && error.requestId || ''
        });
        normalized.cause = error || null;
        return normalized;
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

    function isFreeTextExplanation(payload, options) {
        if (payload.event_type !== 'explained') return false;
        if (options && options.onlineOnly) return true;
        const artifact = payload.evidence && payload.evidence.artifact;
        return containsFreeText(artifact, 'artifact');
    }

    function authorityClearPending() {
        const loader = global.AstraLearningEvidenceLoader;
        return Boolean(
            loader
            && typeof loader.isAuthorityClearPending === 'function'
            && loader.isAuthorityClearPending()
        );
    }

    function assertConfigured() {
        if (authorityClearPending()) {
            throw clientError('identity_required', 'Learning evidence authority is suspended.');
        }
        if (!configured) throw clientError('identity_required', '登录身份尚未配置，不能写入学习证据。');
    }

    function identityKey(identity) {
        const accountId = identity && (identity.id || identity.user_id || identity.account_id);
        const role = String(identity && identity.role || '').trim().toLowerCase();
        return accountId === undefined || accountId === null || !role
            ? ''
            : `${String(accountId)}:${role}`;
    }

    function isCurrentAuthority(generation) {
        return !authorityClearPending() && configured && generation === authorityGeneration;
    }

    function cancelledOutcome() {
        return Object.freeze({ outcome: 'cancelled', state: '' });
    }

    function cancelledError() {
        return clientError('cancelled', '登录身份或角色已变化，旧请求结果已丢弃。');
    }

    function invalidateAuthority() {
        authorityGeneration += 1;
        configured = false;
        configuredIdentityKey = '';
        configuredSubjectId = 0;
        if (flushTimer) global.clearTimeout(flushTimer);
        if (leaseTimer) global.clearInterval(leaseTimer);
        if (flushAbortController) flushAbortController.abort();
        if (authorityAbortController) authorityAbortController.abort();
        flushTimer = 0;
        flushDueAt = 0;
        leaseTimer = 0;
        authorityAbortController = null;
        activityProjection.clear();
        confirmedReceipts.clear();
    }

    function suspendAuthority() {
        invalidateAuthority();
        const store = global.AstraLearningEvidenceQueue;
        if (store && typeof store.releaseLease === 'function') {
            try {
                Promise.resolve(store.releaseLease()).catch(() => {});
            } catch (_) {}
        }
    }

    async function configureIdentity(identity) {
        if (authorityClearPromise) await authorityClearPromise;
        if (authorityClearPending()) {
            throw clientError('identity_required', 'Learning evidence authority is suspended.');
        }
        const nextIdentityKey = identityKey(identity);
        const accountId = identity && (identity.id || identity.user_id || identity.account_id);
        if (!nextIdentityKey) {
            await clearAuthority('identity-required');
            throw clientError('identity_required', '登录身份尚未配置，不能写入学习证据。');
        }
        const nextSubjectId = positiveInteger(accountId, 'subject_user_id');
        if (configured && configuredIdentityKey === nextIdentityKey) {
            ensureQueueSubscription();
            if (!global.AstraApiClient.isOffline()) scheduleFlush(0);
            return;
        }
        if (configured) await clearAuthority('identity-changed');
        const previousFlush = flushing;
        if (previousFlush) {
            try {
                await previousFlush;
            } catch (_) {
                // Authority fencing, not the old transport result, governs the new identity.
            }
        }
        const configureGeneration = authorityGeneration;
        await queue().configureIdentity(identity);
        if (authorityClearPending() || authorityGeneration !== configureGeneration) {
            throw clientError('identity_required', 'Learning evidence authority changed during configuration.');
        }
        ensureQueueSubscription();
        authorityGeneration += 1;
        authorityAbortController = new AbortController();
        configured = true;
        configuredIdentityKey = nextIdentityKey;
        configuredSubjectId = nextSubjectId;
        emit({ type: 'identity-configured' });
        if (!global.AstraApiClient.isOffline()) scheduleFlush(0);
    }

    function clearAuthority(reason) {
        if (authorityClearPromise) return authorityClearPromise;
        authorityClearPromise = (async () => {
            invalidateAuthority();
            try {
                await queue().clearAuthority();
            } finally {
                emit({ type: 'authority-cleared', reason: reason || 'session-ended' });
            }
        })();
        authorityClearPromise.then(
            () => { authorityClearPromise = null; },
            () => { authorityClearPromise = null; }
        );
        return authorityClearPromise;
    }

    function clearForUnauthorized() {
        const loader = global.AstraLearningEvidenceLoader;
        return loader && typeof loader.clearAuthority === 'function'
            ? loader.clearAuthority('unauthorized')
            : clearAuthority('unauthorized');
    }

    function ensureQueueSubscription() {
        if (queueUnsubscribe) return;
        queueUnsubscribe = queue().subscribe(change => {
            if (change && change.source === 'peer-tab' && change.type === 'authority-cleared') {
                invalidateAuthority();
                emit({ type: 'authority-cleared', reason: 'peer-tab' });
                return;
            }
            if (
                configured
                && change
                && ['confirmed', 'removed', 'expired-pruned'].includes(change.type)
            ) {
                emit({
                    type: 'queue-capacity-released',
                    reason: change.type
                });
            }
            if (!configured || !change || change.source !== 'peer-tab') return;
            const projection = change && change.projection;
            if (!projection) return;
            if (change.type === 'confirmed') {
                emit(Object.assign({
                    type: 'confirmed',
                    client_event_id: change.client_event_id,
                    state: 'confirmed',
                    projection: Object.freeze(Object.assign({ status: 'confirmed' }, projection))
                }, eventScope(projection)));
                return;
            }
            const peerState = change.type === 'enqueued' ? 'local-pending' : change.state;
            if (
                !PEER_QUEUE_STATES.has(peerState)
                || (change.type !== 'enqueued' && change.type !== 'state-changed')
            ) return;
            const scope = Object.freeze(eventScope(projection));
            emit(Object.assign({
                type: peerState,
                client_event_id: change.client_event_id,
                state: peerState,
                projection: scope
            }, scope));
        });
    }

    function validReceiptTime(value) {
        return typeof value === 'string'
            && /(?:Z|[+-]\d\d:\d\d)$/i.test(value)
            && Number.isFinite(new Date(value).getTime());
    }

    function nonNegativeInteger(value) {
        return Number.isInteger(value) && value >= 0;
    }

    function nullablePositiveInteger(value) {
        return value === null || value === undefined || (Number.isInteger(value) && value > 0);
    }

    function teacherFactScalar(value) {
        return value === null
            || typeof value === 'boolean'
            || (typeof value === 'string' && value.length <= 240 && validUnicodeScalar(value))
            || (typeof value === 'number' && Number.isFinite(value));
    }

    function assertTeacherEventsResponse(response, expected) {
        const items = response && response.items;
        const seenEventIds = new Set();
        const validItems = Array.isArray(items)
            && items.length <= expected.limit
            && items.every(item => {
                const summary = item && item.evidence_summary;
                const facts = summary && summary.facts;
                const factEntries = isPlainObject(facts) ? Object.entries(facts) : [];
                const eventId = item && item.event_id;
                if (
                    !Number.isInteger(eventId)
                    || eventId <= 0
                    || seenEventIds.has(eventId)
                    || item.subject_user_id !== expected.subjectUserId
                    || !Number.isInteger(item.course_unit_id)
                    || item.course_unit_id <= 0
                    || !nullablePositiveInteger(item.assignment_id)
                    || typeof item.activity_key !== 'string'
                    || item.activity_key.length > 120
                    || !ACTIVITY_KEY_PATTERN.test(item.activity_key)
                    || (expected.activityKey !== undefined && item.activity_key !== expected.activityKey)
                    || !DISCOVERABLE_EVENT_TYPES.has(item.event_type)
                    || (expected.eventType !== undefined && item.event_type !== expected.eventType)
                    || !DISCOVERABLE_PRODUCER_TYPES.has(item.producer_type)
                    || !validReceiptTime(item.occurred_at)
                    || !isPlainObject(summary)
                    || !isPlainObject(facts)
                    || factEntries.length > 12
                    || !factEntries.every(([key, value]) => (
                        /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(key)
                        && teacherFactScalar(value)
                    ))
                    || typeof summary.truncated !== 'boolean'
                    || !nullablePositiveInteger(item.corrects_event_id)
                    || !nullablePositiveInteger(item.corrected_by_event_id)
                ) return false;
                seenEventIds.add(eventId);
                return true;
            });
        const nextOffset = response && response.next_offset;
        if (
            !response
            || response.class_id !== expected.classId
            || response.course_id !== expected.courseId
            || response.subject_user_id !== expected.subjectUserId
            || !nonNegativeInteger(response.total)
            || response.limit !== expected.limit
            || response.offset !== expected.offset
            || !validItems
            || !(nextOffset === null || (
                nonNegativeInteger(nextOffset)
                && nextOffset > response.offset
                && nextOffset <= response.total
            ))
            || items.length > response.total
            || response.offset + items.length > response.total
        ) {
            throw clientError('teacher_events_schema_invalid', '教师学习证据响应与当前教学范围不一致。');
        }
        const safeItems = items.map(item => Object.freeze({
            event_id: item.event_id,
            subject_user_id: item.subject_user_id,
            course_unit_id: item.course_unit_id,
            assignment_id: item.assignment_id == null ? null : item.assignment_id,
            activity_key: item.activity_key,
            event_type: item.event_type,
            producer_type: item.producer_type,
            occurred_at: item.occurred_at,
            evidence_summary: Object.freeze({
                facts: Object.freeze(Object.assign({}, item.evidence_summary.facts)),
                truncated: item.evidence_summary.truncated
            }),
            corrects_event_id: item.corrects_event_id == null ? null : item.corrects_event_id,
            corrected_by_event_id: item.corrected_by_event_id == null ? null : item.corrected_by_event_id
        }));
        return Object.freeze({
            class_id: response.class_id,
            course_id: response.course_id,
            subject_user_id: response.subject_user_id,
            total: response.total,
            limit: response.limit,
            offset: response.offset,
            next_offset: nextOffset,
            items: Object.freeze(safeItems)
        });
    }

    function validateCorrectionReceipt(receipt, payload) {
        const outcome = String(receipt && receipt.outcome || '');
        if (
            !receipt
            || !Number.isInteger(receipt.event_id)
            || receipt.event_id <= 0
            || receipt.client_event_id !== payload.client_event_id
            || receipt.event_type !== 'administrative_correction'
            || !['accepted', 'duplicate'].includes(outcome)
            || !validReceiptTime(receipt.received_at)
        ) {
            throw clientError('correction_receipt_schema_invalid', '教师纠正回执与已发送命令不一致。', {
                ambiguous: true,
                confirmed: true,
                mutation: true
            });
        }
        return Object.freeze({
            event_id: receipt.event_id,
            client_event_id: receipt.client_event_id,
            event_type: receipt.event_type,
            outcome,
            received_at: receipt.received_at
        });
    }

    function validateReceipt(receipt, payload, expectedOutcome) {
        const outcome = String(receipt && receipt.outcome || '');
        if (
            !receipt
            || !Number.isInteger(receipt.event_id)
            || receipt.event_id <= 0
            || receipt.client_event_id !== payload.client_event_id
            || receipt.event_type !== payload.event_type
            || !['accepted', 'duplicate'].includes(outcome)
            || expectedOutcome && outcome !== expectedOutcome
            || !validReceiptTime(receipt.received_at)
        ) {
            throw clientError('receipt_schema_invalid', '学习证据回执与已发送事件不一致。', {
                ambiguous: true
            });
        }
        return Object.freeze({
            event_id: receipt.event_id,
            client_event_id: receipt.client_event_id,
            event_type: receipt.event_type,
            outcome,
            received_at: receipt.received_at
        });
    }

    async function submitExact(payload, signal) {
        const receipt = await api().request(`${API_ROOT}/events`, {
            method: 'POST',
            body: payload,
            signal
        });
        return validateReceipt(receipt, payload);
    }

    function authorityRequestSignal(externalSignal, generation) {
        const controller = new AbortController();
        const sources = [];
        const abort = () => controller.abort();
        const attach = signal => {
            if (!signal || typeof signal.addEventListener !== 'function' || sources.includes(signal)) return;
            sources.push(signal);
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', abort, { once: true });
        };
        attach(authorityAbortController && authorityAbortController.signal);
        attach(externalSignal);
        if (!isCurrentAuthority(generation)) controller.abort();
        return {
            signal: controller.signal,
            release() {
                sources.forEach(signal => {
                    if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abort);
                });
            }
        };
    }

    function rememberConfirmed(payload, receipt, generation) {
        if (!isCurrentAuthority(generation)) return null;
        const key = scopeKey(payload);
        const projection = Object.freeze({
            class_id: payload.class_id,
            course_id: payload.course_id,
            course_unit_id: payload.course_unit_id,
            activity_key: payload.activity_key,
            rule_version: payload.rule_version,
            status: 'confirmed',
            last_event_type: payload.event_type,
            last_confirmed_at: receipt && (receipt.received_at || receipt.created_at) || new Date().toISOString(),
            server_projection: null
        });
        activityProjection.set(key, projection);
        confirmedReceipts.set(payload.client_event_id, Object.freeze(Object.assign({}, receipt || {}, {
            client_event_id: payload.client_event_id
        })));
        emit(Object.assign({
            type: 'confirmed',
            client_event_id: payload.client_event_id,
            state: 'confirmed',
            projection
        }, eventScope(payload)));
        return projection;
    }

    async function reconcileAmbiguous(payload, signal) {
        try {
            return await submitExact(payload, signal);
        } catch (error) {
            throw normalizeError(error);
        }
    }

    async function storePending(payload, reason, generation) {
        if (!isCurrentAuthority(generation)) return cancelledOutcome();
        let record;
        try {
            record = await queue().enqueue(payload);
        } catch (error) {
            if (!isCurrentAuthority(generation)) return cancelledOutcome();
            throw error;
        }
        if (!isCurrentAuthority(generation)) return cancelledOutcome();
        emit(Object.assign({
            type: 'local-pending',
            client_event_id: payload.client_event_id,
            state: 'local-pending',
            reason: reason || 'offline'
        }, eventScope(payload)));
        scheduleFlush(1500);
        return Object.freeze({
            outcome: 'queued',
            client_event_id: payload.client_event_id,
            event_type: payload.event_type,
            state: record.state
        });
    }

    async function record(command, options) {
        assertConfigured();
        const generation = authorityGeneration;
        const settings = options || {};
        const payload = normalizeEvent(command);
        const onlineOnly = isFreeTextExplanation(payload, settings);
        if (api().isOffline()) {
            if (onlineOnly) throw clientError('online_required', '自由文本解释不会保存到本机，请联网后提交。');
            return storePending(payload, 'offline', generation);
        }
        const requestAuthority = authorityRequestSignal(settings.signal, generation);
        emit(Object.assign({
            type: 'syncing',
            client_event_id: payload.client_event_id,
            state: 'syncing'
        }, eventScope(payload)));
        try {
            const receipt = await submitExact(payload, requestAuthority.signal);
            if (!isCurrentAuthority(generation)) return cancelledOutcome();
            rememberConfirmed(payload, receipt, generation);
            scheduleFlush(0);
            return Object.freeze({
                outcome: 'confirmed',
                client_event_id: payload.client_event_id,
                event_type: payload.event_type,
                receipt,
                state: 'confirmed'
            });
        } catch (rawError) {
            if (!isCurrentAuthority(generation)) return cancelledOutcome();
            let error = normalizeError(rawError);
            if (error.code === 'unauthorized') {
                await clearForUnauthorized();
                throw error;
            }
            if (error.details && error.details.ambiguous) {
                try {
                    const receipt = await reconcileAmbiguous(payload, requestAuthority.signal);
                    if (!isCurrentAuthority(generation)) return cancelledOutcome();
                    rememberConfirmed(payload, receipt, generation);
                    return Object.freeze({
                        outcome: 'reconciled',
                        client_event_id: payload.client_event_id,
                        event_type: payload.event_type,
                        receipt,
                        state: 'confirmed'
                    });
                } catch (reconcileError) {
                    if (!isCurrentAuthority(generation)) return cancelledOutcome();
                    error = reconcileError;
                }
            }
            if (onlineOnly) throw error.code === 'offline' || error.code === 'network'
                ? clientError('online_required', '自由文本解释未保存，请恢复联网后重试。')
                : error;
            if (IDEMPOTENCY_CONFLICTS.has(error.code)) {
                let pending;
                try {
                    pending = await queue().enqueue(payload);
                    if (!isCurrentAuthority(generation)) return cancelledOutcome();
                    await queue().updateState(payload.client_event_id, 'manual-intervention', { error: error.code });
                } catch (queueErrorValue) {
                    if (!isCurrentAuthority(generation)) return cancelledOutcome();
                    throw queueErrorValue;
                }
                if (!isCurrentAuthority(generation)) return cancelledOutcome();
                emit(Object.assign({
                    type: 'manual-intervention',
                    client_event_id: payload.client_event_id,
                    state: 'manual-intervention',
                    reason: error.code
                }, eventScope(payload)));
                return Object.freeze({
                    outcome: 'manual-intervention',
                    client_event_id: payload.client_event_id,
                    event_type: payload.event_type,
                    state: 'manual-intervention',
                    record: pending
                });
            }
            if (isQueueableFailure(error)) return storePending(payload, error.code, generation);
            throw error;
        } finally {
            requestAuthority.release();
        }
    }

    function isQueueableFailure(error) {
        const status = Number(error && error.details && error.details.status || 0);
        return Boolean(
            error
            && (
                error.code === 'offline'
                || error.code === 'network'
                || error.details && error.details.ambiguous
                || error.code === 'service_unavailable'
                || status >= 500
            )
        );
    }

    function batchResultMap(response, expectedRecords) {
        const records = expectedRecords || [];
        const allowedTop = new Set(['items', 'accepted_count', 'duplicate_count', 'rejected_count', 'conflict_count']);
        const validCount = value => Number.isInteger(value) && value >= 0;
        if (
            !response
            || !isPlainObject(response)
            || Object.keys(response).some(key => !allowedTop.has(key))
            || !Array.isArray(response.items)
            || response.items.length !== records.length
            || !['accepted_count', 'duplicate_count', 'rejected_count', 'conflict_count'].every(key => validCount(response[key]))
            || response.items.length !== response.accepted_count + response.duplicate_count + response.rejected_count + response.conflict_count
        ) {
            throw clientError('batch_schema_invalid', '批量学习证据回执结构无效。', { ambiguous: true });
        }
        const byId = new Map(records.map(record => [record.client_event_id, record]));
        const results = new Map();
        const counted = { accepted: 0, duplicate: 0, rejected: 0, conflict: 0 };
        response.items.forEach(item => {
            const record = item && byId.get(item.client_event_id);
            const outcome = String(item && item.outcome || '');
            if (
                !record
                || results.has(item.client_event_id)
                || !WRITE_OUTCOMES.has(outcome)
                || !Number.isInteger(item.status_code)
                || item.status_code < 100
                || item.status_code > 599
            ) {
                throw clientError('batch_schema_invalid', '批量学习证据条目与请求不一致。', { ambiguous: true });
            }
            if (outcome === 'accepted' || outcome === 'duplicate') {
                validateReceipt(item.receipt, record.payload, outcome);
            } else if (item.receipt !== null && item.receipt !== undefined) {
                throw clientError('batch_schema_invalid', '拒绝或冲突条目不能携带确认回执。', { ambiguous: true });
            }
            counted[outcome] += 1;
            results.set(item.client_event_id, item);
        });
        if (
            counted.accepted !== response.accepted_count
            || counted.duplicate !== response.duplicate_count
            || counted.rejected !== response.rejected_count
            || counted.conflict !== response.conflict_count
        ) {
            throw clientError('batch_schema_invalid', '批量学习证据计数与条目不一致。', { ambiguous: true });
        }
        return results;
    }

    async function markManual(record, code, generation) {
        if (!isCurrentAuthority(generation)) return;
        await queue().updateState(record.client_event_id, 'manual-intervention', { error: code });
        if (!isCurrentAuthority(generation)) return;
        emit(Object.assign({
            type: 'manual-intervention',
            client_event_id: record.client_event_id,
            state: 'manual-intervention',
            reason: code
        }, eventScope(record.payload)));
    }

    async function flushBatch(records, signal, generation) {
        if (!isCurrentAuthority(generation)) return;
        const response = await api().request(`${API_ROOT}/events/batch`, {
            method: 'POST',
            body: { items: records.map(record => record.payload) },
            signal
        });
        if (!isCurrentAuthority(generation)) return;
        const results = batchResultMap(response, records);
        for (const record of records) {
            if (!isCurrentAuthority(generation)) return;
            const item = results.get(record.client_event_id);
            const outcome = String(item && item.outcome || '');
            const receipt = item && item.receipt;
            if (outcome === 'accepted' || outcome === 'duplicate') {
                const confirmedReceipt = validateReceipt(receipt, record.payload, outcome);
                rememberConfirmed(record.payload, confirmedReceipt, generation);
                if (!isCurrentAuthority(generation)) return;
                await queue().remove(record.client_event_id, confirmedReceipt);
                continue;
            }
            const code = String(item && item.error_code || outcome || 'batch_item_unconfirmed');
            const status = Number(item && item.status_code || 0);
            if (outcome === 'conflict' || outcome === 'rejected' || (status > 0 && status < 500)) {
                await markManual(record, code, generation);
                continue;
            }
            await retrySingle(record, signal, code, generation);
        }
    }

    async function retrySingle(record, signal, priorCode, generation) {
        if (!isCurrentAuthority(generation)) return null;
        await queue().updateState(record.client_event_id, 'syncing', { error: priorCode || null });
        if (!isCurrentAuthority(generation)) return null;
        try {
            const receipt = await submitExact(record.payload, signal);
            if (!isCurrentAuthority(generation)) return null;
            rememberConfirmed(record.payload, receipt, generation);
            if (!isCurrentAuthority(generation)) return null;
            await queue().remove(record.client_event_id, receipt);
        } catch (rawError) {
            if (!isCurrentAuthority(generation)) return null;
            const error = normalizeError(rawError);
            if (error.code === 'unauthorized') {
                await clearForUnauthorized();
                throw error;
            }
            if (error.code === 'cancelled') {
                await queue().updateState(record.client_event_id, 'local-pending', {
                    error: null,
                    next_attempt_at: Date.now()
                });
                return Date.now();
            }
            if (error.code === 'conflict' || error.code === 'client_event_id_conflict' || !isQueueableFailure(error)) {
                await markManual(record, error.code, generation);
                return null;
            }
            const delay = Math.min(5 * 60 * 1000, 1000 * Math.pow(2, Math.min(8, Number(record.attempts || 0))));
            const nextAttemptAt = Date.now() + delay;
            await queue().updateState(record.client_event_id, 'local-pending', {
                error: error.code,
                next_attempt_at: nextAttemptAt
            });
            return nextAttemptAt;
        }
        return null;
    }

    async function flush(options) {
        if (authorityClearPending()) return Object.freeze({ outcome: 'skipped' });
        if (flushing) return flushing;
        if (!configured || destroyed || api().isOffline()) return Object.freeze({ outcome: 'skipped' });
        const generation = authorityGeneration;
        const settings = options || {};
        const controller = new AbortController();
        const cancelFlush = () => controller.abort();
        flushAbortController = controller;
        if (settings.signal) {
            if (settings.signal.aborted) controller.abort();
            else settings.signal.addEventListener('abort', cancelFlush, { once: true });
        }
        flushing = (async () => {
            let leased;
            try {
                leased = await queue().acquireLease();
            } catch (error) {
                if (!isCurrentAuthority(generation)) return cancelledOutcome();
                throw error;
            }
            if (!isCurrentAuthority(generation)) {
                if (leased) await queue().releaseLease();
                return cancelledOutcome();
            }
            if (!leased) {
                scheduleFlush(1500);
                return Object.freeze({ outcome: 'peer-tab-active' });
            }
            leaseTimer = global.setInterval(() => {
                if (isCurrentAuthority(generation)) queue().renewLease().catch(() => {});
            }, 4000);
            try {
                const records = await queue().list({
                    dueOnly: true,
                    states: ['local-pending', 'syncing']
                });
                if (!isCurrentAuthority(generation)) return cancelledOutcome();
                if (!records.length) return Object.freeze({ outcome: 'empty', count: 0 });
                records.forEach(record => emit(Object.assign({
                    type: 'syncing',
                    client_event_id: record.client_event_id,
                    state: 'syncing'
                }, eventScope(record.payload))));
                try {
                    await flushBatch(records.slice(0, 50), controller.signal, generation);
                } catch (rawError) {
                    if (!isCurrentAuthority(generation)) return cancelledOutcome();
                    const error = normalizeError(rawError);
                    if (error.code === 'unauthorized') {
                        await clearForUnauthorized();
                        throw error;
                    }
                    for (const record of records.slice(0, 50)) {
                        await retrySingle(record, controller.signal, error.code, generation);
                        if (!isCurrentAuthority(generation)) return cancelledOutcome();
                    }
                }
                if (!isCurrentAuthority(generation)) return cancelledOutcome();
                const remaining = await queue().list({
                    states: ['local-pending', 'syncing']
                });
                if (!isCurrentAuthority(generation)) return cancelledOutcome();
                if (remaining.length) {
                    const nextAt = Math.min(...remaining.map(record => Number(record.next_attempt_at || 0)));
                    scheduleFlush(Math.max(0, nextAt - Date.now()));
                }
                return Object.freeze({ outcome: 'processed', count: Math.min(records.length, 50) });
            } catch (error) {
                if (!isCurrentAuthority(generation)) return cancelledOutcome();
                throw error;
            } finally {
                if (leaseTimer) global.clearInterval(leaseTimer);
                leaseTimer = 0;
                if (leased) await queue().releaseLease();
            }
        })();
        try {
            return await flushing;
        } finally {
            if (settings.signal) settings.signal.removeEventListener('abort', cancelFlush);
            if (flushAbortController === controller) flushAbortController = null;
            flushing = null;
        }
    }

    function scheduleFlush(delay) {
        if (authorityClearPending() || !configured || destroyed) return;
        const wait = Math.max(0, Number(delay || 0));
        const dueAt = Date.now() + wait;
        if (flushTimer && flushDueAt <= dueAt) return;
        if (flushTimer) global.clearTimeout(flushTimer);
        flushDueAt = dueAt;
        flushTimer = global.setTimeout(() => {
            flushTimer = 0;
            flushDueAt = 0;
            flush().catch(error => {
                const normalized = normalizeError(error);
                if (normalized.code !== 'offline' && normalized.code !== 'cancelled') {
                    global.console && global.console.warn('[LearningEvidenceClient] background flush failed', normalized.code);
                }
            });
        }, wait);
    }

    function assertRecoveryResponse(response, classId, courseId) {
        const statuses = new Set(['not_started', 'in_progress', 'completed', 'transferred']);
        const isPositiveInteger = value => Number.isInteger(value) && value > 0;
        const validTime = value => value === null || value === undefined || Number.isFinite(new Date(value).getTime());
        const requiredTime = value => value !== null && value !== undefined && Number.isFinite(new Date(value).getTime());
        const nonNegativeInteger = value => Number.isInteger(value) && value >= 0;
        const responseRuleVersion = response && response.rule_version;
        const activityKeys = new Set();
        const activities = response && response.activities;
        const validActivities = Array.isArray(activities) && activities.every(item => {
            const key = item && `${item.course_unit_id}:${String(item.activity_key || '').trim()}`;
            if (!key || activityKeys.has(key)) return false;
            activityKeys.add(key);
            return Boolean(
                item
                && isPositiveInteger(item.course_unit_id)
                && typeof item.activity_key === 'string' && ACTIVITY_KEY_PATTERN.test(item.activity_key)
                && isPositiveInteger(item.rule_version)
                && item.rule_version === responseRuleVersion
                && statuses.has(item.status)
                && ['learner_event_count', 'attempt_count', 'reported_correct_attempt_count', 'corrected_count', 'explained_count'].every(field => nonNegativeInteger(item[field]))
                && ['first_started_at', 'last_occurred_at', 'completed_at', 'transferred_at'].every(field => validTime(item[field]))
                && item.resume_cursor && typeof item.resume_cursor === 'object' && !Array.isArray(item.resume_cursor)
            );
        });
        const resume = response && response.resume;
        const validResume = resume === null || (
            resume && isPositiveInteger(resume.course_unit_id)
            && typeof resume.activity_key === 'string' && resume.activity_key.trim().length > 0
            && isPositiveInteger(resume.rule_version)
            && resume.rule_version === responseRuleVersion
            && isPositiveInteger(resume.last_event_id)
            && requiredTime(resume.last_occurred_at)
            && resume.cursor && typeof resume.cursor === 'object' && !Array.isArray(resume.cursor)
        );
        if (
            !response
            || response.class_id !== classId
            || response.course_id !== courseId
            || response.subject_user_id !== configuredSubjectId
            || !isPositiveInteger(response.rule_version)
            || !validActivities
            || !validResume
        ) {
            throw clientError('recovery_schema_invalid', '服务端学习状态与当前课程范围不一致。');
        }
        if (resume && !activities.some(item => (
            item.course_unit_id === resume.course_unit_id
            && item.activity_key === resume.activity_key
            && item.rule_version === resume.rule_version
        ))) {
            throw clientError('recovery_schema_invalid', '服务端 resume 未关联当前 recovery 活动。');
        }
        return response;
    }

    function assertAggregateResponse(response, classId, courseId) {
        const isPositiveInteger = value => Number.isInteger(value) && value > 0;
        const nonNegativeInteger = value => Number.isInteger(value) && value >= 0;
        const generatedAt = response && response.generated_at;
        const aggregateActiveStudents = response && response.active_students;
        const activityKeys = new Set();
        const validActivities = response && Array.isArray(response.activities) && response.activities.every(item => {
            const key = item && `${item.course_unit_id}:${String(item.activity_key || '').trim()}`;
            if (!key || activityKeys.has(key)) return false;
            activityKeys.add(key);
            const stateTotal = item
                ? ['not_started', 'in_progress', 'completed', 'transferred'].reduce((total, field) => total + item[field], 0)
                : Number.NaN;
            return Boolean(
                item
                && isPositiveInteger(item.course_unit_id)
                && typeof item.activity_key === 'string' && ACTIVITY_KEY_PATTERN.test(item.activity_key)
                && ['not_started', 'in_progress', 'completed', 'transferred', 'active_students'].every(field => nonNegativeInteger(item[field]))
                && item.active_students === aggregateActiveStudents
                && stateTotal === aggregateActiveStudents
                && typeof item.completion_percent === 'number'
                && Number.isFinite(item.completion_percent)
                && item.completion_percent >= 0
                && item.completion_percent <= 100
            );
        });
        if (
            !response
            || response.class_id !== classId
            || response.course_id !== courseId
            || !isPositiveInteger(response.rule_version)
            || !nonNegativeInteger(response.active_students)
            || generatedAt === null
            || generatedAt === undefined
            || !Number.isFinite(new Date(generatedAt).getTime())
            || !validActivities
        ) {
            throw clientError('aggregate_schema_invalid', '服务端班级概况与当前教学范围不一致。');
        }
        return response;
    }

    async function recovery(scope, options) {
        assertConfigured();
        const generation = authorityGeneration;
        const classId = positiveInteger(scope && scope.class_id, 'class_id');
        const courseId = positiveInteger(scope && scope.course_id, 'course_id');
        const rawResponse = await api().request(`${API_ROOT}/me/recovery`, {
            params: { class_id: classId, course_id: courseId },
            signal: options && options.signal
        });
        if (!isCurrentAuthority(generation)) throw cancelledError();
        const response = assertRecoveryResponse(rawResponse, classId, courseId);
        if (!isCurrentAuthority(generation)) throw cancelledError();
        Array.from(activityProjection.entries()).forEach(([key, value]) => {
            if (Number(value.class_id) === classId && Number(value.course_id) === courseId) {
                activityProjection.delete(key);
            }
        });
        const activities = Array.isArray(response && response.activities) ? response.activities : [];
        activities.forEach(item => {
            const key = scopeKey(Object.assign({ class_id: classId, course_id: courseId }, item));
            activityProjection.set(key, Object.freeze(Object.assign({}, item, {
                class_id: classId,
                course_id: courseId,
                server_projection: true
            })));
        });
        emit({ type: 'recovery-loaded', class_id: classId, course_id: courseId, response });
        return response;
    }

    async function teacherAggregate(scope, options) {
        assertConfigured();
        const generation = authorityGeneration;
        const classId = positiveInteger(scope && scope.class_id, 'class_id');
        const courseId = positiveInteger(scope && scope.course_id, 'course_id');
        const response = await api().request(`${API_ROOT}/classes/${classId}/courses/${courseId}/aggregate`, {
            baseUrl: options && options.baseUrl,
            signal: options && options.signal
        });
        if (!isCurrentAuthority(generation)) throw cancelledError();
        return assertAggregateResponse(response, classId, courseId);
    }

    async function teacherEvents(scope, filters, options) {
        assertConfigured();
        const generation = authorityGeneration;
        const classId = positiveInteger(scope && scope.class_id, 'class_id');
        const courseId = positiveInteger(scope && scope.course_id, 'course_id');
        const subjectUserId = positiveInteger(scope && scope.subject_user_id, 'subject_user_id');
        const settings = filters || {};
        const limit = settings.limit === undefined ? 50 : settings.limit;
        const offset = settings.offset === undefined ? 0 : settings.offset;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !nonNegativeInteger(offset) || offset > 100000) {
            throw clientError('invalid_teacher_events_page', '教师学习证据分页参数无效。');
        }
        const activityKey = settings.activity_key === undefined || settings.activity_key === null || settings.activity_key === ''
            ? undefined
            : String(settings.activity_key).trim().toLowerCase();
        const eventType = settings.event_type === undefined || settings.event_type === null || settings.event_type === ''
            ? undefined
            : String(settings.event_type).trim().toLowerCase();
        if (activityKey !== undefined && (!ACTIVITY_KEY_PATTERN.test(activityKey) || activityKey.length > 120)) {
            throw clientError('invalid_activity_key', '教师学习证据活动筛选无效。');
        }
        if (eventType !== undefined && !DISCOVERABLE_EVENT_TYPES.has(eventType)) {
            throw clientError('invalid_event_type', '教师学习证据事件筛选无效。');
        }
        const requestAuthority = authorityRequestSignal(options && options.signal, generation);
        try {
            const response = await api().request(
                `${API_ROOT}/classes/${classId}/courses/${courseId}/events`,
                {
                    params: {
                        subject_user_id: subjectUserId,
                        activity_key: activityKey,
                        event_type: eventType,
                        limit,
                        offset
                    },
                    baseUrl: options && options.baseUrl,
                    signal: requestAuthority.signal
                }
            );
            if (!isCurrentAuthority(generation)) throw cancelledError();
            return assertTeacherEventsResponse(response, {
                classId,
                courseId,
                subjectUserId,
                activityKey,
                eventType,
                limit,
                offset
            });
        } catch (rawError) {
            if (!isCurrentAuthority(generation)) throw cancelledError();
            const error = normalizeError(rawError);
            if (error.code === 'unauthorized') await clearForUnauthorized();
            throw error;
        } finally {
            requestAuthority.release();
        }
    }

    async function appendTeacherCorrection(command, options) {
        assertConfigured();
        const generation = authorityGeneration;
        const eventId = positiveInteger(command && command.event_id, 'event_id');
        const reason = String(command && command.reason || '').trim();
        if (!reason || reason.length > 1000 || !validUnicodeScalar(reason)) {
            throw clientError('correction_reason_required', '教师纠正原因必须为 1—1000 个有效字符。');
        }
        const eventKey = String(command && command.client_event_id || `teacher-correction:${createEventId()}`);
        if (!CLIENT_EVENT_ID_PATTERN.test(eventKey)) {
            throw clientError('invalid_client_event_id', '教师纠正 client_event_id 不符合稳定标识合同。');
        }
        const payload = Object.freeze({
            client_event_id: eventKey,
            reason,
            occurred_at: isoTime(command && command.occurred_at)
        });
        const requestAuthority = authorityRequestSignal(options && options.signal, generation);
        try {
            const rawReceipt = await api().request(`${API_ROOT}/events/${eventId}/corrections`, {
                method: 'POST',
                body: payload,
                baseUrl: options && options.baseUrl,
                signal: requestAuthority.signal
            });
            if (!isCurrentAuthority(generation)) throw cancelledError();
            const receipt = validateCorrectionReceipt(rawReceipt, payload);
            return Object.freeze({
                outcome: receipt.outcome === 'duplicate' ? 'reconciled' : 'confirmed',
                state: 'confirmed',
                receipt
            });
        } catch (rawError) {
            if (!isCurrentAuthority(generation)) throw cancelledError();
            const error = normalizeError(rawError);
            if (error.code === 'unauthorized') await clearForUnauthorized();
            throw error;
        } finally {
            requestAuthority.release();
        }
    }

    function projection(scope) {
        return activityProjection.get(scopeKey(scope || {})) || null;
    }

    async function stateFor(scope) {
        assertConfigured();
        const generation = authorityGeneration;
        const projected = projection(scope);
        const pending = await queue().list({ states: ['local-pending', 'syncing', 'manual-intervention'] });
        if (!isCurrentAuthority(generation)) throw cancelledError();
        const matching = pending.filter(record => scopeKey(record.payload) === scopeKey(scope || {}));
        const manual = matching.find(record => record.state === 'manual-intervention');
        const syncing = matching.find(record => record.state === 'syncing');
        const local = matching.find(record => record.state === 'local-pending');
        if (manual) return Object.freeze({ state: 'manual-intervention', record: manual, projection: projected });
        if (syncing) return Object.freeze({ state: 'syncing', record: syncing, projection: projected });
        if (local) return Object.freeze({ state: 'local-pending', record: local, projection: projected });
        if (projected) return Object.freeze({ state: 'confirmed', projection: projected });
        return Object.freeze({ state: '', projection: null });
    }

    async function pendingFor(scope) {
        assertConfigured();
        const generation = authorityGeneration;
        const expected = {
            class_id: positiveInteger(Number(scope && scope.class_id), 'class_id'),
            course_id: positiveInteger(Number(scope && scope.course_id), 'course_id'),
            course_unit_id: positiveInteger(Number(scope && scope.course_unit_id), 'course_unit_id'),
            activity_key: String(scope && scope.activity_key || '').trim().toLowerCase()
        };
        if (!ACTIVITY_KEY_PATTERN.test(expected.activity_key) || expected.activity_key.length > 120) {
            throw clientError('invalid_scope', '学习活动标识无效。', { field: 'activity_key' });
        }
        const records = await queue().list({ states: ['local-pending', 'syncing', 'manual-intervention'] });
        if (!isCurrentAuthority(generation)) throw cancelledError();
        const matching = records.filter(record => scopeKey(record && record.payload || {}) === scopeKey(expected));
        if (matching.some(record => record && record.state === 'manual-intervention')) {
            throw clientError(
                'pending_recovery_manual_intervention',
                '当前活动存在需要人工处理的证据冲突，不能自动恢复或继续记录。'
            );
        }
        if (matching.length > PENDING_RECOVERY_LIMIT) {
            throw clientError('pending_recovery_too_large', '当前活动待同步证据超出可验证恢复上限。');
        }
        const safe = matching.map(record => {
            try {
                if (
                    !record
                    || !['local-pending', 'syncing'].includes(record.state)
                    || !Number.isFinite(Number(record.created_at))
                    || containsPendingForbiddenKey(record.payload && record.payload.evidence)
                ) throw new Error('invalid pending record');
                const payload = normalizeEvent(record.payload);
                if (
                    payload.client_event_id !== record.payload.client_event_id
                    || scopeKey(payload) !== scopeKey(expected)
                    || containsFreeText(payload.evidence, 'evidence')
                ) throw new Error('pending record scope mismatch');
                const safePayload = {
                    client_event_id: payload.client_event_id,
                    class_id: payload.class_id,
                    course_id: payload.course_id,
                    course_unit_id: payload.course_unit_id,
                    activity_key: payload.activity_key,
                    rule_version: payload.rule_version,
                    event_type: payload.event_type,
                    evidence: cloneJson(payload.evidence, 'pending.payload.evidence'),
                    occurred_at: payload.occurred_at
                };
                if (payload.assignment_id !== undefined) safePayload.assignment_id = payload.assignment_id;
                return deepFreezeJson({
                    state: record.state,
                    created_at: Number(record.created_at),
                    payload: safePayload
                });
            } catch (error) {
                throw clientError('pending_recovery_schema_invalid', '待同步学习证据不满足安全恢复合同。');
            }
        }).sort((left, right) => {
            const occurred = new Date(left.payload.occurred_at).getTime() - new Date(right.payload.occurred_at).getTime();
            if (occurred) return occurred;
            const created = left.created_at - right.created_at;
            if (created) return created;
            return left.payload.client_event_id.localeCompare(right.payload.client_event_id);
        });
        if (!isCurrentAuthority(generation)) throw cancelledError();
        return Object.freeze(safe);
    }

    async function pendingSummary() {
        assertConfigured();
        const generation = authorityGeneration;
        const summary = await queue().stats();
        if (!isCurrentAuthority(generation)) throw cancelledError();
        return summary;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function destroy() {
        destroyed = true;
        if (flushTimer) global.clearTimeout(flushTimer);
        if (leaseTimer) global.clearInterval(leaseTimer);
        if (flushAbortController) flushAbortController.abort();
        if (authorityAbortController) authorityAbortController.abort();
        flushTimer = 0;
        leaseTimer = 0;
        flushDueAt = 0;
        authorityAbortController = null;
        listeners.clear();
        if (queueUnsubscribe) queueUnsubscribe();
        queueUnsubscribe = null;
        global.removeEventListener('online', onOnline);
    }

    function onOnline() {
        scheduleFlush(0);
    }

    global.addEventListener('online', onOnline);

    global.AstraLearningEvidenceClient = Object.freeze({
        configureIdentity,
        suspendAuthority,
        clearAuthority,
        record,
        flush,
        recovery,
        teacherAggregate,
        teacherEvents,
        appendTeacherCorrection,
        projection,
        stateFor,
        pendingFor,
        pendingSummary,
        subscribe,
        normalizeError,
        normalizeEvent,
        destroy,
        eventTypes: Object.freeze(Array.from(EVENT_TYPES))
    });
})(window);
