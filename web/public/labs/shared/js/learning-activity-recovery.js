(function (global) {
    'use strict';

    if (global.AstraLearningActivityRecovery) return;

    const RECOVERY_SCHEMA = 'astra-learning-activity-recovery-v2';
    const SIDECAR_SCHEMA = 'astra-learning-activity-evidence-sidecar-v1';

    function create(settings) {
        if (!settings || typeof settings !== 'object') {
            throw new TypeError('recovery settings are required');
        }
        const helpers = settings.helpers || {};
        [
            'plain', 'copy', 'freeze', 'canonical', 'token', 'integer',
            'timestamp', 'identity', 'sameIdentity', 'evidencePolicy', 'fail'
        ].forEach(function (name) {
            if (typeof helpers[name] !== 'function') {
                throw new TypeError('recovery helper ' + name + ' is required');
            }
        });
        const manifest = settings.manifest;
        const eventSchema = settings.eventEnvelopeSchemaVersion;
        const learnerEvents = Array.from(settings.learnerEventTypes || []);
        const serverEvents = Array.from(settings.serverDerivedEventTypes || []);
        const projections = Array.from(settings.projectionStates || []);
        const {
            plain, copy, freeze, canonical, token, integer,
            timestamp, identity: validateIdentity, sameIdentity, evidencePolicy, fail
        } = helpers;

        function exactKeys(value, required, optional, code, label) {
            const allowed = new Set(required.concat(optional || []));
            if (
                !plain(value)
                || required.some(function (key) { return !Object.hasOwn(value, key); })
                || Object.keys(value).some(function (key) { return !allowed.has(key); })
            ) throw fail(code, label + ' has an incompatible shape');
        }
        function nonnegative(value, field, code) {
            if (!Number.isInteger(value) || value < 0) {
                throw fail(code, field + ' must be a non-negative integer');
            }
            return value;
        }
        function recoveryIdentity(value, label) {
            let result;
            try {
                result = validateIdentity(value);
            } catch (error) {
                throw fail('recovery_identity_mismatch', label + ' identity drifted');
            }
            if (canonical(value) !== canonical(result)) {
                throw fail('recovery_schema_incompatible', label + ' identity is not canonical and exact');
            }
            return result;
        }
        function evidenceData(value, label) {
            const result = freeze(copy(value, label));
            if (!evidencePolicy(result)) {
                throw fail('recovery_sensitive_data_forbidden', label + ' contains sensitive or authority-owned fields');
            }
            return result;
        }
        function commandOf(value, runtimeIdentity, label) {
            exactKeys(
                value,
                ['schema_version', 'scope', 'run', 'versions', 'client_event_id', 'event_type', 'evidence', 'occurred_at'],
                [],
                'recovery_schema_incompatible',
                label + ' command'
            );
            exactKeys(
                value.scope,
                ['class_id', 'course_id', 'course_unit_id', 'activity_key'],
                [],
                'recovery_identity_mismatch',
                label + ' command scope'
            );
            exactKeys(
                value.run,
                ['run_id', 'group_id', 'sequence'],
                [],
                'recovery_identity_mismatch',
                label + ' command run'
            );
            exactKeys(
                value.versions,
                ['manifest_version', 'content_version', 'event_schema_version', 'rule_version', 'generation'],
                [],
                'recovery_identity_mismatch',
                label + ' command versions'
            );
            const command = freeze({
                schema_version: value.schema_version,
                scope: freeze(copy(value.scope, label + '.command.scope')),
                run: freeze(copy(value.run, label + '.command.run')),
                versions: freeze(copy(value.versions, label + '.command.versions')),
                client_event_id: token(value.client_event_id, label + '.command.client_event_id', 8),
                event_type: String(value.event_type || ''),
                evidence: evidenceData(value.evidence, label + '.command.evidence'),
                occurred_at: timestamp(value.occurred_at, label + '.command.occurred_at')
            });
            if (
                command.schema_version !== eventSchema
                || !learnerEvents.includes(command.event_type)
                || command.scope.class_id !== runtimeIdentity.class_id
                || command.scope.course_id !== runtimeIdentity.course_id
                || command.scope.course_unit_id !== runtimeIdentity.course_unit_id
                || command.scope.activity_key !== runtimeIdentity.activity_key
                || command.run.run_id !== runtimeIdentity.run_id
                || command.run.group_id !== runtimeIdentity.group_id
                || !Number.isInteger(command.run.sequence)
                || command.run.sequence <= 0
                || canonical(command.versions) !== canonical({
                    manifest_version: runtimeIdentity.manifest_version,
                    content_version: runtimeIdentity.content_version,
                    event_schema_version: runtimeIdentity.event_schema_version,
                    rule_version: runtimeIdentity.rule_version,
                    generation: runtimeIdentity.generation
                })
            ) throw fail('recovery_identity_mismatch', label + ' command identity drifted');
            return command;
        }
        function snapshotOf(value, learnerSequence, label, allowIdentity) {
            exactKeys(
                value,
                ['state_schema_version', 'applied_through_learner_sequence', 'data'],
                allowIdentity ? ['identity'] : [],
                'recovery_snapshot_invalid',
                label + ' snapshot'
            );
            if (
                canonical(value.state_schema_version) !== canonical(manifest.content.state_schema_version)
                || value.applied_through_learner_sequence !== learnerSequence
                || !plain(value.data)
            ) throw fail('recovery_snapshot_invalid', label + ' snapshot structure, cursor or schema drifted');
            return freeze({
                state_schema_version: value.state_schema_version,
                applied_through_learner_sequence: learnerSequence,
                data: evidenceData(value.data, label + '.snapshot.data')
            });
        }
        function sidecarOf(value, runtimeIdentity, label) {
            exactKeys(
                value,
                ['schema_version', 'command', 'snapshot'],
                [],
                'recovery_schema_incompatible',
                label + ' sidecar'
            );
            if (value.schema_version !== SIDECAR_SCHEMA) {
                throw fail('recovery_schema_incompatible', label + ' sidecar schema is incompatible');
            }
            const command = commandOf(value.command, runtimeIdentity, label);
            return freeze({
                schema_version: SIDECAR_SCHEMA,
                command: command,
                snapshot: snapshotOf(value.snapshot, command.run.sequence, label)
            });
        }
        function serverFact(value, runtimeIdentity, index) {
            const label = 'server.events[' + index + ']';
            if (!plain(value)) throw fail('recovery_partial', label + ' is invalid');
            const factIdentity = recoveryIdentity(value.identity, label);
            if (!sameIdentity(factIdentity, runtimeIdentity)) {
                throw fail('recovery_identity_mismatch', label + ' identity drifted');
            }
            const eventType = String(value.event_type || '');
            const common = {
                identity: factIdentity,
                server_sequence: integer(value.server_sequence, label + '.server_sequence'),
                server_event_id: token(value.server_event_id, label + '.server_event_id', 8),
                event_type: eventType,
                producer: value.producer,
                occurred_at: timestamp(value.occurred_at, label + '.occurred_at')
            };
            if (learnerEvents.includes(eventType)) {
                exactKeys(
                    value,
                    ['identity', 'server_sequence', 'server_event_id', 'learner_sequence', 'event_type', 'producer', 'occurred_at', 'sidecar'],
                    [],
                    'recovery_schema_incompatible',
                    label
                );
                const sidecar = sidecarOf(value.sidecar, runtimeIdentity, label);
                if (
                    value.producer !== 'learner'
                    || value.learner_sequence !== sidecar.command.run.sequence
                    || eventType !== sidecar.command.event_type
                    || value.occurred_at !== sidecar.command.occurred_at
                ) throw fail('recovery_schema_incompatible', label + ' learner coordinates disagree');
                return freeze(Object.assign(common, {
                    learner_sequence: value.learner_sequence,
                    client_event_id: sidecar.command.client_event_id,
                    evidence: sidecar.command.evidence,
                    sidecar: sidecar
                }));
            }
            exactKeys(
                value,
                ['identity', 'server_sequence', 'server_event_id', 'learner_sequence', 'event_type', 'producer', 'occurred_at', 'evidence'],
                [],
                'recovery_schema_incompatible',
                label
            );
            if (
                !serverEvents.includes(eventType)
                || value.learner_sequence !== null
                || !['server', 'trusted_assessment'].includes(value.producer)
            ) throw fail('recovery_completion_unproven', label + ' derived coordinates are invalid');
            return freeze(Object.assign(common, {
                learner_sequence: null,
                client_event_id: null,
                evidence: freeze(copy(value.evidence, label + '.evidence')),
                sidecar: null
            }));
        }
        function completionWitness(value, projection, events, runtimeIdentity) {
            if (!serverEvents.includes(projection.state)) {
                if (value !== null) {
                    throw fail('recovery_completion_unproven', 'non-terminal projection has a witness');
                }
                return null;
            }
            exactKeys(
                value,
                [
                    'identity', 'projection_state', 'rule_version',
                    'applied_through_server_sequence', 'derived_server_event_id',
                    'derived_server_sequence', 'source_client_event_ids'
                ],
                [],
                'recovery_completion_unproven',
                'completion witness'
            );
            const witnessIdentity = recoveryIdentity(value.identity, 'completion witness');
            const derivedId = token(value.derived_server_event_id, 'completion.derived_server_event_id', 8);
            const derivedSequence = integer(value.derived_server_sequence, 'completion.derived_server_sequence');
            const sourceIds = Array.isArray(value.source_client_event_ids)
                ? value.source_client_event_ids.map(function (id, index) {
                    return token(id, 'completion.source_client_event_ids[' + index + ']', 8);
                })
                : [];
            const derived = events.find(function (event) {
                return event.server_event_id === derivedId
                    && event.server_sequence === derivedSequence
                    && event.event_type === projection.state;
            });
            const sources = sourceIds.map(function (id) {
                return events.find(function (event) {
                    return event.client_event_id === id && learnerEvents.includes(event.event_type);
                });
            });
            if (
                !sameIdentity(witnessIdentity, runtimeIdentity)
                || value.projection_state !== projection.state
                || value.rule_version !== runtimeIdentity.rule_version
                || value.applied_through_server_sequence !== projection.applied_through_server_sequence
                || !derived
                || sourceIds.length === 0
                || new Set(sourceIds).size !== sourceIds.length
                || sources.some(function (event) {
                    return !event || event.server_sequence >= derived.server_sequence;
                })
            ) throw fail('recovery_completion_unproven', 'terminal witness cannot prove the projection');
            return freeze({
                identity: witnessIdentity,
                projection_state: projection.state,
                rule_version: runtimeIdentity.rule_version,
                applied_through_server_sequence: projection.applied_through_server_sequence,
                derived_server_event_id: derivedId,
                derived_server_sequence: derivedSequence,
                source_client_event_ids: Object.freeze(sourceIds)
            });
        }
        function recover(value, runtimeIdentity, currentBinding, manualBlock) {
            if (!plain(value)) throw fail('recovery_partial', 'recovery bundle is missing');
            const bundle = freeze(copy(value, 'recovery'));
            exactKeys(bundle, ['schema_version', 'complete', 'atomic', 'stale', 'snapshot_id', 'captured_at', 'identity', 'freshness', 'server', 'offline'], ['manual_resolution'], 'recovery_schema_incompatible', 'recovery bundle');
            exactKeys(bundle.freshness, ['status', 'authority_revision', 'release_revision'], [], 'recovery_schema_incompatible', 'recovery freshness');
            exactKeys(bundle.server, ['identity', 'complete_history', 'event_count', 'events', 'projection', 'snapshot'], [], 'recovery_schema_incompatible', 'recovery server');
            exactKeys(bundle.offline, ['identity', 'complete_pending_set', 'sidecar_count', 'sidecars'], [], 'recovery_schema_incompatible', 'recovery offline');
            if (Object.hasOwn(bundle, 'manual_resolution')) exactKeys(bundle.manual_resolution, ['identity', 'status', 'block_id', 'action', 'resolution_id'], [], 'recovery_schema_incompatible', 'manual resolution');
            if (bundle.schema_version !== RECOVERY_SCHEMA) {
                throw fail('recovery_schema_incompatible', 'recovery schema is incompatible');
            }
            if (bundle.complete !== true) throw fail('recovery_partial', 'recovery is partial');
            if (bundle.atomic !== true) throw fail('recovery_not_atomic', 'recovery is not atomic');
            if (bundle.stale !== false) throw fail('recovery_stale', 'recovery freshness is unknown');
            const snapshotId = token(bundle.snapshot_id, 'recovery.snapshot_id', 8);
            timestamp(bundle.captured_at, 'recovery.captured_at');
            if (!sameIdentity(recoveryIdentity(bundle.identity, 'bundle'), runtimeIdentity)) {
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
                !sameIdentity(recoveryIdentity(bundle.server.identity, 'server'), runtimeIdentity)
                || !sameIdentity(recoveryIdentity(bundle.offline.identity, 'offline'), runtimeIdentity)
            ) throw fail('recovery_identity_mismatch', 'recovery source identity drifted');
            if (bundle.server.complete_history !== true || bundle.offline.complete_pending_set !== true) {
                throw fail('recovery_partial', 'complete history and pending set are required');
            }
            if (!Array.isArray(bundle.server.events) || !Array.isArray(bundle.offline.sidecars)) {
                throw fail('recovery_partial', 'recovery collections are required');
            }
            if (
                bundle.server.event_count !== bundle.server.events.length
                || bundle.offline.sidecar_count !== bundle.offline.sidecars.length
            ) throw fail('recovery_partial', 'recovery counts disagree');

            const serverHistory = bundle.server.events.map(function (event, index) {
                return serverFact(event, runtimeIdentity, index);
            });
            const serverEventIds = new Set();
            const confirmedByClientId = new Map();
            let confirmedLearnerSequence = 0;
            serverHistory.forEach(function (event, index) {
                if (event.server_sequence !== index + 1 || serverEventIds.has(event.server_event_id)) {
                    throw fail('recovery_order_unproven', 'server history is not contiguous and unique');
                }
                serverEventIds.add(event.server_event_id);
                if (event.learner_sequence !== null) {
                    confirmedLearnerSequence += 1;
                    if (
                        event.learner_sequence !== confirmedLearnerSequence
                        || confirmedByClientId.has(event.client_event_id)
                    ) throw fail('recovery_order_unproven', 'learner history is not contiguous and unique');
                    confirmedByClientId.set(event.client_event_id, event.sidecar);
                }
            });
            const serverLastSequence = serverHistory.length;
            if (!plain(bundle.server.projection)) {
                throw fail('recovery_partial', 'server projection is required');
            }
            exactKeys(
                bundle.server.projection,
                ['state', 'applied_through_server_sequence', 'completion_witness'],
                [],
                'recovery_schema_incompatible',
                'server projection'
            );
            const projection = freeze({
                state: String(bundle.server.projection.state || ''),
                applied_through_server_sequence: nonnegative(
                    bundle.server.projection.applied_through_server_sequence,
                    'projection.applied_through_server_sequence',
                    'recovery_order_unproven'
                )
            });
            if (
                !projections.includes(projection.state)
                || projection.applied_through_server_sequence !== serverLastSequence
            ) throw fail('recovery_order_unproven', 'projection is not tied to the server cursor');
            const witness = completionWitness(
                bundle.server.projection.completion_witness,
                projection,
                serverHistory,
                runtimeIdentity
            );

            if (!plain(bundle.server.snapshot)) {
                throw fail('recovery_snapshot_invalid', 'server domain snapshot is missing');
            }
            if (!sameIdentity(recoveryIdentity(bundle.server.snapshot.identity, 'snapshot'), runtimeIdentity)) {
                throw fail('recovery_identity_mismatch', 'snapshot identity drifted');
            }
            const serverSnapshot = snapshotOf(
                bundle.server.snapshot,
                confirmedLearnerSequence,
                'server',
                true
            );
            if (confirmedLearnerSequence > 0) {
                const latestConfirmed = serverHistory.filter(function (event) {
                    return event.learner_sequence !== null;
                }).at(-1).sidecar.snapshot;
                if (canonical(serverSnapshot) !== canonical(latestConfirmed)) {
                    throw fail('recovery_snapshot_invalid', 'server snapshot is not the latest learner snapshot');
                }
            }

            const offlineIds = new Set();
            const pendingSidecars = [];
            let nextLearnerSequence = confirmedLearnerSequence + 1;
            bundle.offline.sidecars.forEach(function (value, index) {
                const sidecar = sidecarOf(value, runtimeIdentity, 'offline.sidecars[' + index + ']');
                const eventId = sidecar.command.client_event_id;
                if (offlineIds.has(eventId)) {
                    throw fail('recovery_conflict', 'offline client_event_id is repeated');
                }
                offlineIds.add(eventId);
                const confirmed = confirmedByClientId.get(eventId);
                if (confirmed) {
                    if (canonical(confirmed) !== canonical(sidecar)) {
                        throw fail('recovery_conflict', 'network replay conflicts with server history');
                    }
                    return;
                }
                if (sidecar.command.run.sequence !== nextLearnerSequence) {
                    throw fail('recovery_order_unproven', 'offline learner facts cannot be ordered');
                }
                nextLearnerSequence += 1;
                pendingSidecars.push(sidecar);
            });
            const latestSnapshot = pendingSidecars.length
                ? pendingSidecars[pendingSidecars.length - 1].snapshot
                : serverSnapshot;

            const resolution = bundle.manual_resolution;
            const resolvedIdentity = plain(resolution)
                ? recoveryIdentity(resolution.identity, 'manual resolution')
                : null;
            if (resolvedIdentity && !sameIdentity(resolvedIdentity, runtimeIdentity)) {
                throw fail('recovery_identity_mismatch', 'manual resolution identity drifted');
            }
            if (manualBlock) {
                if (!sameIdentity(manualBlock.identity, runtimeIdentity)) {
                    throw fail('recovery_identity_mismatch', 'manual intervention belongs to another runtime identity');
                }
                if (
                    !plain(resolution)
                    || resolution.status !== 'resolved'
                    || resolution.block_id !== manualBlock.block_id
                    || !sameIdentity(resolvedIdentity, manualBlock.identity)
                    || !sameIdentity(resolvedIdentity, runtimeIdentity)
                    || !['apply-atomic-snapshot', 'verified-safe-restart'].includes(resolution.action)
                ) throw fail('manual_intervention_unresolved', 'manual intervention is unresolved');
                token(resolution.resolution_id, 'manual_resolution.resolution_id', 8);
                if (
                    resolution.action === 'verified-safe-restart'
                    && (
                        projection.state !== 'not_started'
                        || serverHistory.length !== 0
                        || pendingSidecars.length !== 0
                    )
                ) throw fail('manual_intervention_unresolved', 'safe restart is not an empty authoritative run');
            }

            return freeze({
                snapshot_id: snapshotId,
                projection_state: projection.state,
                projection_server_sequence: projection.applied_through_server_sequence,
                domain_snapshot: latestSnapshot.data,
                domain_snapshot_learner_sequence: latestSnapshot.applied_through_learner_sequence,
                completion_witness: witness,
                server_events: Object.freeze(serverHistory),
                offline_sidecars: Object.freeze(pendingSidecars),
                next_learner_sequence: nextLearnerSequence,
                server_last_sequence: serverLastSequence
            });
        }

        return Object.freeze({
            sidecar: sidecarOf,
            recover: recover
        });
    }

    global.AstraLearningActivityRecovery = Object.freeze({
        recoverySchemaVersion: RECOVERY_SCHEMA,
        evidenceSidecarSchemaVersion: SIDECAR_SCHEMA,
        create: create
    });
})(window);
