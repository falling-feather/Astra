(function (global) {
    'use strict';

    const DEFAULT_TIMEOUT_MS = 12000;
    const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
    const LEGACY_TOKEN_STORAGE_KEYS = Object.freeze([
        'astra-access-token',
        'englab-access-token',
        'access_token',
        'auth_token',
        'englab-favorites',
        'englab-ratings',
        'englab-quiz-scores',
        'englab-guide-seen',
        'englab-progress'
    ]);

    class AstraApiError extends Error {
        constructor(message, details) {
            super(message || '请求失败');
            this.name = 'AstraApiError';
            Object.assign(this, details || {});
        }
    }

    async function request(path, options) {
        const config = options || {};
        const method = String(config.method || 'GET').toUpperCase();
        const mutation = !SAFE_METHODS.has(method);
        if (isOffline()) {
            throw new AstraApiError('当前处于离线状态', {
                code: 'offline',
                method,
                mutation,
                ambiguous: false,
                offline: true
            });
        }

        let url;
        let headers;
        let body;
        let clientRequestId = '';
        try {
            if (!/^[A-Z]+$/.test(method)) throw new TypeError('Invalid HTTP method');
            url = buildUrl(path, config.baseUrl, config.params, method);
            headers = new Headers(config.headers || {});
            // Browser authentication is cookie-only. Ignore caller-provided bearer
            // headers so legacy page code cannot accidentally reintroduce tokens.
            headers.delete('Authorization');
            headers.set('Accept', 'application/json');
            if (config.body !== undefined && !headers.has('Content-Type')) {
                headers.set('Content-Type', 'application/json');
            }
            if (mutation && !headers.has('X-Request-ID')) {
                headers.set('X-Request-ID', createRequestId());
            }
            clientRequestId = headers.get('X-Request-ID') || '';
            if (config.body !== undefined) {
                body = JSON.stringify(config.body);
                if (body === undefined) throw new TypeError('Request body is not JSON serializable');
            }
        } catch (error) {
            if (error instanceof AstraApiError) throw error;
            throw new AstraApiError('请求参数无法发送', {
                code: 'invalid_request',
                method,
                mutation,
                requestId: clientRequestId,
                ambiguous: false
            });
        }

        const controller = new AbortController();
        const signals = [config.signal].filter(Boolean);
        const forwardAbort = () => controller.abort();
        signals.forEach((signal) => {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', forwardAbort, { once: true });
        });

        if (controller.signal.aborted) {
            signals.forEach((signal) => signal.removeEventListener('abort', forwardAbort));
            throw new AstraApiError('请求已取消', {
                code: 'cancelled',
                method,
                mutation,
                cancelled: true,
                requestId: clientRequestId,
                ambiguous: false
            });
        }

        let timedOut = false;
        let requestStarted = false;
        let responseReceived = false;
        let responseStatus = 0;
        let responseRequestId = clientRequestId;
        const timeoutMs = normalizeTimeout(config.timeoutMs);
        const timer = global.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            requestStarted = true;
            const response = await global.fetch(url.toString(), {
                method,
                headers,
                credentials: config.credentials || 'include',
                cache: 'no-store',
                redirect: config.redirect || (mutation ? 'error' : 'follow'),
                signal: controller.signal,
                body
            });
            responseReceived = true;
            responseStatus = response.status;
            responseRequestId = response.headers.get('X-Request-ID') || clientRequestId;
            const parsed = await readPayload(response);
            const payload = parsed.payload;
            if (!response.ok) {
                const detail = parsed.validJson ? extractDetail(payload) : '';
                if (response.status === 401 && config.dispatchAuthRequired !== false) {
                    dispatchAuthRequired(responseRequestId);
                }
                throw new AstraApiError(detail || response.statusText || '请求失败', {
                    status: response.status,
                    code: statusCode(response.status),
                    detail,
                    payload,
                    requestId: responseRequestId,
                    method,
                    mutation,
                    ambiguous: false
                });
            }
            if (response.status === 204 || response.status === 205 || method === 'HEAD') return null;
            if (!parsed.validJson || parsed.empty) {
                throw new AstraApiError('后端返回了无法识别的响应格式', {
                    code: 'invalid_response',
                    status: response.status,
                    requestId: responseRequestId,
                    method,
                    mutation,
                    confirmed: mutation,
                    ambiguous: false
                });
            }
            return payload === null ? {} : payload;
        } catch (error) {
            if (error instanceof AstraApiError) throw error;
            if (responseReceived) {
                if (responseStatus === 401 && config.dispatchAuthRequired !== false) {
                    dispatchAuthRequired(responseRequestId);
                }
                if (responseStatus >= 200 && responseStatus < 300) {
                    throw new AstraApiError('服务器已响应，但返回内容未能完整读取', {
                        code: 'invalid_response',
                        status: responseStatus,
                        requestId: responseRequestId,
                        method,
                        mutation,
                        confirmed: mutation,
                        ambiguous: false
                    });
                }
                throw new AstraApiError('服务器已返回错误状态', {
                    code: statusCode(responseStatus),
                    status: responseStatus,
                    requestId: responseRequestId,
                    method,
                    mutation,
                    ambiguous: false
                });
            }
            if (signals.some((signal) => signal.aborted)) {
                throw new AstraApiError('请求已取消', {
                    code: 'cancelled',
                    method,
                    mutation,
                    cancelled: true,
                    requestId: clientRequestId,
                    ambiguous: mutation && requestStarted
                });
            }
            if (timedOut) {
                throw new AstraApiError('请求超时', {
                    code: 'timeout',
                    method,
                    mutation,
                    requestId: clientRequestId,
                    ambiguous: mutation && requestStarted
                });
            }
            throw new AstraApiError('网络连接失败', {
                code: isOffline() ? 'offline' : 'network',
                method,
                mutation,
                requestId: clientRequestId,
                offline: isOffline(),
                ambiguous: mutation && requestStarted
            });
        } finally {
            global.clearTimeout(timer);
            signals.forEach((signal) => signal.removeEventListener('abort', forwardAbort));
        }
    }

    function buildUrl(path, baseUrl, params, method) {
        const requestedBase = String(baseUrl || '').trim();
        const base = normalizeBaseUrl(baseUrl);
        if (requestedBase && !base) {
            throw new AstraApiError('API 地址不在允许范围内', {
                code: 'invalid_api_origin',
                mutation: !SAFE_METHODS.has(String(method || 'GET').toUpperCase()),
                ambiguous: false
            });
        }
        const rawPath = String(path || '');
        const origin = currentOrigin();
        const url = new URL(`${base}${rawPath}`, origin);
        if (!isAllowedApiOrigin(url, origin)) {
            throw new AstraApiError('API 地址不在允许范围内', {
                code: 'invalid_api_origin',
                mutation: !SAFE_METHODS.has(String(method || 'GET').toUpperCase()),
                ambiguous: false
            });
        }
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                url.searchParams.set(key, String(value).trim());
            }
        });
        return url;
    }

    function normalizeBaseUrl(value) {
        const text = String(value || '').trim().replace(/\/+$/, '');
        if (!text) return '';
        try {
            const origin = currentOrigin();
            const url = new URL(text, origin);
            if (!['http:', 'https:'].includes(url.protocol)) return '';
            if (url.username || url.password || url.search || url.hash) return '';
            if (url.pathname && url.pathname !== '/') return '';
            if (!isAllowedApiOrigin(url, origin)) return '';
            return url.origin;
        } catch (error) {
            return '';
        }
    }

    function message(error) {
        if (!error) return '发生未知错误，请稍后重试';
        const code = String(error.code || '');
        if (code === 'offline') return '当前处于离线状态，实时数据已停止加载';
        if (code === 'timeout') {
            return error.ambiguous
                ? '请求超时，写入结果尚未确认；系统不会自动重试'
                : '请求超时，请稍后重试';
        }
        if (code === 'network') {
            return error.ambiguous
                ? '网络连接中断，写入结果尚未确认；系统不会自动重试'
                : '无法连接后端服务，请检查网络或服务状态';
        }
        if (code === 'cancelled') return '请求已取消';
        if (code === 'invalid_response') {
            return error.confirmed
                ? '服务器已确认写入，但返回格式无效；请刷新核对结果'
                : '后端返回格式无效，请稍后重试';
        }
        if (code === 'invalid_api_origin') return 'API 地址不在允许范围内';
        if (code === 'invalid_request') return '请求参数无法发送，请检查输入';

        const status = Number(error.status || 0);
        if (status === 401) return '登录状态已失效，请重新登录';
        if (status === 403) return '当前账号无权访问或执行此操作';
        if (status === 404) return '请求的数据不存在或已被移除';
        if (status === 409) return error.detail || error.message || '当前状态发生冲突，请刷新后重试';
        if (status === 422) return validationMessage(error.payload) || '请求参数未通过校验，请检查输入';
        if (status === 429) return '请求过于频繁，请稍后重试';
        if (status >= 500) return '后端服务暂时不可用，请稍后重试';
        return error.detail || error.message || '请求失败，请稍后重试';
    }

    function scrubLegacyTokens() {
        const removed = [];
        for (const storageName of ['localStorage', 'sessionStorage']) {
            let storage = null;
            try { storage = global[storageName]; } catch (error) {}
            if (!storage) continue;
            for (const key of LEGACY_TOKEN_STORAGE_KEYS) {
                try {
                    if (storage.getItem(key) !== null) {
                        storage.removeItem(key);
                        removed.push(`${storageName}:${key}`);
                    }
                } catch (error) {}
            }
        }
        return removed;
    }

    function offlineError() {
        return new AstraApiError('当前处于离线状态', {
            code: 'offline',
            offline: true,
            ambiguous: false
        });
    }

    function isOffline() {
        return Boolean(global.navigator && global.navigator.onLine === false);
    }

    function isCancelled(error) {
        return Boolean(error && (error.cancelled || error.code === 'cancelled'));
    }

    function isAmbiguousMutation(error) {
        return Boolean(error && error.ambiguous && error.mutation !== false);
    }

    async function readPayload(response) {
        const text = await response.text();
        if (!text) return { payload: null, validJson: true, empty: true };
        try {
            return { payload: JSON.parse(text), validJson: true, empty: false };
        } catch (error) {
            return { payload: null, validJson: false, empty: false };
        }
    }

    function isAllowedApiOrigin(url, currentOrigin) {
        const current = new URL(currentOrigin);
        if (global.ASTRA_LOCAL_PREVIEW_SAME_ORIGIN === true) {
            return url.origin === current.origin;
        }
        if (current.protocol === 'https:' && url.protocol !== 'https:') return false;
        if (url.origin === current.origin) return true;
        if (isLocalHostname(url.hostname) && isLocalHostname(current.hostname)) return true;
        try {
            const configured = global.CONFIG && global.CONFIG.backend && global.CONFIG.backend.apiBaseUrl;
            if (configured) {
                const configuredUrl = new URL(String(configured), current.origin);
                if (url.origin === configuredUrl.origin) return true;
            }
        } catch (error) {}
        return false;
    }

    function currentOrigin() {
        const value = global.location && global.location.origin ? String(global.location.origin) : '';
        try {
            const url = new URL(value);
            if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
        } catch (error) {}
        return 'http://localhost';
    }

    function isLocalHostname(hostname) {
        const value = String(hostname || '').toLowerCase();
        return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
    }

    function dispatchAuthRequired(requestId) {
        if (typeof global.dispatchEvent !== 'function' || typeof global.CustomEvent !== 'function') return;
        try {
            global.dispatchEvent(new global.CustomEvent('astra:api-auth-required', {
                detail: { requestId: requestId || '' }
            }));
        } catch (error) {}
    }

    function extractDetail(payload) {
        if (!payload) return '';
        if (typeof payload === 'string') return payload;
        if (typeof payload.detail === 'string') return payload.detail;
        if (payload.detail && typeof payload.detail === 'object') {
            if (typeof payload.detail.message === 'string') return payload.detail.message;
            if (typeof payload.detail.code === 'string') return payload.detail.code;
        }
        if (Array.isArray(payload.detail)) {
            return payload.detail
                .map((item) => item && (item.msg || item.message) ? String(item.msg || item.message) : '')
                .filter(Boolean)
                .join('；');
        }
        if (typeof payload.message === 'string') return payload.message;
        return '';
    }

    function validationMessage(payload) {
        const detail = extractDetail(payload);
        if (!detail) return '';
        return `请求参数未通过校验：${detail}`;
    }

    function statusCode(status) {
        if (status === 401) return 'unauthorized';
        if (status === 403) return 'forbidden';
        if (status === 404) return 'not_found';
        if (status === 409) return 'conflict';
        if (status === 422) return 'validation';
        if (status === 429) return 'rate_limited';
        if (status >= 500) return 'service_unavailable';
        return 'http_error';
    }

    function normalizeTimeout(value) {
        const parsed = Number(value || DEFAULT_TIMEOUT_MS);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
    }

    function createRequestId() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return `astra-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    const api = Object.freeze({
        Error: AstraApiError,
        request,
        buildUrl,
        normalizeBaseUrl,
        message,
        extractDetail,
        scrubLegacyTokens,
        offlineError,
        isOffline,
        isCancelled,
        isAmbiguousMutation,
        legacyTokenStorageKeys: LEGACY_TOKEN_STORAGE_KEYS
    });

    scrubLegacyTokens();
    global.AstraApiClient = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
