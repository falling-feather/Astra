const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const recoveryPath = path.join(root, 'shared/js/learning-activity-recovery.js');
const runtimePath = path.join(root, 'shared/js/learning-activity.js');
const recoverySource = fs.readFileSync(recoveryPath, 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const context = { window: {}, AbortController, Date };
vm.runInNewContext(recoverySource, context, { filename: 'shared/js/learning-activity-recovery.js' });
vm.runInNewContext(runtimeSource, context, { filename: 'shared/js/learning-activity.js' });
const AstraLearningActivity = context.window.AstraLearningActivity;

const NOW = '2026-08-10T08:00:00.000Z';
const clone = (value) => JSON.parse(JSON.stringify(value));
const rejectsCode = (code) => (error) => Boolean(error && error.code === code);

function manifestFor(kind = 'simulation', activityKey = 'physics.mechanics') {
  return {
    schema_version: 'astra-learning-activity-v1',
    identity: {
      galaxy_key: kind === 'future' ? 'future-galaxy' : kind === 'code' ? 'code-space' : 'englab',
      course_key: activityKey.split('.')[0],
      activity_key: activityKey,
      manifest_version: 'manifest-v1',
      content_version: 'content-v1',
      event_schema_version: 1,
    },
    route: { canonical: '#activity/' + activityKey },
    owner_adapter: { id: kind + '-fixture' },
    content: { state_schema_version: 'state-v1' },
    release: { scope_fields: ['class_id', 'course_id', 'course_unit_id'] },
    assessment: { rubric_id: kind + '-rubric', rubric_version: 1 },
    evidence: {
      allowed_events: ['started', 'predicted', 'attempted', 'corrected', 'explained'],
      event_schema_version: 1,
    },
    resources: { budget_bytes: 1024 },
    sources: { items: [{ id: 'fixture-source' }] },
  };
}

function contextFor(activityKey = 'physics.mechanics') {
  return {
    class_id: 11,
    course_id: 101,
    course_unit_id: 1001,
    activity_key: activityKey,
    subject_identity: { kind: 'learner', id: 'learner-42' },
    run_id: 'run-0001',
    group_id: 'group-0001',
    rule_version: 7,
    generation: 'generation-1',
  };
}

function snapshot(learnerSequence, data) {
  return {
    state_schema_version: 'state-v1',
    applied_through_learner_sequence: learnerSequence,
    data: clone(data || { stage: learnerSequence ? 'learner-' + learnerSequence : 'start' }),
  };
}

function command(identity, learnerSequence, eventType, eventId, evidence = {}) {
  return {
    schema_version: 'astra-learning-activity-event-v1',
    scope: {
      class_id: identity.class_id,
      course_id: identity.course_id,
      course_unit_id: identity.course_unit_id,
      activity_key: identity.activity_key,
    },
    run: {
      run_id: identity.run_id,
      group_id: identity.group_id,
      sequence: learnerSequence,
    },
    versions: {
      manifest_version: identity.manifest_version,
      content_version: identity.content_version,
      event_schema_version: identity.event_schema_version,
      rule_version: identity.rule_version,
      generation: identity.generation,
    },
    client_event_id: eventId,
    event_type: eventType,
    evidence: clone(evidence),
    occurred_at: NOW,
  };
}

function sidecar(identity, learnerSequence, eventType, eventId, evidence = {}, data) {
  return {
    schema_version: 'astra-learning-activity-evidence-sidecar-v1',
    command: command(identity, learnerSequence, eventType, eventId, evidence),
    snapshot: snapshot(learnerSequence, data || { stage: eventType }),
  };
}

function learnerRecord(identity, serverSequence, learnerSequence, eventType, eventId, evidence, data) {
  return {
    identity: clone(identity),
    server_sequence: serverSequence,
    server_event_id: 'server-' + eventId,
    learner_sequence: learnerSequence,
    event_type: eventType,
    producer: 'learner',
    occurred_at: NOW,
    sidecar: sidecar(identity, learnerSequence, eventType, eventId, evidence, data),
  };
}

function derivedRecord(identity, serverSequence, eventType, serverEventId, evidence = {}) {
  return {
    identity: clone(identity),
    server_sequence: serverSequence,
    server_event_id: serverEventId,
    learner_sequence: null,
    event_type: eventType,
    producer: 'server',
    occurred_at: NOW,
    evidence: clone(evidence),
  };
}

function witness(identity, projectionState, serverSequence, serverEventId, sourceIds, projectionCursor) {
  return {
    identity: clone(identity),
    projection_state: projectionState,
    rule_version: identity.rule_version,
    applied_through_server_sequence: projectionCursor || serverSequence,
    derived_server_event_id: serverEventId,
    derived_server_sequence: serverSequence,
    source_client_event_ids: clone(sourceIds),
  };
}

function bundle(identity, options = {}) {
  const serverEvents = clone(options.serverEvents || []);
  const offlineSidecars = clone(options.offlineSidecars || []);
  const learnerRecords = serverEvents.filter((event) => event.learner_sequence !== null);
  const latestServerSnapshot = options.serverSnapshot
    ? clone(options.serverSnapshot)
    : learnerRecords.length
      ? clone(learnerRecords.at(-1).sidecar.snapshot)
      : snapshot(0, { stage: 'start' });
  return {
    schema_version: options.schemaVersion || 'astra-learning-activity-recovery-v2',
    complete: options.complete === undefined ? true : options.complete,
    atomic: options.atomic === undefined ? true : options.atomic,
    stale: options.stale === undefined ? false : options.stale,
    snapshot_id: 'snapshot-0001',
    captured_at: NOW,
    identity: clone(identity),
    freshness: {
      status: 'current',
      authority_revision: 'authority-r1',
      release_revision: 'release-r1',
    },
    server: {
      identity: clone(identity),
      complete_history: true,
      event_count: serverEvents.length,
      events: serverEvents,
      projection: {
        state: options.projectionState || 'not_started',
        applied_through_server_sequence: options.projectionCursor === undefined
          ? serverEvents.length
          : options.projectionCursor,
        completion_witness: options.completionWitness === undefined
          ? null
          : clone(options.completionWitness),
      },
      snapshot: {
        identity: clone(identity),
        ...latestServerSnapshot,
      },
    },
    offline: {
      identity: clone(identity),
      complete_pending_set: true,
      sidecar_count: offlineSidecars.length,
      sidecars: offlineSidecars,
    },
    ...(options.manualResolution ? { manual_resolution: clone(options.manualResolution) } : {}),
  };
}

function completedRecovery(identity) {
  const records = [
    learnerRecord(identity, 1, 1, 'started', 'event-start-0001'), learnerRecord(identity, 2, 2, 'attempted', 'event-attempt-01'),
    derivedRecord(identity, 3, 'completed', 'server-complete-01'),
  ];
  return bundle(identity, { serverEvents: records, projectionState: 'completed',
    completionWitness: witness(identity, 'completed', 3, 'server-complete-01', ['event-start-0001', 'event-attempt-01']) });
}

function receiptFor(transport, options = {}) {
  const request = transport.command;
  const status = options.status || 'confirmed';
  const authoritative = ['confirmed', 'reconciled'].includes(status);
  return {
    status,
    client_event_id: request.client_event_id,
    event_type: request.event_type,
    run_id: request.run.run_id,
    group_id: request.run.group_id,
    learner_sequence: request.run.sequence,
    server_sequence: authoritative ? options.serverSequence : null,
    server_last_sequence: authoritative ? options.serverLastSequence : null,
    server_event_id: authoritative ? 'server-' + request.client_event_id : null,
  };
}

function eventInput(eventId, eventType, evidence, data) {
  return {
    client_event_id: eventId,
    event_type: eventType,
    evidence: clone(evidence || {}),
    occurred_at: NOW,
    snapshot: {
      state_schema_version: 'state-v1',
      data: clone(data || { stage: eventType }),
    },
  };
}

function makeHarness(options = {}) {
  const kind = options.kind || 'simulation';
  const activityKey = options.activityKey || 'physics.mechanics';
  const manifest = manifestFor(kind, activityKey);
  const calls = { recovery: [], evidence: [], restore: [] };
  const adapter = {
    id: kind + '-fixture',
    async restore(input) {
      calls.restore.push(input);
      return { kind, stage: input.domain_snapshot.stage };
    },
    async predict(input) { return clone(input); },
    async observe(input) { return clone(input); },
    async dispose() {},
  };
  const ports = {
    authority: {
      async verify(identity) {
        return { authorized: true, identity: clone(identity), revision: 'authority-r1' };
      },
    },
    release: {
      async resolve(scope) {
        return {
          state: 'open',
          scope: {
            class_id: scope.class_id,
            course_id: scope.course_id,
            course_unit_id: scope.course_unit_id,
          },
          revision: 'release-r1',
        };
      },
    },
    recovery: {
      async load(identity) {
        calls.recovery.push(clone(identity));
        return options.recovery
          ? options.recovery(identity, calls.recovery.length)
          : bundle(identity);
      },
    },
    evaluation: { async assess(value) { return { formative: clone(value) }; } },
    evidence: {
      async emit(transport) {
        calls.evidence.push(transport);
        return options.evidence
          ? options.evidence(transport, calls.evidence.length)
          : receiptFor(transport, {
            serverSequence: transport.command.run.sequence,
            serverLastSequence: transport.command.run.sequence,
          });
      },
    },
  };
  return {
    runtime: AstraLearningActivity.create({ manifest, ports, adapter }),
    context: contextFor(activityKey),
    calls,
  };
}

async function blockedByRecovery(makeRecovery) {
  const harness = makeHarness({ recovery: makeRecovery });
  return harness.runtime.restore(harness.context);
}

async function main() {
  assert.equal(AstraLearningActivity.recoverySchemaVersion, 'astra-learning-activity-recovery-v2');
  assert.equal(
    AstraLearningActivity.evidenceSidecarSchemaVersion,
    'astra-learning-activity-evidence-sidecar-v1',
  );
  assert.doesNotMatch(recoverySource, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB)\b/);

  const empty = makeHarness();
  const emptyResult = await empty.runtime.restore(empty.context);
  assert.equal(emptyResult.state, 'ready');
  assert.equal(emptyResult.next_learner_sequence, 1);
  assert.equal(emptyResult.server_last_sequence, 0);

  const legacy = await blockedByRecovery(async (identity) => bundle(identity, {
    schemaVersion: 'astra-learning-activity-recovery-v1',
  }));
  assert.equal(legacy.reason, 'recovery_schema_incompatible', 'legacy-recovery-shape-fail-closed');

  const liveCursors = [];
  const live = makeHarness({
    evidence: async (transport) => {
      const learnerSequence = transport.command.run.sequence;
      const serverSequence = learnerSequence === 3 ? 4 : learnerSequence;
      const serverLastSequence = learnerSequence === 2 ? 3 : serverSequence;
      liveCursors.push({ learnerSequence, serverSequence, serverLastSequence });
      return receiptFor(transport, { serverSequence, serverLastSequence });
    },
  });
  await live.runtime.restore(live.context);
  for (const entry of [
    ['event-live-0001', 'started'],
    ['event-live-0002', 'attempted'],
    ['event-live-0003', 'corrected'],
  ]) {
    await live.runtime.emitEvidence(eventInput(entry[0], entry[1]));
  }
  assert.deepEqual(liveCursors, [
    { learnerSequence: 1, serverSequence: 1, serverLastSequence: 1 },
    { learnerSequence: 2, serverSequence: 2, serverLastSequence: 3 },
    { learnerSequence: 3, serverSequence: 4, serverLastSequence: 4 },
  ], 'learner-2-derived-server-3-next-learner-3');

  const reconciled = makeHarness({
    evidence: async (transport) => receiptFor(transport, {
      status: 'reconciled',
      serverSequence: 1,
      serverLastSequence: 2,
    }),
  });
  await reconciled.runtime.restore(reconciled.context);
  const reconciledResult = await reconciled.runtime.emitEvidence(
    eventInput('event-reconcile1', 'started'),
  );
  assert.equal(reconciledResult.receipt.status, 'reconciled');
  assert.equal(reconciledResult.receipt.server_last_sequence, 2);

  for (const drift of [2, 5]) {
    const sequences = [4, 4, drift];
    const restoredDual = makeHarness({ recovery: completedRecovery,
      evidence: async (transport, count) => receiptFor(transport, {
        serverSequence: sequences[count - 1], serverLastSequence: Math.max(4, sequences[count - 1]),
      }) });
    const dualResult = await restoredDual.runtime.restore(restoredDual.context);
    assert.equal(dualResult.next_learner_sequence, 3);
    assert.equal(dualResult.server_last_sequence, 3);
    assert.equal(restoredDual.calls.restore[0].server_events.length, 3);
    const input = eventInput('event-correct-001', 'corrected');
    assert.equal((await restoredDual.runtime.emitEvidence(input)).receipt.server_sequence, 4, 'fresh-confirmed-receipt-locks-server-position');
    assert.equal((await restoredDual.runtime.emitEvidence(input)).receipt.server_sequence, 4, 'confirmed-receipt-server-position-replay');
    await assert.rejects(restoredDual.runtime.emitEvidence(input), rejectsCode('evidence_receipt_mismatch'), 'confirmed-receipt-server-position-drift-fail-closed');
  }

  const reusedServerSequence = makeHarness({ recovery: completedRecovery,
    evidence: async (transport) => receiptFor(transport, { serverSequence: 2, serverLastSequence: 3 }) });
  await reusedServerSequence.runtime.restore(reusedServerSequence.context);
  await assert.rejects(reusedServerSequence.runtime.emitEvidence(
    eventInput('event-newseq-bad', 'corrected')), rejectsCode('evidence_receipt_mismatch'), 'fresh-receipt-must-append-after-known-server-last');

  const offlineThird = await blockedByRecovery(async (identity) => {
    const records = [
      learnerRecord(identity, 1, 1, 'started', 'event-offline-01'),
      learnerRecord(identity, 2, 2, 'attempted', 'event-offline-02'),
      derivedRecord(identity, 3, 'completed', 'server-offline-c1'),
    ];
    return bundle(identity, {
      serverEvents: records,
      offlineSidecars: [sidecar(identity, 3, 'corrected', 'event-offline-03')],
      projectionState: 'completed',
      completionWitness: witness(
        identity,
        'completed',
        3,
        'server-offline-c1',
        ['event-offline-01', 'event-offline-02'],
      ),
    });
  });
  assert.equal(offlineThird.state, 'ready', offlineThird.reason);
  assert.equal(offlineThird.next_learner_sequence, 4);
  assert.equal(offlineThird.server_last_sequence, 3);
  assert.equal(offlineThird.domain_state.stage, 'corrected');

  const fullySynced = await blockedByRecovery(async (identity) => {
    const records = [
      learnerRecord(identity, 1, 1, 'started', 'event-sync-0001'),
      learnerRecord(identity, 2, 2, 'attempted', 'event-sync-0002'),
      derivedRecord(identity, 3, 'completed', 'server-sync-c001'),
      learnerRecord(identity, 4, 3, 'corrected', 'event-sync-0003'),
    ];
    return bundle(identity, {
      serverEvents: records,
      projectionState: 'completed',
      completionWitness: witness(
        identity,
        'completed',
        3,
        'server-sync-c001',
        ['event-sync-0001', 'event-sync-0002'],
        4,
      ),
    });
  });
  assert.equal(fullySynced.state, 'ready', fullySynced.reason);
  assert.equal(fullySynced.next_learner_sequence, 4);
  assert.equal(fullySynced.server_last_sequence, 4);

  const negativeRecoveries = [
    ['recovery_schema_incompatible', (identity) => {
      const value = bundle(identity, {
        serverEvents: [learnerRecord(identity, 1, 1, 'started', 'event-noside-001')],
      });
      delete value.server.events[0].sidecar;
      return value;
    }],
    ['recovery_order_unproven', (identity) => {
      const records = [learnerRecord(identity, 1, 1, 'started', 'event-gap-00001')];
      records[0].server_sequence = 2;
      return bundle(identity, { serverEvents: records });
    }],
    ['recovery_order_unproven', (identity) => bundle(identity, {
      serverEvents: [learnerRecord(identity, 1, 2, 'started', 'event-gap-00002')],
    })],
    ['recovery_order_unproven', (identity) => bundle(identity, {
      serverEvents: [learnerRecord(identity, 1, 1, 'started', 'event-proj-0001')],
      projectionCursor: 0,
    })],
    ['recovery_snapshot_invalid', (identity) => {
      const records = [learnerRecord(identity, 1, 1, 'started', 'event-snap-0001')];
      return bundle(identity, {
        serverEvents: records,
        serverSnapshot: snapshot(2, { stage: 'wrong-cursor' }),
      });
    }],
    ['recovery_snapshot_invalid', (identity) => {
      const pending = sidecar(identity, 1, 'started', 'event-side-0001');
      pending.snapshot.applied_through_learner_sequence = 2;
      return bundle(identity, { offlineSidecars: [pending] });
    }],
    ['recovery_sensitive_data_forbidden', (identity) => {
      const value = bundle(identity, { offlineSidecars: [sidecar(identity, 1, 'started', 'event-secret-01')] });
      value.offline.sidecars[0].command.evidence.access_token = 'secret';
      return value;
    }],
    ['recovery_sensitive_data_forbidden', (identity) => {
      const value = bundle(identity);
      value.server.snapshot.data.projection_state = 'completed';
      return value;
    }],
    ['recovery_order_unproven', (identity) => bundle(identity, {
      offlineSidecars: [sidecar(identity, 2, 'started', 'event-side-0002')],
    })],
    ['recovery_completion_unproven', (identity) => {
      const records = [
        learnerRecord(identity, 1, 1, 'started', 'event-cause-001'),
        derivedRecord(identity, 2, 'completed', 'server-cause-001'),
        learnerRecord(identity, 3, 2, 'attempted', 'event-cause-002'),
      ];
      return bundle(identity, {
        serverEvents: records,
        projectionState: 'completed',
        completionWitness: witness(
          identity,
          'completed',
          3,
          'server-cause-001',
          ['event-cause-002'],
        ),
      });
    }],
  ];
  const identityContainers = [
    [bundle, ['identity']], [bundle, ['server', 'identity']],
    [bundle, ['offline', 'identity']], [bundle, ['server', 'snapshot', 'identity']],
    [completedRecovery, ['server', 'events', 0, 'identity']], [completedRecovery, ['server', 'projection', 'completion_witness', 'identity']],
    [(identity) => bundle(identity, { manualResolution: { identity: clone(identity), status: 'resolved', block_id: 'block-0001', action: 'verified-safe-restart', resolution_id: 'resolution-0001' } }), ['manual_resolution', 'identity']],
  ];
  const identityShapeMutations = [(value) => { value.unknown = true; }, (value) => { value.subject_identity.unknown = true; }, (value) => { value.run_id = ' ' + value.run_id; }];
  for (const [makeRecovery, path] of identityContainers) for (const mutate of identityShapeMutations) {
    negativeRecoveries.push(['recovery_schema_incompatible', (identity) => { const value = makeRecovery(identity); mutate(path.reduce((target, key) => target[key], value)); return value; }, 'recovery-identity-raw-canonical-exact']);
  }
  for (const [reason, makeRecovery, label] of negativeRecoveries) {
    const harness = makeHarness({ recovery: makeRecovery });
    const result = await harness.runtime.restore(harness.context);
    assert.equal(result.reason, reason, label || 'dual-cursor-negative-' + reason);
    assert.equal(harness.calls.restore.length, 0, 'tainted-recovery-never-reaches-adapter');
    assert.equal(harness.calls.evidence.length, 0, 'recovery-never-reaches-evidence-port');
  }

  const unknownEnvelopeMutations = [
    (value) => { value.unknown = true; },
    (value) => { value.freshness.unknown = true; },
    (value) => { value.server.unknown = true; },
    (value) => { value.offline.unknown = true; },
    (value, identity) => { value.manual_resolution = { identity: clone(identity), status: 'resolved', block_id: 'block-0001', action: 'verified-safe-restart', resolution_id: 'resolution-0001', unknown: true }; },
  ];
  for (const mutate of unknownEnvelopeMutations) {
    const result = await blockedByRecovery((identity) => { const value = bundle(identity); mutate(value, identity); return value; });
    assert.equal(result.reason, 'recovery_schema_incompatible', 'recovery-v2-exact-envelope');
  }

  const replayConflict = await blockedByRecovery(async (identity) => {
    const confirmed = learnerRecord(identity, 1, 1, 'started', 'event-replay-01', {}, { stage: 'A' });
    const pending = sidecar(identity, 1, 'started', 'event-replay-01', {}, { stage: 'B' });
    return bundle(identity, { serverEvents: [confirmed], offlineSidecars: [pending] });
  });
  assert.equal(replayConflict.reason, 'recovery_conflict');

  const identityDrifts = [
    (value) => { value.class_id += 1; }, (value) => { value.course_id += 1; }, (value) => { value.course_unit_id += 1; },
    (value) => { value.activity_key = 'physics.other'; }, (value) => { value.subject_identity.id = 'learner-99'; }, (value) => { value.run_id = 'run-9999'; },
    (value) => { value.group_id = 'group-9999'; }, (value) => { value.manifest_version = 'manifest-v2'; }, (value) => { value.content_version = 'content-v2'; },
    (value) => { value.event_schema_version = 2; }, (value) => { value.rule_version = 8; }, (value) => { value.generation = 'generation-2'; },
  ];
  for (const mutate of identityDrifts) {
    const result = await blockedByRecovery(async (identity) => {
      const value = bundle(identity);
      mutate(value.identity);
      return value;
    });
    assert.equal(result.reason, 'recovery_identity_mismatch');
  }

  const missingSnapshot = makeHarness();
  await missingSnapshot.runtime.restore(missingSnapshot.context);
  const withoutSnapshot = eventInput('event-nosnap-001', 'started');
  delete withoutSnapshot.snapshot;
  await assert.rejects(
    missingSnapshot.runtime.emitEvidence(withoutSnapshot),
    rejectsCode('evidence_snapshot_invalid'),
  );
  assert.equal(missingSnapshot.calls.evidence.length, 0, 'sidecar-missing-fail-closed');

  let ambiguous = true;
  const immutableRetry = makeHarness({
    evidence: async (transport) => {
      if (ambiguous) {
        ambiguous = false;
        const error = new Error('unknown write');
        error.code = 'network_unknown';
        throw error;
      }
      return receiptFor(transport, { status: 'reconciled', serverSequence: 1, serverLastSequence: 1 });
    },
  });
  await immutableRetry.runtime.restore(immutableRetry.context);
  const frozenEvent = eventInput(
    'event-frozen-01',
    'predicted',
    { prediction: 'A' },
    { stage: 'predicted', value: 'A' },
  );
  await assert.rejects(
    immutableRetry.runtime.emitEvidence(frozenEvent),
    rejectsCode('network_unknown'),
  );
  assert.ok(Object.isFrozen(immutableRetry.calls.evidence[0]));
  const firstTransport = JSON.stringify(immutableRetry.calls.evidence[0]);
  await assert.rejects(
    immutableRetry.runtime.emitEvidence(eventInput(
      'event-frozen-01',
      'predicted',
      { prediction: 'A' },
      { stage: 'predicted', value: 'B' },
    )),
    rejectsCode('client_event_id_conflict'),
  );
  assert.equal(immutableRetry.calls.evidence.length, 1, 'snapshot-drift-never-reaches-port');
  const retried = await immutableRetry.runtime.emitEvidence(frozenEvent);
  assert.deepEqual([retried.receipt.learner_sequence, retried.receipt.status], [1, 'reconciled'], 'unknown-write-first-reconciled-locks-server-position');
  assert.equal(JSON.stringify(immutableRetry.calls.evidence[1]), firstTransport);

  const cursorReceiptMismatch = makeHarness({
    evidence: async (transport) => ({
      ...receiptFor(transport, { serverSequence: 2, serverLastSequence: 1 }),
    }),
  });
  await cursorReceiptMismatch.runtime.restore(cursorReceiptMismatch.context);
  await assert.rejects(
    cursorReceiptMismatch.runtime.emitEvidence(eventInput('event-badrcpt-1', 'started')),
    rejectsCode('evidence_receipt_mismatch'),
  );

  const pendingCursorMismatch = makeHarness({
    evidence: async (transport) => ({
      ...receiptFor(transport, { status: 'local-pending' }),
      server_sequence: 1,
    }),
  });
  await pendingCursorMismatch.runtime.restore(pendingCursorMismatch.context);
  await assert.rejects(
    pendingCursorMismatch.runtime.emitEvidence(eventInput('event-badpend-1', 'started')),
    rejectsCode('evidence_receipt_mismatch'),
  );

  console.log('learning-activity-recovery-contract: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
