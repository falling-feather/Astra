(function (global) {
    'use strict';

    if (global.AstraLearningActivity) return;

    const SCHEMA = 'astra-learning-activity-v1';
    const RECOVERY_SCHEMA = 'astra-learning-activity-recovery-v1';
    const EVENT_SCHEMA = 'astra-learning-activity-event-v1';
    const PROVENANCE_SCHEMA = 'astra-raw-evidence-provenance-v1';
    const STATES = Object.freeze([
        'created', 'restoring', 'ready', 'interacting', 'assessing', 'blocked', 'disposed'
    ]);
    const PROJECTIONS = Object.freeze(['not_started', 'in_progress', 'completed', 'transferred']);
    const LEARNER_EVENTS = Object.freeze([
        'started', 'predicted', 'attempted', 'corrected', 'explained'
    ]);
    const SERVER_EVENTS = Object.freeze(['completed', 'transferred']);
    const RAW_KINDS = Object.freeze(['request', 'response', 'state', 'dom']);
    const SECTIONS = Object.freeze([
        'identity', 'route', 'owner_adapter', 'content', 'release',
        'assessment', 'evidence', 'resources', 'sources'
    ]);
    const PORTS = Object.freeze({
        authority: 'verify',
        release: 'resolve',
        recovery: 'load',
        evaluation: 'assess',
        evidence: 'emit'
    });
    const ADAPTER_METHODS = Object.freeze(['restore', 'predict', 'observe', 'dispose']);
    const MANUAL_CODES = new Set([
        'recovery_partial', 'recovery_not_atomic', 'recovery_stale',
        'recovery_identity_mismatch', 'recovery_schema_incompatible',
        'recovery_order_unproven', 'recovery_conflict',
        'recovery_completion_unproven', 'recovery_snapshot_invalid',
        'manual_intervention_unresolved', 'evidence_manual_intervention',
        'evidence_receipt_mismatch'
    ]);
    const AUTHORITY_CODES = new Set([
        'authority_denied', 'authority_drift', 'release_not_open', 'release_identity_mismatch'
    ]);
    const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
    const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
    const EVIDENCE_FORBIDDEN = new Set([
        'authorization', 'cookie', 'password', 'token', 'access_token', 'refresh_token',
        'subject_identity', 'subject_user_id', 'identity_id', 'authority_generation',
        'completed', 'transferred', 'projection_state', 'authoritative_completion'
    ]);
    const ASSESSMENT_FORBIDDEN = new Set([
        'completed', 'transferred', 'projection_state',
        'authoritative_completion', 'server_projection'
    ]);
    const MAX_EVENTS = 256;

    function fail(code, message, details) {
        const error = new Error(message || code);
        error.name = 'AstraLearningActivityError';
        error.code = code;
        error.details = details ? freeze(copy(details, 'error.details')) : null;
        return error;
    }
    function plain(value) {
        if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === null || Object.getPrototypeOf(prototype) === null;
    }
    function copy(value, path, seen) {
        const label = path || 'value';
        const visited = seen || new Set();
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw fail('invalid_json', label + ' must be finite');
            return value;
        }
        if (typeof value !== 'object') throw fail('invalid_json', label + ' must be JSON data');
        if (visited.has(value)) throw fail('invalid_json', label + ' must not contain cycles');
        if (!Array.isArray(value) && !plain(value)) throw fail('invalid_json', label + ' must be plain JSON');
        visited.add(value);
        const output = Array.isArray(value) ? [] : {};
        Object.keys(value).forEach(function (key) {
            if (['__proto__', 'prototype', 'constructor'].includes(key)) {
                throw fail('invalid_json', label + ' contains an unsafe key');
            }
            output[key] = copy(value[key], label + '.' + key, visited);
        });
        visited.delete(value);
        return output;
    }
    function freeze(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        Object.keys(value).forEach(function (key) { freeze(value[key]); });
        return Object.freeze(value);
    }
    function canonical(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        return '{' + Object.keys(value).sort().map(function (key) {
            return JSON.stringify(key) + ':' + canonical(value[key]);
        }).join(',') + '}';
    }
    function token(value, field, minimum) {
        const text = String(value === undefined || value === null ? '' : value).trim();
        if (text.length < (minimum || 1) || !TOKEN.test(text)) {
            throw fail('invalid_identity', field + ' is not a stable token', { field: field });
        }
        return text;
    }
    function integer(value, field) {
        if (!Number.isInteger(value) || value <= 0) {
            throw fail('invalid_identity', field + ' must be a positive integer', { field: field });
        }
        return value;
    }
    function version(value, field) {
        return Number.isInteger(value) && value > 0 ? value : token(value, field);
    }
    function requireCanonical(value, normalized, field) {
        if (value !== normalized) throw fail('manifest_not_canonical', field + ' must be canonical');
    }
    function timestamp(value, field) {
        const text = String(value || '');
        const parsed = new Date(text);
        if (!text || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text) {
            throw fail('invalid_timestamp', (field || 'timestamp') + ' must be canonical UTC ISO');
        }
        return text;
    }
    function manifestOf(value) {
        if (!plain(value)) throw fail('manifest_required', 'manifest must be explicitly injected');
        const manifest = freeze(copy(value, 'manifest'));
        if (manifest.schema_version !== SCHEMA) {
            throw fail('manifest_schema_incompatible', 'manifest schema is not supported');
        }
        SECTIONS.forEach(function (section) {
            if (!plain(manifest[section])) {
                throw fail('manifest_section_missing', 'manifest section is required', { section: section });
            }
        });
        ['galaxy_key', 'course_key', 'activity_key'].forEach(function (field) {
            requireCanonical(manifest.identity[field], token(manifest.identity[field], 'manifest.identity.' + field), 'manifest.identity.' + field);
        });
        ['manifest_version', 'content_version', 'event_schema_version'].forEach(function (field) {
            requireCanonical(manifest.identity[field], version(manifest.identity[field], 'manifest.identity.' + field), 'manifest.identity.' + field);
        });
        const canonicalRoute = String(manifest.route.canonical || '');
        if (!canonicalRoute.trim()) throw fail('invalid_manifest', 'manifest canonical route is required');
        requireCanonical(manifest.route.canonical, canonicalRoute.trim(), 'manifest.route.canonical');
        requireCanonical(manifest.owner_adapter.id, token(manifest.owner_adapter.id, 'manifest.owner_adapter.id'), 'manifest.owner_adapter.id');
        requireCanonical(manifest.content.state_schema_version, version(manifest.content.state_schema_version, 'manifest.content.state_schema_version'), 'manifest.content.state_schema_version');
        requireCanonical(manifest.assessment.rubric_id, token(manifest.assessment.rubric_id, 'manifest.assessment.rubric_id'), 'manifest.assessment.rubric_id');
        requireCanonical(manifest.assessment.rubric_version, version(manifest.assessment.rubric_version, 'manifest.assessment.rubric_version'), 'manifest.assessment.rubric_version');
        const scopes = Array.isArray(manifest.release.scope_fields) ? manifest.release.scope_fields : [];
        const requiredScopes = ['class_id', 'course_id', 'course_unit_id'];
        if (
            new Set(scopes).size !== scopes.length
            || !requiredScopes.every(function (field) { return scopes.includes(field); })
            || scopes.some(function (field) { return !requiredScopes.concat('activity_key').includes(field); })
        ) throw fail('manifest_release_scope_invalid', 'manifest release scope must be exact and unique');
        const events = Array.isArray(manifest.evidence.allowed_events)
            ? Array.from(manifest.evidence.allowed_events)
            : [];
        if (
            events.length === 0
            || new Set(events).size !== events.length
            || events.some(function (eventType) { return !LEARNER_EVENTS.includes(eventType); })
            || canonical(manifest.evidence.event_schema_version)
                !== canonical(manifest.identity.event_schema_version)
        ) throw fail('manifest_evidence_invalid', 'manifest evidence declaration is invalid');
        return manifest;
    }
    function dependencies(settings, manifest) {
        if (!plain(settings.ports)) throw fail('ports_required', 'runtime ports must be injected');
        Object.keys(PORTS).forEach(function (name) {
            if (!settings.ports[name] || typeof settings.ports[name][PORTS[name]] !== 'function') {
                throw fail('port_missing', name + '.' + PORTS[name] + ' must be injected');
            }
        });
        if (!settings.adapter) throw fail('adapter_required', 'domain adapter must be injected');
        ADAPTER_METHODS.forEach(function (method) {
            if (typeof settings.adapter[method] !== 'function') {
                throw fail('adapter_missing', 'adapter.' + method + ' must be injected');
            }
        });
        if (String(settings.adapter.id || '') !== String(manifest.owner_adapter.id)) {
            throw fail('adapter_identity_mismatch', 'adapter does not own this manifest');
        }
    }
    function identityOf(value, manifest) {
        if (!plain(value)) throw fail('invalid_identity', 'runtime identity is required');
        if (!plain(value.subject_identity) || !['learner', 'session'].includes(value.subject_identity.kind)) {
            throw fail('invalid_identity', 'learner or verifiable session identity is required');
        }
        const identity = freeze({
            class_id: integer(value.class_id, 'class_id'),
            course_id: integer(value.course_id, 'course_id'),
            course_unit_id: integer(value.course_unit_id, 'course_unit_id'),
            activity_key: token(value.activity_key, 'activity_key'),
            subject_identity: freeze({
                kind: value.subject_identity.kind,
                id: token(value.subject_identity.id, 'subject_identity.id')
            }),
            run_id: token(value.run_id, 'run_id', 8),
            group_id: token(value.group_id, 'group_id', 8),
            manifest_version: version(value.manifest_version, 'manifest_version'),
            content_version: version(value.content_version, 'content_version'),
            event_schema_version: version(value.event_schema_version, 'event_schema_version'),
            rule_version: integer(value.rule_version, 'rule_version'),
            generation: token(value.generation, 'generation')
        });
        if (identity.activity_key !== manifest.identity.activity_key) {
            throw fail('invalid_identity', 'activity identity does not match manifest');
        }
        ['manifest_version', 'content_version', 'event_schema_version'].forEach(function (field) {
            if (canonical(identity[field]) !== canonical(manifest.identity[field])) {
                throw fail('invalid_identity', field + ' does not match manifest');
            }
        });
        return identity;
    }
    function recoveryIdentity(value, manifest, label) {
        try {
            return identityOf(value, manifest);
        } catch (error) {
            throw fail('recovery_identity_mismatch', (label || 'recovery') + ' identity drifted');
        }
    }
    function sameIdentity(left, right) {
        return canonical(left) === canonical(right);
    }
    function exposedIdentity(identity) {
        return freeze({
            scope: {
                class_id: identity.class_id,
                course_id: identity.course_id,
                course_unit_id: identity.course_unit_id,
                activity_key: identity.activity_key
            },
            subject: { kind: identity.subject_identity.kind },
            run: {
                run_id: identity.run_id,
                group_id: identity.group_id,
                generation: identity.generation
            },
            versions: {
                manifest_version: identity.manifest_version,
                content_version: identity.content_version,
                event_schema_version: identity.event_schema_version,
                rule_version: identity.rule_version
            }
        });
    }
    function releaseScope(identity) {
        return freeze({
            class_id: identity.class_id,
            course_id: identity.course_id,
            course_unit_id: identity.course_unit_id,
            activity_key: identity.activity_key
        });
    }
    function forbidden(value, keys) {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(function (item) { return forbidden(item, keys); });
        return Object.keys(value).some(function (key) {
            return keys.has(key.toLowerCase()) || forbidden(value[key], keys);
        });
    }
    function factOf(value, identity, manifest, source) {
        if (!plain(value)) throw fail('recovery_snapshot_invalid', source + ' fact is invalid');
        const factIdentity = recoveryIdentity(value.identity, manifest, source + ' fact');
        if (!sameIdentity(factIdentity, identity)) {
            throw fail('recovery_identity_mismatch', source + ' fact identity drifted');
        }
        const eventType = String(value.event_type || '');
        const allowed = source === 'server'
            ? LEARNER_EVENTS.concat(SERVER_EVENTS)
            : LEARNER_EVENTS;
        if (!allowed.includes(eventType)) {
            throw fail('recovery_schema_incompatible', source + ' event type is incompatible');
        }
        if (LEARNER_EVENTS.includes(eventType) && value.producer !== 'learner') {
            throw fail('recovery_schema_incompatible', 'learner fact producer is invalid');
        }
        if (SERVER_EVENTS.includes(eventType) && !['server', 'trusted_assessment'].includes(value.producer)) {
            throw fail('recovery_completion_unproven', 'derived fact producer is not trusted');
        }
        return freeze({
            identity: factIdentity,
            sequence: integer(value.sequence, source + '.sequence'),
            client_event_id: token(value.client_event_id, source + '.client_event_id', 8),
            event_type: eventType,
            producer: value.producer,
            occurred_at: timestamp(value.occurred_at, source + '.occurred_at'),
            evidence: freeze(copy(value.evidence || {}, source + '.evidence'))
        });
    }
    function completionWitness(value, state, events, identity, manifest) {
        if (!SERVER_EVENTS.includes(state)) {
            if (value !== null && value !== undefined) {
                throw fail('recovery_completion_unproven', 'non-terminal projection has a witness');
            }
            return null;
        }
        if (!plain(value)) throw fail('recovery_completion_unproven', 'terminal witness is missing');
        const witnessIdentity = recoveryIdentity(value.identity, manifest, 'completion witness');
        const derivedId = token(value.derived_client_event_id, 'completion.derived_client_event_id', 8);
        const sourceIds = Array.isArray(value.source_client_event_ids)
            ? Array.from(value.source_client_event_ids)
            : [];
        const derived = events.find(function (event) {
            return event.client_event_id === derivedId && event.event_type === state;
        });
        const sources = sourceIds.map(function (id) {
            return events.find(function (event) { return event.client_event_id === id && LEARNER_EVENTS.includes(event.event_type); });
        });
        if (
            !sameIdentity(witnessIdentity, identity)
            || value.projection_state !== state
            || value.rule_version !== identity.rule_version
            || !derived
            || sourceIds.length === 0
            || new Set(sourceIds).size !== sourceIds.length
            || sources.some(function (event) { return !event || event.sequence >= derived.sequence; })
        ) throw fail('recovery_completion_unproven', 'terminal witness cannot prove the projection');
        return freeze({
            identity: witnessIdentity,
            projection_state: state,
            rule_version: identity.rule_version,
            derived_client_event_id: derivedId,
            source_client_event_ids: Object.freeze(sourceIds)
        });
    }
    function exactRecovery(value, identity, manifest, currentBinding, manualBlock) {
        if (!plain(value)) throw fail('recovery_partial', 'recovery bundle is missing');
        const bundle = freeze(copy(value, 'recovery'));
        if (bundle.schema_version !== RECOVERY_SCHEMA) {
            throw fail('recovery_schema_incompatible', 'recovery schema is incompatible');
        }
        if (bundle.complete !== true) throw fail('recovery_partial', 'recovery is partial');
        if (bundle.atomic !== true) throw fail('recovery_not_atomic', 'recovery is not atomic');
        if (bundle.stale !== false) throw fail('recovery_stale', 'recovery freshness is unknown');
        const snapshotId = token(bundle.snapshot_id, 'recovery.snapshot_id', 8);
        timestamp(bundle.captured_at, 'recovery.captured_at');
        if (!sameIdentity(recoveryIdentity(bundle.identity, manifest, 'bundle'), identity)) {
            throw fail('recovery_identity_mismatch', 'bundle identity drifted');
        }
        if (
            !plain(bundle.freshness)
            || bundle.freshness.status !== 'current'
            || bundle.freshness.authority_revision !== currentBinding.authority.revision
            || bundle.freshness.release_revision !== currentBinding.release.revision
        ) throw fail('recovery_stale', 'recovery is not tied to current authority and release');
        if (!plain(bundle.server) || !plain(bundle.offline)) {
            throw fail('recovery_partial', 'server and offline layers are required');
        }
        if (
            !sameIdentity(recoveryIdentity(bundle.server.identity, manifest, 'server'), identity)
            || !sameIdentity(recoveryIdentity(bundle.offline.identity, manifest, 'offline'), identity)
        ) throw fail('recovery_identity_mismatch', 'recovery source identity drifted');
        if (bundle.server.complete_history !== true || bundle.offline.complete_pending_set !== true) {
            throw fail('recovery_partial', 'complete history and pending set are required');
        }
        if (!Array.isArray(bundle.server.events) || !Array.isArray(bundle.offline.events)) {
            throw fail('recovery_partial', 'recovery event collections are required');
        }
        if (
            bundle.server.event_count !== bundle.server.events.length
            || bundle.offline.event_count !== bundle.offline.events.length
        ) throw fail('recovery_partial', 'recovery event counts disagree');
        const server = bundle.server.events.map(function (event) {
            return factOf(event, identity, manifest, 'server');
        });
        const byId = new Map();
        server.forEach(function (event, index) {
            if (event.sequence !== index + 1 || byId.has(event.client_event_id)) {
                throw fail('recovery_order_unproven', 'server history is not contiguous and unique');
            }
            byId.set(event.client_event_id, event);
        });
        if (!plain(bundle.server.snapshot)) {
            throw fail('recovery_snapshot_invalid', 'domain snapshot is missing');
        }
        if (
            !sameIdentity(
                recoveryIdentity(bundle.server.snapshot.identity, manifest, 'snapshot'),
                identity
            )
            || canonical(bundle.server.snapshot.state_schema_version)
                !== canonical(manifest.content.state_schema_version)
            || bundle.server.snapshot.applied_through_sequence !== server.length
        ) throw fail('recovery_snapshot_invalid', 'domain snapshot is not exact');
        const offline = bundle.offline.events.map(function (event) {
            return factOf(event, identity, manifest, 'offline');
        });
        const offlineIds = new Set();
        const merged = Array.from(server);
        let expected = server.length + 1;
        offline.forEach(function (event) {
            if (offlineIds.has(event.client_event_id)) {
                throw fail('recovery_conflict', 'offline client_event_id is repeated');
            }
            offlineIds.add(event.client_event_id);
            const existing = byId.get(event.client_event_id);
            if (existing) {
                if (canonical(existing) !== canonical(event)) {
                    throw fail('recovery_conflict', 'network replay conflicts with server history');
                }
                return;
            }
            if (event.sequence !== expected) {
                throw fail('recovery_order_unproven', 'offline facts cannot be ordered');
            }
            expected += 1;
            byId.set(event.client_event_id, event);
            merged.push(event);
        });
        const projection = String(bundle.server.projection_state || '');
        if (!PROJECTIONS.includes(projection)) {
            throw fail('recovery_schema_incompatible', 'projection state is unknown');
        }
        const witness = completionWitness(
            bundle.server.completion_witness,
            projection,
            server,
            identity,
            manifest
        );
        if (manualBlock) {
            if (!sameIdentity(manualBlock.identity, identity)) {
                throw fail('recovery_identity_mismatch', 'manual intervention belongs to another runtime identity');
            }
            const resolution = bundle.manual_resolution;
            const resolvedIdentity = plain(resolution)
                ? recoveryIdentity(resolution.identity, manifest, 'manual resolution')
                : null;
            if (
                !plain(resolution)
                || resolution.status !== 'resolved'
                || resolution.block_id !== manualBlock.block_id
                || !sameIdentity(resolvedIdentity, manualBlock.identity)
                || !sameIdentity(resolvedIdentity, identity)
                || !['apply-atomic-snapshot', 'verified-safe-restart'].includes(resolution.action)
            ) throw fail('manual_intervention_unresolved', 'manual intervention is unresolved');
            token(resolution.resolution_id, 'manual_resolution.resolution_id', 8);
            if (
                resolution.action === 'verified-safe-restart'
                && (projection !== 'not_started' || merged.length !== 0)
            ) throw fail('manual_intervention_unresolved', 'safe restart is not an empty authoritative run');
        }
        return freeze({
            snapshot_id: snapshotId,
            projection_state: projection,
            domain_snapshot: freeze(copy(bundle.server.snapshot.data, 'snapshot.data')),
            completion_witness: witness,
            events: Object.freeze(merged),
            next_sequence: merged.reduce(function (maximum, event) {
                return Math.max(maximum, event.sequence);
            }, 0) + 1
        });
    }
    function authorityResult(value, identity, manifest) {
        if (!plain(value) || value.authorized !== true) {
            throw fail('authority_denied', 'learner or session authority is not verified');
        }
        let observed;
        try { observed = identityOf(value.identity, manifest); } catch (error) {
            throw fail('authority_drift', 'authority identity drifted');
        }
        if (!sameIdentity(observed, identity)) throw fail('authority_drift', 'authority identity drifted');
        return freeze({ identity: observed, revision: token(value.revision, 'authority.revision') });
    }
    function releaseResult(value, scope) {
        if (!plain(value) || value.state !== 'open') {
            throw fail('release_not_open', 'release is not explicitly open');
        }
        if (!plain(value.scope)) {
            throw fail('release_identity_mismatch', 'release identity drifted');
        }
        let observed;
        try {
            observed = freeze({
                class_id: integer(value.scope.class_id, 'release.class_id'),
                course_id: integer(value.scope.course_id, 'release.course_id'),
                course_unit_id: integer(value.scope.course_unit_id, 'release.course_unit_id')
            });
        } catch (error) {
            throw fail('release_identity_mismatch', 'release identity drifted');
        }
        if (
            observed.class_id !== scope.class_id
            || observed.course_id !== scope.course_id
            || observed.course_unit_id !== scope.course_unit_id
            || (
                value.scope.activity_key !== undefined
                && value.scope.activity_key !== scope.activity_key
            )
        ) throw fail('release_identity_mismatch', 'release identity drifted');
        return freeze({ scope: observed, revision: token(value.revision, 'release.revision') });
    }
    function create(settings) {
        if (!plain(settings)) throw fail('settings_required', 'runtime settings are required');
        const manifest = manifestOf(settings.manifest);
        dependencies(settings, manifest);
        const ports = settings.ports;
        const adapter = settings.adapter;
        let state = 'created';
        let identity = null;
        let binding = null;
        let recovery = null;
        let active = null;
        let epoch = 0;
        let blockNumber = 0;
        let manualBlock = null;
        let unresolvedId = '';
        let nextSequence = 1;
        const reservations = new Map();

        function begin(name, allowed, next, callerSignal) {
            if (state === 'disposed') throw fail('activity_disposed', 'activity is disposed');
            if (active) throw fail('activity_busy', 'another lifecycle method is active');
            if (!allowed.includes(state)) {
                throw fail('invalid_transition', name + ' is not allowed from ' + state);
            }
            const controller = new AbortController();
            const operation = {
                name: name,
                epoch: epoch,
                controller: controller,
                previousState: state,
                removeAbort: null
            };
            if (callerSignal) {
                if (callerSignal.aborted) controller.abort(callerSignal.reason);
                else {
                    const abort = function () { controller.abort(callerSignal.reason); };
                    callerSignal.addEventListener('abort', abort, { once: true });
                    operation.removeAbort = function () {
                        callerSignal.removeEventListener('abort', abort);
                    };
                }
            }
            active = operation;
            state = next || state;
            return operation;
        }
        function end(operation) {
            if (operation.removeAbort) operation.removeAbort();
            if (active === operation) active = null;
        }
        function live(operation) {
            if (state === 'disposed' || operation.epoch !== epoch) {
                throw fail('activity_disposed', 'late lifecycle response was discarded');
            }
            if (operation.controller.signal.aborted) {
                throw fail('operation_aborted', 'caller cancelled the lifecycle operation');
            }
        }
        function cancellationError(operation) {
            return state === 'disposed' || operation.epoch !== epoch
                ? fail('activity_disposed', 'late lifecycle response was discarded')
                : fail('operation_aborted', 'caller cancelled the lifecycle operation');
        }
        function waitFor(operation, producer) {
            return new Promise(function (resolve, reject) {
                let settled = false;
                const signal = operation.controller.signal;
                const finish = function (callback, value) {
                    if (settled) return;
                    settled = true;
                    signal.removeEventListener('abort', cancel);
                    callback(value);
                };
                const cancel = function () {
                    finish(reject, cancellationError(operation));
                };
                signal.addEventListener('abort', cancel, { once: true });
                Promise.resolve().then(producer).then(
                    function (value) { finish(resolve, value); },
                    function (error) { finish(reject, error); }
                );
                if (signal.aborted) cancel();
            });
        }
        function lifecycleError(error, operation) {
            if (state === 'disposed' || operation.epoch !== epoch) return cancellationError(operation);
            if (operation.bindingFailure === error) return error && error.code ? error : fail('operation_failed', error && error.message);
            if (operation.controller.signal.aborted) return cancellationError(operation);
            return error && error.code ? error : fail('operation_failed', error && error.message);
        }
        async function checkBinding(runtimeIdentity, operation, expected) {
            live(operation);
            const scope = releaseScope(runtimeIdentity);
            const values = await Promise.all([
                waitFor(operation, function () { return ports.authority.verify(runtimeIdentity, { signal: operation.controller.signal }); })
                    .then(function (value) { return authorityResult(value, runtimeIdentity, manifest); }),
                waitFor(operation, function () { return ports.release.resolve(scope, { signal: operation.controller.signal }); })
                    .then(function (value) { return releaseResult(value, scope); })
            ]).catch(function (error) {
                operation.bindingFailure = error;
                operation.controller.abort('binding-peer-failed');
                throw error;
            });
            live(operation);
            const [authority, release] = values;
            if (
                expected
                && (
                    expected.authority.revision !== authority.revision
                    || expected.release.revision !== release.revision
                )
            ) throw fail('authority_drift', 'authority or release revision changed');
            return freeze({ authority: authority, release: release });
        }
        function blocked(code, manual) {
            state = 'blocked';
            if (manual && !manualBlock) {
                blockNumber += 1;
                manualBlock = freeze({
                    block_id: 'activity-block-' + blockNumber + '-' + code,
                    reason: code,
                    identity: identity
                });
            }
            const interventionRequired = Boolean(manualBlock);
            return freeze({
                schema_version: SCHEMA,
                state: 'blocked',
                reason: code,
                resolution: interventionRequired
                    ? 'manual-intervention'
                    : 'retry-after-authority-check',
                block_id: manualBlock ? manualBlock.block_id : null
            });
        }
        function recoveredCommand(event) {
            return freeze({
                schema_version: EVENT_SCHEMA,
                scope: {
                    class_id: event.identity.class_id,
                    course_id: event.identity.course_id,
                    course_unit_id: event.identity.course_unit_id,
                    activity_key: event.identity.activity_key
                },
                run: {
                    run_id: event.identity.run_id,
                    group_id: event.identity.group_id,
                    sequence: event.sequence
                },
                versions: {
                    manifest_version: event.identity.manifest_version,
                    content_version: event.identity.content_version,
                    event_schema_version: event.identity.event_schema_version,
                    rule_version: event.identity.rule_version,
                    generation: event.identity.generation
                },
                client_event_id: event.client_event_id,
                event_type: event.event_type,
                evidence: event.evidence,
                occurred_at: event.occurred_at
            });
        }
        function seedReservations(events, firstSequence) {
            reservations.clear();
            events.filter(function (event) {
                return LEARNER_EVENTS.includes(event.event_type);
            }).forEach(function (event) {
                const command = recoveredCommand(event);
                reservations.set(event.client_event_id, {
                    canonical: canonical(command),
                    command: command
                });
            });
            nextSequence = firstSequence;
            unresolvedId = '';
        }
        async function restore(context, signal) {
            const operation = begin('restore', ['created', 'blocked'], 'restoring', signal);
            try {
                identity = identityOf(Object.assign({}, context || {}, {
                    manifest_version: manifest.identity.manifest_version,
                    content_version: manifest.identity.content_version,
                    event_schema_version: manifest.identity.event_schema_version
                }), manifest);
                const initial = await checkBinding(identity, operation, null);
                const raw = await waitFor(operation, function () {
                    return ports.recovery.load(identity, {
                        signal: operation.controller.signal,
                        schema_version: RECOVERY_SCHEMA
                    });
                });
                live(operation);
                const exact = exactRecovery(raw, identity, manifest, initial, manualBlock);
                const domainInput = freeze({
                    identity: exposedIdentity(identity),
                    snapshot_id: exact.snapshot_id,
                    domain_snapshot: exact.domain_snapshot,
                    events: exact.events,
                    projection_state: exact.projection_state,
                    completion_witness: exact.completion_witness
                });
                const domain = freeze(copy(await waitFor(operation, function () {
                    return adapter.restore(domainInput, { signal: operation.controller.signal });
                }), 'adapter.restore.result'));
                live(operation);
                binding = await checkBinding(identity, operation, initial);
                live(operation);
                recovery = freeze({
                    snapshot_id: exact.snapshot_id,
                    projection_state: exact.projection_state,
                    domain_state: domain
                });
                seedReservations(exact.events, exact.next_sequence);
                manualBlock = null;
                state = 'ready';
                return freeze({
                    schema_version: SCHEMA,
                    state: 'ready',
                    identity: exposedIdentity(identity),
                    snapshot_id: exact.snapshot_id,
                    projection_state: exact.projection_state,
                    domain_state: domain,
                    next_sequence: nextSequence
                });
            } catch (error) {
                const normalized = lifecycleError(error, operation);
                if (normalized.code === 'activity_disposed') throw normalized;
                if (normalized.code === 'operation_aborted') {
                    state = operation.previousState;
                    throw normalized;
                }
                return blocked(normalized.code, MANUAL_CODES.has(normalized.code));
            } finally {
                end(operation);
            }
        }
        async function interact(method, input, signal) {
            const operation = begin(method, ['ready'], 'interacting', signal);
            try {
                const initial = await checkBinding(identity, operation, binding);
                const adapterInput = freeze(copy(input, method + '.input'));
                const result = freeze(copy(await waitFor(operation, function () {
                    return adapter[method](adapterInput, {
                        signal: operation.controller.signal,
                        identity: exposedIdentity(identity),
                        recovery: recovery
                    });
                }), 'adapter.' + method + '.result'));
                live(operation);
                await checkBinding(identity, operation, initial);
                live(operation);
                state = 'ready';
                return freeze({
                    schema_version: SCHEMA,
                    state: 'ready',
                    kind: method === 'predict' ? 'prediction' : 'observation',
                    value: result
                });
            } catch (error) {
                const normalized = lifecycleError(error, operation);
                if (normalized.code === 'activity_disposed') throw normalized;
                if (normalized.code === 'operation_aborted') state = 'ready';
                else if (AUTHORITY_CODES.has(normalized.code)) blocked(normalized.code, false);
                else state = 'ready';
                throw normalized;
            } finally {
                end(operation);
            }
        }
        function predict(input, signal) {
            return interact('predict', input, signal);
        }
        function observe(action, signal) {
            return interact('observe', action, signal);
        }
        async function assess(observation, signal) {
            const operation = begin('assess', ['ready'], 'assessing', signal);
            try {
                const initial = await checkBinding(identity, operation, binding);
                const assessmentInput = freeze(copy(observation, 'assess.observation'));
                const result = freeze(copy(await waitFor(operation, function () {
                    return ports.evaluation.assess(assessmentInput, {
                        signal: operation.controller.signal,
                        identity: exposedIdentity(identity),
                        rubric_id: manifest.assessment.rubric_id,
                        rubric_version: manifest.assessment.rubric_version
                    });
                }), 'evaluation.result'));
                live(operation);
                if (forbidden(result, ASSESSMENT_FORBIDDEN)) {
                    throw fail('client_completion_forbidden', 'formation feedback is not completion truth');
                }
                await checkBinding(identity, operation, initial);
                live(operation);
                state = 'ready';
                return freeze({
                    schema_version: SCHEMA,
                    state: 'ready',
                    kind: 'assessment',
                    value: result
                });
            } catch (error) {
                const normalized = lifecycleError(error, operation);
                if (normalized.code === 'activity_disposed') throw normalized;
                if (normalized.code === 'operation_aborted') state = 'ready';
                else if (AUTHORITY_CODES.has(normalized.code)) blocked(normalized.code, false);
                else state = 'ready';
                throw normalized;
            } finally {
                end(operation);
            }
        }
        function evidenceCommand(value) {
            if (!plain(value)) throw fail('invalid_event', 'evidence event is required');
            const eventType = String(value.event_type || '');
            if (SERVER_EVENTS.includes(eventType)) {
                throw fail('server_projection_only', 'completed/transferred are server-derived only');
            }
            if (!LEARNER_EVENTS.includes(eventType) || !manifest.evidence.allowed_events.includes(eventType)) {
                throw fail('invalid_event_type', 'learner event is not allowed');
            }
            const eventId = String(value.client_event_id || '');
            if (!EVENT_ID.test(eventId)) throw fail('invalid_client_event_id', 'stable client_event_id is required');
            const evidence = freeze(copy(value.evidence || {}, 'event.evidence'));
            if (forbidden(evidence, EVIDENCE_FORBIDDEN)) {
                throw fail('sensitive_evidence_forbidden', 'authority and projection truth cannot enter evidence');
            }
            [
                'class_id', 'course_id', 'course_unit_id', 'activity_key', 'subject_identity',
                'run_id', 'group_id', 'manifest_version', 'content_version',
                'event_schema_version', 'rule_version', 'generation'
            ].forEach(function (field) {
                if (Object.hasOwn(value, field)) {
                    throw fail('event_identity_override', 'runtime owns event identity', { field: field });
                }
            });
            if (unresolvedId && unresolvedId !== eventId) {
                throw fail('evidence_retry_required', 'retry the unknown write with its original id');
            }
            const existing = reservations.get(eventId);
            const command = freeze({
                schema_version: EVENT_SCHEMA,
                scope: {
                    class_id: identity.class_id,
                    course_id: identity.course_id,
                    course_unit_id: identity.course_unit_id,
                    activity_key: identity.activity_key
                },
                run: {
                    run_id: identity.run_id,
                    group_id: identity.group_id,
                    sequence: existing ? existing.command.run.sequence : nextSequence
                },
                versions: {
                    manifest_version: identity.manifest_version,
                    content_version: identity.content_version,
                    event_schema_version: identity.event_schema_version,
                    rule_version: identity.rule_version,
                    generation: identity.generation
                },
                client_event_id: eventId,
                event_type: eventType,
                evidence: evidence,
                occurred_at: timestamp(value.occurred_at, 'event.occurred_at')
            });
            const shape = canonical(command);
            if (existing) {
                if (existing.canonical !== shape) {
                    throw fail('client_event_id_conflict', 'client_event_id facts changed');
                }
                return existing.command;
            }
            if (reservations.size >= MAX_EVENTS) throw fail('event_capacity_reached', 'event capacity reached');
            reservations.set(eventId, { canonical: shape, command: command });
            nextSequence += 1;
            return command;
        }
        function receiptOf(value, command) {
            if (!plain(value)) throw fail('evidence_receipt_mismatch', 'evidence receipt is missing');
            const status = String(value.status || '');
            if (
                !['confirmed', 'reconciled', 'local-pending', 'manual-intervention'].includes(status)
                || value.client_event_id !== command.client_event_id
                || value.event_type !== command.event_type
                || value.run_id !== command.run.run_id
                || value.group_id !== command.run.group_id
                || value.sequence !== command.run.sequence
            ) throw fail('evidence_receipt_mismatch', 'evidence receipt identity disagrees');
            return freeze({
                status: status,
                client_event_id: value.client_event_id,
                event_type: value.event_type,
                run_id: value.run_id,
                group_id: value.group_id,
                sequence: value.sequence,
                server_event_id: value.server_event_id === undefined ? null : value.server_event_id
            });
        }
        async function emitEvidence(event, signal) {
            const operation = begin('emitEvidence', ['ready'], 'ready', signal);
            let command;
            try {
                command = evidenceCommand(event);
                const initial = await checkBinding(identity, operation, binding);
                const receipt = receiptOf(await waitFor(operation, function () {
                    return ports.evidence.emit(command, {
                        signal: operation.controller.signal,
                        authority: identity
                    });
                }), command);
                live(operation);
                await checkBinding(identity, operation, initial);
                live(operation);
                if (receipt.status === 'manual-intervention') {
                    return blocked('evidence_manual_intervention', true);
                }
                unresolvedId = '';
                return freeze({
                    schema_version: SCHEMA,
                    state: 'ready',
                    receipt: receipt,
                    projection_state: recovery.projection_state
                });
            } catch (error) {
                const normalized = lifecycleError(error, operation);
                if (normalized.code === 'activity_disposed') throw normalized;
                if (command && !AUTHORITY_CODES.has(normalized.code)) {
                    unresolvedId = command.client_event_id;
                }
                if (normalized.code === 'operation_aborted') {
                    state = 'ready';
                } else if (AUTHORITY_CODES.has(normalized.code) || MANUAL_CODES.has(normalized.code)) {
                    blocked(normalized.code, MANUAL_CODES.has(normalized.code));
                } else state = 'ready';
                throw normalized;
            } finally {
                end(operation);
            }
        }
        async function dispose(reason) {
            if (state === 'disposed') {
                return freeze({ schema_version: SCHEMA, state: 'disposed', repeated: true });
            }
            epoch += 1;
            state = 'disposed';
            if (active) active.controller.abort(reason || 'disposed');
            identity = null;
            binding = null;
            recovery = null;
            manualBlock = null;
            unresolvedId = '';
            reservations.clear();
            try { await adapter.dispose(reason || 'disposed'); } catch (error) {
                throw fail('adapter_dispose_failed', error && error.message);
            }
            return freeze({ schema_version: SCHEMA, state: 'disposed', repeated: false });
        }

        return Object.freeze({
            restore: restore,
            predict: predict,
            observe: observe,
            assess: assess,
            emitEvidence: emitEvidence,
            dispose: dispose
        });
    }

    global.AstraLearningActivity = Object.freeze({
        schemaVersion: SCHEMA,
        recoverySchemaVersion: RECOVERY_SCHEMA,
        eventEnvelopeSchemaVersion: EVENT_SCHEMA,
        provenanceSchemaVersion: PROVENANCE_SCHEMA,
        runtimeStates: STATES,
        projectionStates: PROJECTIONS,
        learnerEventTypes: LEARNER_EVENTS,
        serverDerivedEventTypes: SERVER_EVENTS,
        rawSourceKinds: RAW_KINDS,
        create: create
    });
})(window);
