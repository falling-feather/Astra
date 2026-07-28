(function (global) {
    'use strict';

    if (global.AstraLearningEvidenceLoader) return;

    const current = document.currentScript && document.currentScript.src
        ? document.currentScript.src
        : new URL('shared/js/learning-evidence-loader.js', document.baseURI).href;
    const base = new URL('./', current);
    const assetVersion = new URL(current, document.baseURI).searchParams.get('v') || '';
    const pending = new Map();
    const representativeActivities = new Map([
        ['englab:physics.mechanics', true],
        ['code-space:control-flow.loop-boundary', true]
    ]);
    const domainConsumers = new Map();
    const FRESH_SESSION_AUTHORITY = Object.freeze({});
    const AUTHORITY_CLEAR_MARKER_KEY = 'astra-learning-evidence-authority-clear-pending-v1';
    const AUTHORITY_CLEAR_MARKER_VALUE = '1';
    const AUTHORITY_CLEAR_COOKIE_KEY = 'astra_learning_evidence_authority_clear_pending_v1';
    const AUTHORITY_CLEAR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
    const AUTHORITY_CLEAR_EPOCH_KEY = 'astra-learning-evidence-authority-clear-epoch-v1';
    const AUTHORITY_CLEAR_EPOCH_COOKIE_KEY = 'astra_learning_evidence_authority_clear_epoch_v1';
    const AUTHORITY_CLEAR_CHANNEL_NAME = 'astra-learning-evidence-authority-clear-v1';
    const AUTHORITY_CLEAR_CHANNEL_MESSAGE = Object.freeze({
        type: 'authority-clear-pending',
        marker: AUTHORITY_CLEAR_MARKER_VALUE
    });
    let pendingDomainCommands = [];
    let identityPromise = null;
    let identityKey = '';
    let authorityActive = false;
    let authorityCleared = false;
    let authorityClearFailed = false;
    let authorityClearPromise = null;
    let authorityMutationTail = Promise.resolve();
    let requiresFreshSession = false;
    let clientAuthorityUnsubscribe = null;
    let authorityClearChannel = null;
    let authorityClearChannelPaused = false;
    let authorityPendingLatched = false;
    let observedAuthorityClearEpoch = '';

    function authorityMarkerError(code, message, cause) {
        const error = new Error(message);
        error.code = code;
        if (cause) error.cause = cause;
        return error;
    }

    function authorityMarkerStorage() {
        let storage;
        try {
            storage = global.localStorage;
        } catch (error) {
            throw authorityMarkerError(
                'learning_evidence_authority_marker_unavailable',
                'Learning evidence authority marker storage is unavailable.',
                error
            );
        }
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
            throw authorityMarkerError(
                'learning_evidence_authority_marker_unavailable',
                'Learning evidence authority marker storage is unavailable.'
            );
        }
        return storage;
    }

    function readLocalStorageAuthorityClearMarker() {
        try {
            return authorityMarkerStorage().getItem(AUTHORITY_CLEAR_MARKER_KEY) !== null;
        } catch (error) {
            if (error && error.code === 'learning_evidence_authority_marker_unavailable') throw error;
            throw authorityMarkerError(
                'learning_evidence_authority_marker_read_failed',
                'Learning evidence authority marker could not be read.',
                error
            );
        }
    }

    function writeLocalStorageAuthorityClearMarker() {
        try {
            const storage = authorityMarkerStorage();
            storage.setItem(AUTHORITY_CLEAR_MARKER_KEY, AUTHORITY_CLEAR_MARKER_VALUE);
            if (storage.getItem(AUTHORITY_CLEAR_MARKER_KEY) !== AUTHORITY_CLEAR_MARKER_VALUE) {
                throw new Error('Authority clear marker write was not durable.');
            }
        } catch (error) {
            if (error && error.code === 'learning_evidence_authority_marker_unavailable') throw error;
            throw authorityMarkerError(
                'learning_evidence_authority_marker_write_failed',
                'Learning evidence authority marker could not be persisted.',
                error
            );
        }
    }

    function removeLocalStorageAuthorityClearMarker() {
        try {
            const storage = authorityMarkerStorage();
            storage.removeItem(AUTHORITY_CLEAR_MARKER_KEY);
            if (storage.getItem(AUTHORITY_CLEAR_MARKER_KEY) !== null) {
                throw new Error('Authority clear marker removal was not durable.');
            }
        } catch (error) {
            if (error && error.code === 'learning_evidence_authority_marker_unavailable') throw error;
            throw authorityMarkerError(
                'learning_evidence_authority_marker_remove_failed',
                'Learning evidence authority marker could not be removed.',
                error
            );
        }
    }

    function cookieValue(key) {
        try {
            const cookies = String(document.cookie || '').split(';');
            for (const cookie of cookies) {
                const entry = cookie.trim();
                const separator = entry.indexOf('=');
                if (separator < 0 || entry.slice(0, separator) !== key) continue;
                const value = entry.slice(separator + 1);
                if (value) return value;
            }
            return null;
        } catch (error) {
            throw authorityMarkerError(
                'learning_evidence_authority_cookie_read_failed',
                'Learning evidence authority fallback marker could not be read.',
                error
            );
        }
    }

    function authorityClearCookieValue() {
        return cookieValue(AUTHORITY_CLEAR_COOKIE_KEY);
    }

    function readCookieAuthorityClearMarker() {
        return authorityClearCookieValue() !== null;
    }

    function writeCookieAuthorityClearMarker() {
        try {
            document.cookie = `${AUTHORITY_CLEAR_COOKIE_KEY}=${AUTHORITY_CLEAR_MARKER_VALUE}; Path=/; Max-Age=${AUTHORITY_CLEAR_COOKIE_MAX_AGE}; SameSite=Strict`;
            if (authorityClearCookieValue() !== AUTHORITY_CLEAR_MARKER_VALUE) {
                throw new Error('Authority clear fallback marker write was not durable.');
            }
        } catch (error) {
            throw authorityMarkerError(
                'learning_evidence_authority_cookie_write_failed',
                'Learning evidence authority fallback marker could not be persisted.',
                error
            );
        }
    }

    function removeCookieAuthorityClearMarker() {
        try {
            document.cookie = `${AUTHORITY_CLEAR_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Strict`;
            if (authorityClearCookieValue() !== null) {
                throw new Error('Authority clear fallback marker removal was not durable.');
            }
        } catch (error) {
            throw authorityMarkerError(
                'learning_evidence_authority_cookie_remove_failed',
                'Learning evidence authority fallback marker could not be removed.',
                error
            );
        }
    }

    function readAuthorityClearMarker() {
        let localStorageError = null;
        let cookieError = null;
        try {
            if (readLocalStorageAuthorityClearMarker()) return true;
        } catch (error) {
            localStorageError = error;
        }
        try {
            if (readCookieAuthorityClearMarker()) return true;
        } catch (error) {
            cookieError = error;
        }
        if (localStorageError) throw localStorageError;
        if (cookieError) throw cookieError;
        return false;
    }

    function writeAuthorityClearMarker() {
        let localStorageError = null;
        try {
            writeLocalStorageAuthorityClearMarker();
            return;
        } catch (error) {
            localStorageError = error;
        }
        try {
            writeCookieAuthorityClearMarker();
        } catch (cookieError) {
            throw authorityMarkerError(
                'learning_evidence_authority_marker_write_failed',
                'Learning evidence authority marker could not be persisted in either durable channel.',
                cookieError || localStorageError
            );
        }
    }

    function removeAuthorityClearMarker() {
        const failures = [];
        try {
            removeLocalStorageAuthorityClearMarker();
        } catch (error) {
            failures.push(error);
        }
        try {
            removeCookieAuthorityClearMarker();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length) {
            throw authorityMarkerError(
                'learning_evidence_authority_marker_remove_failed',
                'Learning evidence authority marker could not be removed from every durable channel.',
                failures[0]
            );
        }
    }

    function authorityClearEpochSnapshot() {
        let localReadable = false;
        let cookieReadable = false;
        let localValue = '';
        let cookieEpochValue = '';
        let firstError = null;
        try {
            localValue = authorityMarkerStorage().getItem(AUTHORITY_CLEAR_EPOCH_KEY) || '';
            localReadable = true;
        } catch (error) {
            firstError = error;
        }
        try {
            cookieEpochValue = cookieValue(AUTHORITY_CLEAR_EPOCH_COOKIE_KEY) || '';
            cookieReadable = true;
        } catch (error) {
            if (!firstError) firstError = error;
        }
        if (!localReadable && !cookieReadable) {
            throw authorityMarkerError(
                'learning_evidence_authority_epoch_read_failed',
                'Learning evidence authority epoch could not be read.',
                firstError
            );
        }
        return `${localReadable ? localValue : '?'}|${cookieReadable ? cookieEpochValue : '?'}`;
    }

    function nextAuthorityClearEpoch() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }

    function advanceAuthorityClearEpoch() {
        const epoch = nextAuthorityClearEpoch();
        let localWritten = false;
        let cookieWritten = false;
        let firstError = null;
        try {
            const storage = authorityMarkerStorage();
            storage.setItem(AUTHORITY_CLEAR_EPOCH_KEY, epoch);
            if (storage.getItem(AUTHORITY_CLEAR_EPOCH_KEY) !== epoch) {
                throw new Error('Authority clear epoch write was not durable.');
            }
            localWritten = true;
        } catch (error) {
            firstError = error;
        }
        try {
            document.cookie = `${AUTHORITY_CLEAR_EPOCH_COOKIE_KEY}=${epoch}; Path=/; Max-Age=${AUTHORITY_CLEAR_COOKIE_MAX_AGE}; SameSite=Strict`;
            if (cookieValue(AUTHORITY_CLEAR_EPOCH_COOKIE_KEY) !== epoch) {
                throw new Error('Authority clear epoch fallback write was not durable.');
            }
            cookieWritten = true;
        } catch (error) {
            if (!firstError) firstError = error;
        }
        if (!localWritten && !cookieWritten) {
            throw authorityMarkerError(
                'learning_evidence_authority_epoch_write_failed',
                'Learning evidence authority epoch could not be persisted in either durable channel.',
                firstError
            );
        }
        observedAuthorityClearEpoch = authorityClearEpochSnapshot();
    }

    function authorityClearEpochChanged() {
        let current;
        try {
            current = authorityClearEpochSnapshot();
        } catch (_) {
            latchAuthorityClear();
            return true;
        }
        if (!observedAuthorityClearEpoch) {
            observedAuthorityClearEpoch = current;
            return false;
        }
        if (current === observedAuthorityClearEpoch) return false;
        observedAuthorityClearEpoch = current;
        latchAuthorityClear();
        return true;
    }

    function latchAuthorityClear() {
        const shouldSuspend = !authorityPendingLatched;
        authorityPendingLatched = true;
        requiresFreshSession = true;
        authorityActive = false;
        authorityCleared = true;
        authorityClearFailed = true;
        identityKey = '';
        pendingDomainCommands = [];
        const client = global.AstraLearningEvidenceClient;
        if (shouldSuspend && client && typeof client.suspendAuthority === 'function') client.suspendAuthority();
    }

    function persistentAuthorityClearPending() {
        try {
            const pendingClear = readAuthorityClearMarker();
            if (pendingClear) latchAuthorityClear();
            return pendingClear || authorityClearFailed;
        } catch (_) {
            latchAuthorityClear();
            return true;
        }
    }

    function authorityClearPending() {
        return authorityClearEpochChanged() || persistentAuthorityClearPending();
    }

    function handleAuthorityClearChannelMessage(event) {
        const message = event && event.data;
        if (
            !message
            || message.type !== AUTHORITY_CLEAR_CHANNEL_MESSAGE.type
            || message.marker !== AUTHORITY_CLEAR_CHANNEL_MESSAGE.marker
        ) return;
        latchAuthorityClear();
        try {
            observedAuthorityClearEpoch = authorityClearEpochSnapshot();
        } catch (_) {}
    }

    function openAuthorityClearChannel() {
        if (
            authorityClearChannel
            || authorityClearChannelPaused
            || typeof global.BroadcastChannel !== 'function'
        ) return authorityClearChannel;
        try {
            const channel = new global.BroadcastChannel(AUTHORITY_CLEAR_CHANNEL_NAME);
            channel.addEventListener('message', handleAuthorityClearChannelMessage);
            authorityClearChannel = channel;
        } catch (_) {
            authorityClearChannel = null;
        }
        return authorityClearChannel;
    }

    function closeAuthorityClearChannel() {
        const channel = authorityClearChannel;
        if (!channel) return;
        authorityClearChannel = null;
        try {
            channel.removeEventListener('message', handleAuthorityClearChannelMessage);
            channel.close();
        } catch (_) {}
    }

    function notifyAuthorityClearPending() {
        const channel = openAuthorityClearChannel();
        if (!channel) return false;
        try {
            channel.postMessage(AUTHORITY_CLEAR_CHANNEL_MESSAGE);
            return true;
        } catch (_) {
            return false;
        }
    }

    function handleAuthorityPageHide() {
        authorityClearChannelPaused = true;
        closeAuthorityClearChannel();
    }

    function handleAuthorityPageShow() {
        authorityClearChannelPaused = false;
        openAuthorityClearChannel();
        authorityClearPending();
    }

    function domainKey(galaxyKey, activityKey) {
        return `${String(galaxyKey || '')}:${String(activityKey || '')}`;
    }

    function cloneDomainCommand(detail) {
        if (!detail || !['predicted', 'attempted', 'corrected'].includes(detail.event_type)) return null;
        let serialized = '';
        try {
            serialized = JSON.stringify(detail.evidence);
        } catch (_) {}
        if (!serialized || serialized.length > 8192 || /"(?:source(?:_code)?|full_answer|answer_text|free_text|page_snapshot|html|screenshot)"\s*:/i.test(serialized)) {
            return null;
        }
        const command = {
            galaxy_key: String(detail.galaxy_key || ''),
            activity_key: String(detail.activity_key || ''),
            event_type: detail.event_type,
            evidence: JSON.parse(serialized)
        };
        const classId = Number(detail.class_id);
        const courseId = Number(detail.course_id);
        if (Number.isInteger(classId) && classId > 0 && Number.isInteger(courseId) && courseId > 0) {
            command.class_id = classId;
            command.course_id = courseId;
        }
        return command;
    }

    function purgeDomainCommands() {
        const cutoff = Date.now() - (5 * 60 * 1000);
        pendingDomainCommands = pendingDomainCommands.filter(entry => entry.captured_at_ms >= cutoff);
    }

    function captureDomainCommand(event) {
        const detail = cloneDomainCommand(event && event.detail);
        if (!detail) return;
        const key = domainKey(detail.galaxy_key, detail.activity_key);
        if (!representativeActivities.has(key)) return;
        const occurredAt = new Date().toISOString();
        const consumer = domainConsumers.get(key);
        if (consumer) {
            try {
                consumer(detail, occurredAt);
            } catch (error) {
                global.console && global.console.warn('[LearningEvidenceLoader] domain command consumer failed', error.code || error.message);
            }
            return;
        }
        if (requiresFreshSession) {
            return;
        }
        purgeDomainCommands();
        if (pendingDomainCommands.length >= 16) {
            global.console && global.console.warn('[LearningEvidenceLoader] domain command memory buffer is full');
            return;
        }
        pendingDomainCommands.push({ key, detail, occurred_at: occurredAt, captured_at_ms: Date.now() });
    }

    function claimDomainCommands(scope, consumer) {
        const key = domainKey(scope && scope.galaxy_key, scope && scope.activity_key);
        if (!representativeActivities.has(key) || typeof consumer !== 'function') return () => {};
        domainConsumers.set(key, consumer);
        purgeDomainCommands();
        const claimed = pendingDomainCommands.filter(entry => entry.key === key);
        pendingDomainCommands = pendingDomainCommands.filter(entry => entry.key !== key);
        claimed.forEach(entry => {
            try {
                consumer(entry.detail, entry.occurred_at);
            } catch (error) {
                global.console && global.console.warn('[LearningEvidenceLoader] buffered domain command rejected', error.code || error.message);
            }
        });
        return () => {
            if (domainConsumers.get(key) === consumer) domainConsumers.delete(key);
            pendingDomainCommands = pendingDomainCommands.filter(entry => entry.key !== key);
        };
    }

    function clearDomainCommands(galaxyKey, activityKey) {
        const key = domainKey(galaxyKey, activityKey);
        pendingDomainCommands = pendingDomainCommands.filter(entry => entry.key !== key);
    }

    function asset(name) {
        const url = new URL(name, base);
        if (assetVersion) url.searchParams.set('v', assetVersion);
        return url.href;
    }

    function loadScript(name, ready) {
        if (ready && ready()) return Promise.resolve();
        const src = asset(name);
        if (pending.has(src)) return pending.get(src);
        const promise = new Promise((resolve, reject) => {
            let existing = Array.from(document.scripts).find(script => script.src === src);
            if (existing && existing.dataset.astraResourceState === 'failed') {
                existing.remove();
                existing = null;
            }
            const script = existing || document.createElement('script');
            let settled = false;
            let pollTimer = 0;
            let timeoutTimer = 0;
            const cleanup = () => {
                if (pollTimer) global.clearInterval(pollTimer);
                if (timeoutTimer) global.clearTimeout(timeoutTimer);
                script.removeEventListener('load', onLoad);
                script.removeEventListener('error', onError);
            };
            const settle = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) {
                    script.dataset.astraResourceState = 'failed';
                    if (script.dataset.learningEvidenceResource === 'true') script.remove();
                    reject(error);
                }
                else resolve();
            };
            const checkReady = () => {
                if (!ready || ready()) {
                    script.dataset.astraResourceState = 'loaded';
                    settle();
                    return true;
                }
                return false;
            };
            const onLoad = () => {
                script.dataset.astraResourceState = 'loaded';
                if (!checkReady()) {
                    settle(Object.assign(
                        new Error(`Learning evidence resource did not install: ${name}`),
                        { code: 'learning_evidence_resource_invalid' }
                    ));
                }
            };
            const onError = () => {
                script.dataset.astraResourceState = 'failed';
                settle(Object.assign(
                    new Error(`Learning evidence resource failed: ${name}`),
                    { code: 'learning_evidence_resource_load_failed' }
                ));
            };
            script.addEventListener('load', onLoad);
            script.addEventListener('error', onError);
            timeoutTimer = global.setTimeout(() => {
                if (checkReady()) return;
                script.dataset.astraResourceState = 'failed';
                settle(Object.assign(
                    new Error(`Learning evidence resource timed out: ${name}`),
                    { code: 'learning_evidence_resource_timeout' }
                ));
            }, 10000);
            if (!existing) {
                script.dataset.astraResourceState = 'loading';
                script.dataset.learningEvidenceResource = 'true';
                script.src = src;
                script.async = false;
                document.head.appendChild(script);
            } else if (script.dataset.astraResourceState === 'failed') {
                onError();
            } else if (!checkReady()) {
                pollTimer = global.setInterval(checkReady, 25);
            }
        }).finally(() => pending.delete(src));
        pending.set(src, promise);
        return promise;
    }

    function loadStyle() {
        const href = asset('../css/learning-evidence.css');
        if (Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(link => link.href === href)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.learningEvidenceStyle = 'true';
        document.head.appendChild(link);
    }

    async function ensureCore() {
        loadStyle();
        await loadScript('learning-evidence-queue.js', () => Boolean(global.AstraLearningEvidenceQueue));
        await loadScript('learning-evidence-client.js', () => Boolean(global.AstraLearningEvidenceClient));
        await loadScript('learning-evidence-status.js', () => Boolean(global.AstraLearningEvidenceStatus));
        await loadScript('learning-activity-catalog.js', () => Boolean(global.AstraLearningActivityCatalog));
        observeClientAuthority(global.AstraLearningEvidenceClient);
        return global.AstraLearningEvidenceClient;
    }

    function observeClientAuthority(client) {
        if (clientAuthorityUnsubscribe || !client || typeof client.subscribe !== 'function') return;
        clientAuthorityUnsubscribe = client.subscribe(change => {
            if (!change || change.type !== 'authority-cleared' || change.reason !== 'peer-tab') return;
            requiresFreshSession = true;
            authorityActive = false;
            authorityCleared = true;
            authorityClearFailed = false;
            identityKey = '';
            pendingDomainCommands = [];
        });
    }

    function enqueueAuthorityMutation(operation) {
        const next = authorityMutationTail.catch(() => {}).then(operation);
        authorityMutationTail = next.catch(() => {});
        return next;
    }

    async function performAuthorityClear(reason) {
        latchAuthorityClear();
        try {
            writeAuthorityClearMarker();
            advanceAuthorityClearEpoch();
            notifyAuthorityClearPending();
            const client = await ensureCore();
            await client.clearAuthority(reason);
            removeAuthorityClearMarker();
            authorityClearFailed = false;
        } catch (error) {
            latchAuthorityClear();
            throw error;
        }
    }

    async function recoverPendingAuthority() {
        if (!authorityClearPending()) return false;
        await clearAuthority('recover-persistent-authority-clear');
        return true;
    }

    async function configureIdentity(user, authority) {
        if (!user) return null;
        const trustedFreshSession = authority === FRESH_SESSION_AUTHORITY;
        if (authorityClearPromise) await authorityClearPromise;
        if (authorityClearPending()) await clearAuthority('retry-after-clear-failure');
        if (requiresFreshSession && !trustedFreshSession) {
            const error = new Error('A fresh session confirmation is required before learning evidence can be re-enabled.');
            error.code = 'identity_required';
            throw error;
        }
        const nextKey = `${String(user.id || user.user_id || '')}:${String(user.role || '').toLowerCase()}`;
        if (identityPromise) {
            return identityPromise.catch(() => {}).then(() => (
                !requiresFreshSession && identityKey === nextKey
                    ? global.AstraLearningEvidenceClient
                    : configureIdentity(user, authority)
            ));
        }
        const operation = enqueueAuthorityMutation(async () => {
            const client = await ensureCore();
            if (authorityActive && identityKey && identityKey !== nextKey) {
                await performAuthorityClear('identity-changed');
            }
            await client.configureIdentity(user);
            identityKey = nextKey;
            authorityActive = true;
            authorityCleared = false;
            authorityPendingLatched = false;
            if (trustedFreshSession) requiresFreshSession = false;
            return client;
        });
        identityPromise = operation;
        operation.then(
            () => {
                if (identityPromise === operation) identityPromise = null;
            },
            () => {
                if (identityPromise === operation) identityPromise = null;
            }
        );
        return operation;
    }

    async function ensure(options) {
        const settings = options || {};
        await ensureCore();
        const user = sessionUser();
        if (user && !requiresFreshSession) await configureIdentity(user);
        if (settings.roleHome) {
            await loadScript('role-home-client.js', () => Boolean(global.AstraRoleHomeClient));
        }
        if (settings.engineeringContext) {
            await loadScript('engineering-lab-publication-context.js', () => Boolean(global.AstraEngineeringLabPublicationContext));
        }
        if (settings.activity) {
            await loadScript('learning-evidence-activity.js', () => Boolean(global.AstraLearningEvidenceActivity));
        }
        if (settings.teacher) {
            await loadScript('teacher-learning-evidence.js', () => Boolean(global.AstraTeacherLearningEvidence));
        }
        if (settings.student) {
            await loadScript('student-learning-evidence.js', () => Boolean(global.AstraStudentLearningEvidence));
        }
        return global.AstraLearningEvidenceClient;
    }

    function clearAuthority(reason) {
        latchAuthorityClear();
        if (authorityClearPromise) return authorityClearPromise;
        const operation = enqueueAuthorityMutation(() => performAuthorityClear(reason));
        authorityClearPromise = operation;
        operation.then(
            () => {
                if (authorityClearPromise === operation) authorityClearPromise = null;
            },
            () => {
                if (authorityClearPromise === operation) authorityClearPromise = null;
            }
        );
        return operation;
    }

    function sessionUser() {
        const session = global.AstraApplicationSession;
        return session && typeof session.getUser === 'function' ? session.getUser() : null;
    }

    function handleAuthorityMarkerStorage(event) {
        if (
            !event
            || ![AUTHORITY_CLEAR_MARKER_KEY, AUTHORITY_CLEAR_EPOCH_KEY].includes(event.key)
            || event.newValue === null
        ) return;
        latchAuthorityClear();
        try {
            observedAuthorityClearEpoch = authorityClearEpochSnapshot();
        } catch (_) {}
    }

    try {
        observedAuthorityClearEpoch = authorityClearEpochSnapshot();
    } catch (_) {
        latchAuthorityClear();
    }
    persistentAuthorityClearPending();
    openAuthorityClearChannel();
    global.addEventListener('storage', handleAuthorityMarkerStorage);
    global.addEventListener('pagehide', handleAuthorityPageHide);
    global.addEventListener('pageshow', handleAuthorityPageShow);
    global.addEventListener('astra:session-ready', event => {
        const detail = event && event.detail || {};
        const user = detail.user;
        const session = global.AstraApplicationSession;
        const trustedFreshSession = Boolean(
            session
            && typeof session.consumeLearningEvidenceFreshProof === 'function'
            && session.consumeLearningEvidenceFreshProof(detail.learning_evidence_fresh_proof)
        );
        if (user) configureIdentity(user, trustedFreshSession ? FRESH_SESSION_AUTHORITY : null).catch(error => {
            global.console && global.console.warn('[LearningEvidenceLoader] identity configuration failed', error.code || error.message);
        });
    });
    global.addEventListener('astra:api-auth-required', () => {
        clearAuthority('unauthorized').catch(() => {});
    });
    global.addEventListener('astra:session-signed-out', () => {
        clearAuthority('signed-out').catch(() => {});
    });

    global.AstraLearningEvidenceLoader = Object.freeze({
        ensure,
        ensureCore,
        configureIdentity,
        clearAuthority,
        recoverPendingAuthority,
        isAuthorityClearPending: authorityClearPending,
        claimDomainCommands,
        clearDomainCommands,
        asset
    });

    global.addEventListener('astra:learning-domain-command', captureDomainCommand);
    const user = sessionUser();
    if (user && !requiresFreshSession) configureIdentity(user).catch(() => {});
})(window);
