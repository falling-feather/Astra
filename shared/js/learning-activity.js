(function (global) {
    'use strict';

    if (global.AstraLearningActivity) return;

    const RecoveryContract = global.AstraLearningActivityRecovery;
    if (!RecoveryContract || typeof RecoveryContract.create !== 'function') {
        throw new Error('AstraLearningActivityRecovery must load before AstraLearningActivity');
    }

    const SCHEMA = 'astra-learning-activity-v1';
    const RECOVERY_SCHEMA = RecoveryContract.recoverySchemaVersion;
    const SIDECAR_SCHEMA = RecoveryContract.evidenceSidecarSchemaVersion;
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
        'recovery_sensitive_data_forbidden',
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
        const recoveryContract = RecoveryContract.create({
            manifest: manifest,
            eventEnvelopeSchemaVersion: EVENT_SCHEMA,
            learnerEventTypes: LEARNER_EVENTS,
            serverDerivedEventTypes: SERVER_EVENTS,
            projectionStates: PROJECTIONS,
            helpers: {
                plain: plain,
                copy: copy,
                freeze: freeze,
                canonical: canonical,
                token: token,
                integer: integer,
                timestamp: timestamp,
                identity: function (value) { return identityOf(value, manifest); },
                sameIdentity: sameIdentity,
                evidencePolicy: function (value) { return !forbidden(value, EVIDENCE_FORBIDDEN); },
                fail: fail
            }
        });
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
        function seedReservations(exact) {
            reservations.clear();
            exact.server_events.forEach(function (event) {
                if (!event.sidecar) return;
                reservations.set(event.sidecar.command.client_event_id, {
                    canonical: canonical(event.sidecar),
                    sidecar: event.sidecar,
                    serverSequence: event.server_sequence
                });
            });
            exact.offline_sidecars.forEach(function (sidecar) {
                reservations.set(sidecar.command.client_event_id, {
                    canonical: canonical(sidecar),
                    sidecar: sidecar,
                    serverSequence: null
                });
            });
            nextSequence = exact.next_learner_sequence;
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
                const exact = recoveryContract.recover(raw, identity, initial, manualBlock);
                const domainInput = freeze({
                    identity: exposedIdentity(identity),
                    snapshot_id: exact.snapshot_id,
                    domain_snapshot: exact.domain_snapshot,
                    domain_snapshot_learner_sequence: exact.domain_snapshot_learner_sequence,
                    server_events: exact.server_events,
                    offline_sidecars: exact.offline_sidecars,
                    server_last_sequence: exact.server_last_sequence,
                    projection_state: exact.projection_state,
                    projection_server_sequence: exact.projection_server_sequence,
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
                    server_last_sequence: exact.server_last_sequence,
                    learner_sequence: exact.domain_snapshot_learner_sequence,
                    domain_state: domain
                });
                seedReservations(exact);
                manualBlock = null;
                state = 'ready';
                return freeze({
                    schema_version: SCHEMA,
                    state: 'ready',
                    identity: exposedIdentity(identity),
                    snapshot_id: exact.snapshot_id,
                    projection_state: exact.projection_state,
                    domain_state: domain,
                    next_learner_sequence: nextSequence,
                    server_last_sequence: exact.server_last_sequence
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
        function evidenceSidecar(value) {
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
            if (
                !plain(value.snapshot)
                || Object.keys(value.snapshot).some(function (key) {
                    return !['state_schema_version', 'data'].includes(key);
                })
                || !Object.hasOwn(value.snapshot, 'state_schema_version')
                || !Object.hasOwn(value.snapshot, 'data')
                || !plain(value.snapshot.data)
                || canonical(value.snapshot.state_schema_version)
                    !== canonical(manifest.content.state_schema_version)
            ) throw fail('evidence_snapshot_invalid', 'post-event canonical snapshot is required');
            const snapshotData = freeze(copy(value.snapshot.data, 'event.snapshot.data'));
            if (forbidden(snapshotData, EVIDENCE_FORBIDDEN)) {
                throw fail('sensitive_evidence_forbidden', 'authority and projection truth cannot enter snapshot');
            }
            [
                'class_id', 'course_id', 'course_unit_id', 'activity_key', 'subject_identity',
                'run_id', 'group_id', 'manifest_version', 'content_version',
                'event_schema_version', 'rule_version', 'generation', 'learner_sequence',
                'server_sequence', 'server_last_sequence'
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
                    sequence: existing ? existing.sidecar.command.run.sequence : nextSequence
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
            const sidecar = recoveryContract.sidecar({
                schema_version: SIDECAR_SCHEMA,
                command: command,
                snapshot: {
                    state_schema_version: value.snapshot.state_schema_version,
                    applied_through_learner_sequence: command.run.sequence,
                    data: snapshotData
                }
            }, identity, 'event');
            const shape = canonical(sidecar);
            if (existing) {
                if (existing.canonical !== shape) {
                    throw fail('client_event_id_conflict', 'client_event_id command or snapshot changed');
                }
                return existing.sidecar;
            }
            if (reservations.size >= MAX_EVENTS) throw fail('event_capacity_reached', 'event capacity reached');
            reservations.set(eventId, { canonical: shape, sidecar: sidecar, serverSequence: null });
            nextSequence += 1;
            return sidecar;
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
                || value.learner_sequence !== command.run.sequence
            ) throw fail('evidence_receipt_mismatch', 'evidence receipt identity disagrees');
            const authoritative = ['confirmed', 'reconciled'].includes(status);
            if (
                authoritative
                    ? (
                        !Number.isInteger(value.server_sequence)
                        || value.server_sequence <= 0
                        || !Number.isInteger(value.server_last_sequence)
                        || value.server_last_sequence < value.server_sequence
                    )
                    : (
                        ![undefined, null].includes(value.server_sequence)
                        || ![undefined, null].includes(value.server_last_sequence)
                    )
            ) throw fail('evidence_receipt_mismatch', 'evidence receipt cursors disagree');
            return freeze({
                status: status,
                client_event_id: value.client_event_id,
                event_type: value.event_type,
                run_id: value.run_id,
                group_id: value.group_id,
                learner_sequence: value.learner_sequence,
                server_sequence: authoritative ? value.server_sequence : null,
                server_last_sequence: authoritative ? value.server_last_sequence : null,
                server_event_id: value.server_event_id === undefined ? null : value.server_event_id
            });
        }
        async function emitEvidence(event, signal) {
            const operation = begin('emitEvidence', ['ready'], 'ready', signal);
            let sidecar;
            try {
                sidecar = evidenceSidecar(event);
                const reservation = reservations.get(sidecar.command.client_event_id);
                const knownServerLast = recovery.server_last_sequence;
                const initial = await checkBinding(identity, operation, binding);
                const receipt = receiptOf(await waitFor(operation, function () {
                    return ports.evidence.emit(sidecar, {
                        signal: operation.controller.signal,
                        authority: identity
                    });
                }), sidecar.command);
                live(operation);
                await checkBinding(identity, operation, initial);
                live(operation);
                const authoritative = ['confirmed', 'reconciled'].includes(receipt.status);
                if (authoritative && (
                    receipt.server_last_sequence < knownServerLast
                    || (reservation.serverSequence === null
                        ? receipt.server_sequence <= knownServerLast
                        : receipt.server_sequence !== reservation.serverSequence)
                )) throw fail('evidence_receipt_mismatch', 'server cursor or learner ledger position drifted');
                if (receipt.status === 'manual-intervention') {
                    return blocked('evidence_manual_intervention', true);
                }
                if (authoritative) {
                    reservation.serverSequence = receipt.server_sequence;
                    recovery = freeze(Object.assign({}, recovery, {
                        server_last_sequence: receipt.server_last_sequence
                    }));
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
                if (sidecar && !AUTHORITY_CODES.has(normalized.code)) {
                    unresolvedId = sidecar.command.client_event_id;
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
        evidenceSidecarSchemaVersion: SIDECAR_SCHEMA,
        provenanceSchemaVersion: PROVENANCE_SCHEMA,
        runtimeStates: STATES,
        projectionStates: PROJECTIONS,
        learnerEventTypes: LEARNER_EVENTS,
        serverDerivedEventTypes: SERVER_EVENTS,
        rawSourceKinds: RAW_KINDS,
        create: create
    });
})(window);
