const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const recoveryPath = path.join(root, 'shared/js/learning-activity-recovery.js');
const runtimePath = path.join(root, 'shared/js/learning-activity.js');
const recoverySource = fs.readFileSync(recoveryPath, 'utf8');
const source = fs.readFileSync(runtimePath, 'utf8');
const boundaries = JSON.parse(
  fs.readFileSync(path.join(root, 'tools/architecture/v76-module-boundaries.json'), 'utf8'),
);
const provenanceContract = boundaries.activity_runtime_contract;
const context = {
  window: {},
  AbortController,
  Date,
  console,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(recoverySource, context, { filename: 'shared/js/learning-activity-recovery.js' });
vm.runInNewContext(source, context, { filename: 'shared/js/learning-activity.js' });
const AstraLearningActivity = context.window.AstraLearningActivity;

const clone = (value) => JSON.parse(JSON.stringify(value));
const rejectsCode = (code) => (error) => Boolean(error && error.code === code);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const NOW = '2026-08-10T08:00:00.000Z';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function verifyProvenance(envelope, verifier) {
  const failures = [];
  let recomputedFacts = [];
  try {
    assert.equal(envelope.schema_version, provenanceContract.provenance_schema_version);
    assert.equal(envelope.verifier.id, verifier.id);
    assert.equal(envelope.verifier.version, verifier.version);
    assert.equal(typeof verifier.recompute, 'function');
    assert.ok(Array.isArray(envelope.raw_records) && envelope.raw_records.length > 0);
    const sourceIds = new Set();
    for (const record of envelope.raw_records) {
      assert.ok(provenanceContract.raw_source_kinds.includes(record.source_kind));
      assert.match(record.source_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
      assert.equal(new Date(record.captured_at).toISOString(), record.captured_at);
      assert.equal(sourceIds.has(record.source_id), false);
      sourceIds.add(record.source_id);
      clone(record.payload);
    }
    const validateFacts = (facts) => {
      assert.ok(Array.isArray(facts) && facts.length > 0);
      const factIds = new Set();
      return facts.map((fact) => {
        assert.equal(factIds.has(fact.fact_id), false);
        factIds.add(fact.fact_id);
        assert.ok(
          Array.isArray(fact.source_ids)
            && fact.source_ids.length > 0
            && new Set(fact.source_ids).size === fact.source_ids.length
            && fact.source_ids.every((sourceId) => sourceIds.has(sourceId)),
        );
        return clone(fact);
      });
    };
    const claimedFacts = validateFacts(envelope.canonical_facts);
    recomputedFacts = validateFacts(await verifier.recompute({
      schema_version: envelope.schema_version,
      envelope_id: envelope.envelope_id,
      raw_records: clone(envelope.raw_records),
    }));
    const order = (left, right) => left.fact_id.localeCompare(right.fact_id);
    assert.deepEqual(claimedFacts.sort(order), recomputedFacts.sort(order));
  } catch (error) {
    failures.push(error.code || 'provenance_consistency_failed');
  }
  return {
    schema_version: provenanceContract.provenance_schema_version,
    valid: failures.length === 0,
    failures,
    recomputed_facts: recomputedFacts,
    assurance: provenanceContract.provenance_assurance,
    limitation: 'coordinated raw-source changes require an external source-authenticity verifier',
  };
}

function manifestFor(kind = 'simulation', activityKey = 'physics.mechanics') {
  const [courseKey] = activityKey.split('.');
  return {
    schema_version: 'astra-learning-activity-v1',
    identity: {
      galaxy_key: kind === 'future' ? 'future-galaxy' : kind === 'code' ? 'code-space' : 'englab',
      course_key: courseKey,
      activity_key: activityKey,
      manifest_version: 'manifest-v1',
      content_version: 'content-v1',
      event_schema_version: 1,
    },
    route: { canonical: '#activity/' + activityKey },
    owner_adapter: { id: kind + '-fixture', capabilities: [kind] },
    content: { state_schema_version: 'state-v1', stages: ['start', 'finish'], language: 'zh-CN' },
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

function snapshotFor(learnerSequence, data = { stage: 'start' }) {
  return {
    state_schema_version: 'state-v1',
    applied_through_learner_sequence: learnerSequence,
    data: clone(data),
  };
}

function commandFor(identity, learnerSequence, eventType, eventId, evidence = {}) {
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

function sidecarFor(identity, learnerSequence, eventType, eventId, evidence = {}, snapshotData) {
  return {
    schema_version: 'astra-learning-activity-evidence-sidecar-v1',
    command: commandFor(identity, learnerSequence, eventType, eventId, evidence),
    snapshot: snapshotFor(learnerSequence, snapshotData || { stage: eventType }),
  };
}

function eventFact(identity, serverSequence, eventType, eventId, evidence = {}, producer, learnerSequence) {
  const derived = ['completed', 'transferred'].includes(eventType);
  if (derived) {
    return {
      identity: clone(identity),
      server_sequence: serverSequence,
      server_event_id: eventId,
      learner_sequence: null,
      event_type: eventType,
      producer: producer || 'server',
      occurred_at: NOW,
      evidence: clone(evidence),
    };
  }
  const sequence = learnerSequence || serverSequence;
  return {
    identity: clone(identity),
    server_sequence: serverSequence,
    server_event_id: 'server-' + eventId,
    learner_sequence: sequence,
    event_type: eventType,
    producer: producer || 'learner',
    occurred_at: NOW,
    sidecar: sidecarFor(identity, sequence, eventType, eventId, evidence),
  };
}

function recoveryBundle(identity, options = {}) {
  const serverEvents = clone(options.serverEvents || []);
  const offlineEvents = clone(options.offlineEvents || []);
  return {
    schema_version: 'astra-learning-activity-recovery-v2',
    complete: options.complete === undefined ? true : options.complete,
    atomic: options.atomic === undefined ? true : options.atomic,
    stale: options.stale === undefined ? false : options.stale,
    snapshot_id: options.snapshot_id || 'snapshot-0001',
    captured_at: NOW,
    identity: clone(identity),
    freshness: {
      status: 'current',
      authority_revision: options.authorityRevision || 'authority-r1',
      release_revision: options.releaseRevision || 'release-r1',
    },
    server: {
      identity: clone(identity),
      complete_history: true,
      event_count: serverEvents.length,
      events: serverEvents,
      projection: {
        state: options.projectionState || 'not_started',
        applied_through_server_sequence: serverEvents.length,
        completion_witness: options.completionWitness === undefined
          ? null
          : clone(options.completionWitness),
      },
      snapshot: {
        identity: clone(identity),
        state_schema_version: 'state-v1',
        applied_through_learner_sequence: serverEvents.filter(
          (event) => event.learner_sequence !== null,
        ).length,
        data: clone(options.snapshotData || (
          serverEvents.filter((event) => event.learner_sequence !== null).at(-1)?.sidecar.snapshot.data
          || { stage: 'start' }
        )),
      },
    },
    offline: {
      identity: clone(identity),
      complete_pending_set: true,
      sidecar_count: offlineEvents.length,
      sidecars: offlineEvents.map((event) => clone(event.sidecar || event)),
    },
    ...(options.manualResolution ? { manual_resolution: clone(options.manualResolution) } : {}),
  };
}

function matchingReceipt(sidecar, status = 'confirmed', cursors = {}) {
  const command = sidecar.command;
  const authoritative = ['confirmed', 'reconciled'].includes(status);
  return {
    status,
    client_event_id: command.client_event_id,
    event_type: command.event_type,
    run_id: command.run.run_id,
    group_id: command.run.group_id,
    learner_sequence: command.run.sequence,
    server_sequence: authoritative ? (cursors.server_sequence || command.run.sequence) : null,
    server_last_sequence: authoritative ? (cursors.server_last_sequence || command.run.sequence) : null,
    server_event_id: status === 'confirmed' ? command.run.sequence + 1000 : undefined,
  };
}

function withSnapshot(event, data = { stage: event.event_type }) {
  return {
    ...event,
    snapshot: {
      state_schema_version: 'state-v1',
      data: clone(data),
    },
  };
}

function makeHarness(options = {}) {
  const kind = options.kind || 'simulation';
  const activityKey = options.activityKey || 'physics.mechanics';
  const manifest = options.manifest || manifestFor(kind, activityKey);
  const calls = {
    authority: [],
    release: [],
    recovery: [],
    evidence: [],
    evaluation: [],
    restore: [],
    predict: [],
    observe: [],
    dispose: [],
  };
  const authority = options.authority || (async (identity) => ({
    authorized: true,
    identity: clone(identity),
    revision: 'authority-r1',
  }));
  const release = options.release || (async (scope) => ({
    state: 'open',
    scope: {
      class_id: scope.class_id,
      course_id: scope.course_id,
      course_unit_id: scope.course_unit_id,
    },
    revision: 'release-r1',
  }));
  const recovery = options.recovery || (async (identity) => recoveryBundle(identity));
  const evidence = options.evidence || (async (sidecar) => matchingReceipt(sidecar));
  const evaluation = options.evaluation || (async (observation) => ({
    rubric_result: 'formative',
    observation: clone(observation),
  }));
  const adapter = {
    id: kind + '-fixture',
    async restore(input, callOptions) {
      calls.restore.push({ input, callOptions });
      if (options.adapterRestore) return options.adapterRestore(input, callOptions);
      return { kind, restored_stage: input.domain_snapshot.stage };
    },
    async predict(input, callOptions) {
      calls.predict.push({ input, callOptions });
      if (options.adapterPredict) return options.adapterPredict(input, callOptions);
      return { kind, prediction: clone(input) };
    },
    async observe(input, callOptions) {
      calls.observe.push({ input, callOptions });
      if (options.adapterObserve) return options.adapterObserve(input, callOptions);
      return { kind, observation: clone(input) };
    },
    async dispose(reason) {
      calls.dispose.push(reason);
      if (options.adapterDispose) return options.adapterDispose(reason);
      return undefined;
    },
  };
  const ports = {
    authority: {
      async verify(identity, callOptions) {
        calls.authority.push({ identity, callOptions });
        return authority(identity, callOptions, calls.authority.length);
      },
    },
    release: {
      async resolve(scope, callOptions) {
        calls.release.push({ scope, callOptions });
        return release(scope, callOptions, calls.release.length);
      },
    },
    recovery: {
      async load(identity, callOptions) {
        calls.recovery.push({ identity, callOptions });
        return recovery(identity, callOptions, calls.recovery.length);
      },
    },
    evaluation: {
      async assess(observation, callOptions) {
        calls.evaluation.push({ observation, callOptions });
        return evaluation(observation, callOptions, calls.evaluation.length);
      },
    },
    evidence: {
      async emit(sidecar, callOptions) {
        calls.evidence.push({ sidecar, command: sidecar.command, callOptions });
        return evidence(sidecar, callOptions, calls.evidence.length);
      },
    },
  };
  return {
    runtime: AstraLearningActivity.create({ manifest, ports, adapter }),
    calls,
    manifest,
    context: contextFor(activityKey),
  };
}

async function restoreReady(harness) {
  const result = await harness.runtime.restore(harness.context);
  assert.equal(result.state, 'ready');
  return result;
}

async function main() {
  assert.ok(AstraLearningActivity);
  assert.ok(Object.isFrozen(AstraLearningActivity));
  assert.equal(AstraLearningActivity.schemaVersion, 'astra-learning-activity-v1');
  assert.equal(AstraLearningActivity.recoverySchemaVersion, 'astra-learning-activity-recovery-v2');
  assert.equal(
    AstraLearningActivity.evidenceSidecarSchemaVersion,
    'astra-learning-activity-evidence-sidecar-v1',
  );
  assert.equal(AstraLearningActivity.provenanceSchemaVersion, 'astra-raw-evidence-provenance-v1');
  assert.deepEqual(Array.from(AstraLearningActivity.runtimeStates), [
    'created', 'restoring', 'ready', 'interacting', 'assessing', 'blocked', 'disposed',
  ]);
  assert.deepEqual(Array.from(AstraLearningActivity.projectionStates), [
    'not_started', 'in_progress', 'completed', 'transferred',
  ]);
  assert.deepEqual(Array.from(AstraLearningActivity.learnerEventTypes), [
    'started', 'predicted', 'attempted', 'corrected', 'explained',
  ]);
  assert.deepEqual(Array.from(AstraLearningActivity.serverDerivedEventTypes), [
    'completed', 'transferred',
  ]);
  assert.deepEqual(Array.from(AstraLearningActivity.rawSourceKinds), [
    'request', 'response', 'state', 'dom',
  ]);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB)\b/);
  assert.doesNotMatch(source, /AstraLearningEvidence(?:Client|Activity|Queue)/);

  const surface = makeHarness();
  assert.ok(Object.isFrozen(surface.runtime));
  assert.deepEqual(Object.keys(surface.runtime), [
    'restore', 'predict', 'observe', 'assess', 'emitEvidence', 'dispose',
  ]);
  assert.throws(
    () => AstraLearningActivity.create({
      manifest: manifestFor(),
      ports: {},
      adapter: { id: 'simulation-fixture' },
    }),
    rejectsCode('port_missing'),
  );
  assert.throws(
    () => AstraLearningActivity.create({
      manifest: manifestFor(),
      ports: {
        authority: { verify() {} },
        release: { resolve() {} },
        recovery: { load() {} },
        evaluation: { assess() {} },
        evidence: { emit() {} },
      },
      adapter: { id: 'simulation-fixture' },
    }),
    rejectsCode('adapter_missing'),
  );

  const nonCanonicalManifestMutations = [
    (manifest) => { manifest.identity.galaxy_key = ' galaxy.physics '; },
    (manifest) => { manifest.identity.course_key = ' course.mechanics '; },
    (manifest) => { manifest.identity.activity_key = ' physics.mechanics '; },
    (manifest) => { manifest.identity.manifest_version = ' manifest-v1 '; },
    (manifest) => { manifest.identity.content_version = ' content-v1 '; },
    (manifest) => { manifest.identity.event_schema_version = ' 1 '; },
    (manifest) => { manifest.route.canonical = ' #activity/physics.mechanics '; },
    (manifest) => { manifest.owner_adapter.id = ' simulation-fixture '; },
    (manifest) => { manifest.content.state_schema_version = ' state-v1 '; },
    (manifest) => { manifest.assessment.rubric_id = ' simulation-rubric '; },
    (manifest) => { manifest.assessment.rubric_version = ' 1 '; },
  ];
  for (const mutate of nonCanonicalManifestMutations) {
    const manifest = manifestFor();
    mutate(manifest);
    assert.throws(
      () => makeHarness({ manifest }),
      rejectsCode('manifest_not_canonical'),
      'manifest-whitespace-fail-closed',
    );
  }
  const missingAssessment = manifestFor();
  missingAssessment.assessment = {};
  assert.throws(
    () => makeHarness({ manifest: missingAssessment }),
    rejectsCode('invalid_identity'),
    'manifest-assessment-required',
  );
  for (const fields of [
    ['class_id', 'course_id', 'course_unit_id', 'class_id'],
    ['class_id', 'course_id', 'course_unit_id', 'subject_identity'],
    ['class_id', 'course_id', 'course_unit_id', 'run_id'],
    ['class_id', 'course_id'],
  ]) {
    const manifest = manifestFor();
    manifest.release.scope_fields = fields;
    assert.throws(
      () => makeHarness({ manifest }),
      rejectsCode('manifest_release_scope_invalid'),
      'manifest-release-scope-exact',
    );
  }
  const activityScopedManifest = manifestFor();
  activityScopedManifest.release.scope_fields.push('activity_key');
  assert.ok(
    makeHarness({ manifest: activityScopedManifest }).runtime,
    'manifest-release-scope-exact',
  );

  const mutableManifest = manifestFor();
  const immutableHarness = makeHarness({ manifest: mutableManifest });
  mutableManifest.identity.activity_key = 'mutated.activity';
  mutableManifest.evidence.allowed_events.push('completed');
  await restoreReady(immutableHarness);

  assert.deepEqual(
    JSON.parse(JSON.stringify(immutableHarness.calls.release[0].scope)),
    {
      class_id: 11,
      course_id: 101,
      course_unit_id: 1001,
      activity_key: 'physics.mechanics',
    },
  );
  assert.equal(
    Object.hasOwn(immutableHarness.calls.release[0].scope, 'subject_identity'),
    false,
  );
  assert.equal(Object.hasOwn(immutableHarness.calls.release[0].scope, 'run_id'), false);

  const releaseDrift = makeHarness({
    release: async (scope) => ({
      state: 'open',
      scope: {
        class_id: scope.class_id,
        course_id: scope.course_id + 1,
        course_unit_id: scope.course_unit_id,
      },
      revision: 'release-r1',
    }),
  });
  const releaseDriftResult = await releaseDrift.runtime.restore(releaseDrift.context);
  assert.equal(releaseDriftResult.state, 'blocked');
  assert.equal(releaseDriftResult.reason, 'release_identity_mismatch');

  const normal = makeHarness();
  const restored = await restoreReady(normal);
  assert.equal(restored.next_learner_sequence, 1);
  assert.equal(restored.server_last_sequence, 0);
  assert.equal(restored.identity.subject.kind, 'learner');
  assert.equal(Object.hasOwn(restored.identity.subject, 'id'), false);
  const predicted = await normal.runtime.predict({ answer: 'left' });
  assert.equal(predicted.state, 'ready');
  assert.equal(predicted.value.kind, 'simulation');
  const observed = await normal.runtime.observe({ operation: 'measure' });
  assert.equal(observed.state, 'ready');
  const assessed = await normal.runtime.assess({ observation: 'bounded' });
  assert.equal(assessed.state, 'ready');
  assert.equal(assessed.value.rubric_result, 'formative');
  await assert.rejects(normal.runtime.restore(normal.context), rejectsCode('invalid_transition'));

  const assessmentBoundary = makeHarness({
    evaluation: async () => ({ feedback: 'ok', completed: true }),
  });
  await restoreReady(assessmentBoundary);
  await assert.rejects(
    assessmentBoundary.runtime.assess({ observation: 'candidate' }),
    rejectsCode('client_completion_forbidden'),
  );
  assert.equal((await assessmentBoundary.runtime.predict({ answer: 'still-ready' })).state, 'ready');

  for (const fixture of [
    ['simulation', 'physics.mechanics'],
    ['code', 'control-flow.loop-boundary'],
    ['future', 'engineering.load-path'],
  ]) {
    const harness = makeHarness({ kind: fixture[0], activityKey: fixture[1] });
    const result = await restoreReady(harness);
    assert.equal(result.domain_state.kind, fixture[0]);
    assert.equal((await harness.runtime.predict({ fixture: fixture[0] })).value.kind, fixture[0]);
    assert.equal((await harness.runtime.observe({ fixture: fixture[0] })).value.kind, fixture[0]);
    await harness.runtime.dispose('fixture-complete');
  }

  const evidenceHarness = makeHarness();
  await restoreReady(evidenceHarness);
  const startedEvent = withSnapshot({
    client_event_id: 'event-started-1',
    event_type: 'started',
    occurred_at: NOW,
    evidence: { cursor: { stage: 'started' } },
  }, { stage: 'started' });
  const started = await evidenceHarness.runtime.emitEvidence(startedEvent);
  assert.equal(started.receipt.status, 'confirmed');
  assert.equal(started.receipt.learner_sequence, 1);
  assert.equal(started.receipt.server_sequence, 1);
  assert.equal(started.receipt.server_last_sequence, 1);
  assert.ok(Object.isFrozen(evidenceHarness.calls.evidence[0].sidecar));
  const command = evidenceHarness.calls.evidence[0].command;
  assert.equal(command.run.run_id, 'run-0001');
  assert.equal(command.run.group_id, 'group-0001');
  assert.equal(command.versions.rule_version, 7);
  assert.equal(command.versions.event_schema_version, 1);
  assert.equal(Object.hasOwn(command, 'subject_identity'), false);
  assert.equal(Object.hasOwn(command, 'subject_user_id'), false);
  await evidenceHarness.runtime.emitEvidence(startedEvent);
  assert.equal(evidenceHarness.calls.evidence[1].command.run.sequence, 1);
  await assert.rejects(
    evidenceHarness.runtime.emitEvidence({
      ...startedEvent,
      evidence: { cursor: { stage: 'changed' } },
    }),
    rejectsCode('client_event_id_conflict'),
  );
  const writesBeforeDerived = evidenceHarness.calls.evidence.length;
  for (const eventType of ['completed', 'transferred']) {
    await assert.rejects(
      evidenceHarness.runtime.emitEvidence(withSnapshot({
        client_event_id: 'event-derived-' + eventType,
        event_type: eventType,
        occurred_at: NOW,
        evidence: {},
      })),
      rejectsCode('server_projection_only'),
    );
  }
  assert.equal(evidenceHarness.calls.evidence.length, writesBeforeDerived);

  let ambiguous = true;
  const retryHarness = makeHarness({
    evidence: async (command) => {
      if (ambiguous) {
        ambiguous = false;
        const error = new Error('unknown transport result');
        error.code = 'network_unknown';
        throw error;
      }
      return matchingReceipt(command);
    },
  });
  await restoreReady(retryHarness);
  const retryEvent = withSnapshot({
    client_event_id: 'event-retry-0001',
    event_type: 'predicted',
    occurred_at: NOW,
    evidence: { prediction: { value: 'A' } },
  }, { stage: 'predicted', value: 'A' });
  await assert.rejects(retryHarness.runtime.emitEvidence(retryEvent), rejectsCode('network_unknown'));
  await assert.rejects(
    retryHarness.runtime.emitEvidence({
      ...retryEvent,
      client_event_id: 'event-retry-0002',
    }),
    rejectsCode('evidence_retry_required'),
  );
  const retryResult = await retryHarness.runtime.emitEvidence(retryEvent);
  assert.equal(retryResult.receipt.learner_sequence, 1);
  assert.equal(retryHarness.calls.evidence[0].command.run.sequence, 1);
  assert.equal(retryHarness.calls.evidence[1].command.run.sequence, 1);

  const pendingHarness = makeHarness({ evidence: async (sidecar, _options, count) => count <= 2
    ? matchingReceipt(sidecar, 'local-pending')
    : matchingReceipt(sidecar, 'reconciled', { server_sequence: sidecar.command.run.sequence, server_last_sequence: 2 }) });
  await restoreReady(pendingHarness);
  const pendingEvents = [withSnapshot({
    client_event_id: 'event-pending-01',
    event_type: 'attempted',
    occurred_at: NOW,
    evidence: { operation: { value: 'first' } },
  }, { stage: 'attempted' }), withSnapshot({
    client_event_id: 'event-pending-02',
    event_type: 'corrected',
    occurred_at: NOW,
    evidence: { correction: { value: 'second' } },
  }, { stage: 'corrected' })];
  await pendingHarness.runtime.emitEvidence(pendingEvents[0]);
  await pendingHarness.runtime.emitEvidence(pendingEvents[1]);
  assert.deepEqual(
    pendingHarness.calls.evidence.map((entry) => entry.command.run.sequence),
    [1, 2],
  );
  await pendingHarness.runtime.emitEvidence(pendingEvents[0]);
  await assert.rejects(pendingHarness.runtime.emitEvidence(pendingEvents[1]),
    rejectsCode('evidence_receipt_mismatch'), 'local-pending-batch-aggregate-cursor-fails-closed');

  const receiptMismatch = makeHarness({
    evidence: async (command) => ({
      ...matchingReceipt(command),
      event_type: 'attempted',
    }),
  });
  await restoreReady(receiptMismatch);
  await assert.rejects(
    receiptMismatch.runtime.emitEvidence(withSnapshot({
      client_event_id: 'event-mismatch-1',
      event_type: 'predicted',
      occurred_at: NOW,
      evidence: { prediction: { value: 'A' } },
    })),
    rejectsCode('evidence_receipt_mismatch'),
  );
  await assert.rejects(
    receiptMismatch.runtime.predict({ value: 'blocked' }),
    rejectsCode('invalid_transition'),
  );

  const sensitive = makeHarness();
  await restoreReady(sensitive);
  await assert.rejects(
    sensitive.runtime.emitEvidence(withSnapshot({
      client_event_id: 'event-sensitive1',
      event_type: 'started',
      occurred_at: NOW,
      evidence: { token: 'secret' },
    })),
    rejectsCode('sensitive_evidence_forbidden'),
  );

  const authorityStarted = deferred();
  const releaseStarted = deferred();
  const authorityGate = deferred();
  const releaseGate = deferred();
  const concurrentBinding = makeHarness({
    authority: async (runtimeIdentity, callOptions, callNumber) => {
      if (callNumber === 1) {
        authorityStarted.resolve('binding-round-concurrent-start');
        await authorityGate.promise;
      }
      return { authorized: true, identity: clone(runtimeIdentity), revision: 'authority-r1' };
    },
    release: async (scope, callOptions, callNumber) => {
      if (callNumber === 1) {
        releaseStarted.resolve('binding-round-concurrent-start');
        await releaseGate.promise;
      }
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
  });
  const concurrentRestore = concurrentBinding.runtime.restore(concurrentBinding.context);
  assert.equal(await Promise.race([
    Promise.all([authorityStarted.promise, releaseStarted.promise]).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]), true, 'authority and release must start concurrently within one binding round');
  authorityGate.resolve();
  releaseGate.resolve();
  assert.equal((await concurrentRestore).state, 'ready');

  const failingAuthorityStarted = deferred();
  const failingReleaseStarted = deferred();
  const failingAuthorityGate = deferred();
  const failingReleaseGate = deferred();
  let failingReleaseSignal = null;
  const failingBinding = makeHarness({
    authority: async () => {
      failingAuthorityStarted.resolve('binding-peer-failure-aborts-round');
      await failingAuthorityGate.promise;
      const error = new Error('authority denied');
      error.code = 'authority_denied';
      throw error;
    },
    release: async (scope, callOptions) => {
      failingReleaseSignal = callOptions.signal;
      failingReleaseStarted.resolve('binding-peer-failure-aborts-round');
      await failingReleaseGate.promise;
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
  });
  const failingRestore = failingBinding.runtime.restore(failingBinding.context);
  await Promise.all([failingAuthorityStarted.promise, failingReleaseStarted.promise]);
  failingAuthorityGate.resolve();
  const failingResult = await Promise.race([
    failingRestore,
    new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 100)),
  ]);
  assert.equal(failingResult.state, 'blocked');
  assert.equal(failingResult.reason, 'authority_denied');
  assert.equal(failingReleaseSignal.aborted, true, 'peer port must receive an abort when its binding round fails');
  failingReleaseGate.resolve();

  const deniedReleaseGate = deferred();
  let deniedReleaseSignal = null;
  const resolvedAuthorityDenied = makeHarness({
    authority: async () => ({ authorized: false }),
    release: async (scope, callOptions) => {
      deniedReleaseSignal = callOptions.signal;
      await deniedReleaseGate.promise;
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
  });
  const resolvedAuthorityPromise = resolvedAuthorityDenied.runtime.restore(
    resolvedAuthorityDenied.context,
  );
  const resolvedAuthorityOutcome = await Promise.race([
    resolvedAuthorityPromise,
    new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 120)),
  ]);
  const deniedReleaseWasAborted = deniedReleaseSignal && deniedReleaseSignal.aborted;
  deniedReleaseGate.resolve('binding-resolved-authority-denial-fail-fast');
  const resolvedAuthorityEventual = await resolvedAuthorityPromise;
  assert.equal(resolvedAuthorityOutcome.state, 'blocked');
  assert.equal(resolvedAuthorityOutcome.reason, 'authority_denied');
  assert.equal(deniedReleaseWasAborted, true);
  assert.equal(resolvedAuthorityEventual.reason, 'authority_denied');

  const deniedAuthorityGate = deferred();
  let deniedAuthoritySignal = null;
  const resolvedReleaseDenied = makeHarness({
    authority: async (runtimeIdentity, callOptions) => {
      deniedAuthoritySignal = callOptions.signal;
      await deniedAuthorityGate.promise;
      return { authorized: true, identity: clone(runtimeIdentity), revision: 'authority-r1' };
    },
    release: async (scope) => ({
      state: 'locked',
      scope: {
        class_id: scope.class_id,
        course_id: scope.course_id,
        course_unit_id: scope.course_unit_id,
      },
      revision: 'release-r1',
    }),
  });
  const resolvedReleasePromise = resolvedReleaseDenied.runtime.restore(
    resolvedReleaseDenied.context,
  );
  const resolvedReleaseOutcome = await Promise.race([
    resolvedReleasePromise,
    new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 120)),
  ]);
  const deniedAuthorityWasAborted = deniedAuthoritySignal && deniedAuthoritySignal.aborted;
  deniedAuthorityGate.resolve('binding-resolved-release-denial-fail-fast');
  const resolvedReleaseEventual = await resolvedReleasePromise;
  assert.equal(resolvedReleaseOutcome.state, 'blocked');
  assert.equal(resolvedReleaseOutcome.reason, 'release_not_open');
  assert.equal(deniedAuthorityWasAborted, true);
  assert.equal(resolvedReleaseEventual.reason, 'release_not_open');

  const drift = makeHarness({
    authority: async (runtimeIdentity, callOptions, callNumber) => ({
      authorized: true,
      identity: clone(runtimeIdentity),
      revision: callNumber < 4 ? 'authority-r1' : 'authority-r2',
    }),
  });
  await restoreReady(drift);
  await assert.rejects(drift.runtime.predict({ answer: 'late-drift' }), rejectsCode('authority_drift'));
  await assert.rejects(drift.runtime.observe({ value: 'blocked' }), rejectsCode('invalid_transition'));

  const callerAbortDeferred = deferred();
  let holdCallerAbort = true;
  const callerAbort = makeHarness({
    adapterPredict: async () => {
      if (holdCallerAbort) return callerAbortDeferred.promise;
      return { retry: 'safe' };
    },
  });
  await restoreReady(callerAbort);
  const callerController = new AbortController();
  const callerPromise = callerAbort.runtime.predict(
    { answer: 'held' },
    callerController.signal,
  );
  await tick();
  callerController.abort('caller-left');
  const callerOutcome = await Promise.race([
    callerPromise.then(
      () => ({ type: 'resolved' }),
      (error) => ({ type: 'rejected', code: error && error.code }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ type: 'timeout' }), 50)),
  ]);
  assert.deepEqual(callerOutcome, { type: 'rejected', code: 'operation_aborted' });
  holdCallerAbort = false;
  callerAbortDeferred.resolve({ late: 'must-not-land' });
  assert.deepEqual(
    JSON.parse(JSON.stringify((await callerAbort.runtime.predict({ answer: 'retry' })).value)),
    { retry: 'safe' },
  );

  const adapterEffectGate = deferred();
  const adapterEffectDone = deferred();
  let adapterEffectHeld = true;
  let adapterEffectSignal = null;
  const adapterExternalState = [];
  const adapterEffectLimit = makeHarness({
    adapterPredict: async (input, callOptions) => {
      if (!adapterEffectHeld) return { retry: 'safe' };
      adapterEffectSignal = callOptions.signal;
      await adapterEffectGate.promise;
      adapterExternalState.push(input.marker);
      adapterEffectDone.resolve();
      return { ignored_abort: true };
    },
  });
  await restoreReady(adapterEffectLimit);
  const adapterEffectController = new AbortController();
  const adapterEffectPromise = adapterEffectLimit.runtime.predict(
    { marker: 'adapter-side-effect-after-abort' },
    adapterEffectController.signal,
  );
  await tick();
  adapterEffectController.abort('page-left-before-commit');
  await assert.rejects(adapterEffectPromise, rejectsCode('operation_aborted'));
  assert.equal(adapterEffectSignal.aborted, true, 'runtime must propagate caller abort to the adapter');
  adapterEffectGate.resolve();
  await adapterEffectDone.promise;
  assert.deepEqual(
    adapterExternalState,
    ['adapter-side-effect-after-abort'],
    'kernel state cancellation cannot roll back an adapter-owned external effect that ignores AbortSignal',
  );
  adapterEffectHeld = false;
  assert.deepEqual(
    JSON.parse(JSON.stringify((await adapterEffectLimit.runtime.predict({ marker: 'retry' })).value)),
    { retry: 'safe' },
    'adapter side effects do not revive or corrupt the cancelled runtime operation',
  );

  const restoreAbortDeferred = deferred();
  let holdRestoreAbort = true;
  const restoreAbort = makeHarness({
    recovery: async (runtimeIdentity) => {
      if (holdRestoreAbort) return restoreAbortDeferred.promise;
      return recoveryBundle(runtimeIdentity);
    },
  });
  const restoreController = new AbortController();
  const abortedRestorePromise = restoreAbort.runtime.restore(
    restoreAbort.context,
    restoreController.signal,
  );
  await tick();
  restoreController.abort('caller-cancelled-restore');
  const restoreAbortOutcome = await Promise.race([
    abortedRestorePromise.then(
      () => ({ type: 'resolved' }),
      (error) => ({ type: 'rejected', code: error && error.code }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ type: 'timeout' }), 50)),
  ]);
  assert.deepEqual(restoreAbortOutcome, { type: 'rejected', code: 'operation_aborted' });
  holdRestoreAbort = false;
  restoreAbortDeferred.resolve(recoveryBundle({
    ...restoreAbort.context,
    manifest_version: 'manifest-v1',
    content_version: 'content-v1',
    event_schema_version: 1,
  }));
  assert.equal((await restoreAbort.runtime.restore(restoreAbort.context)).state, 'ready');

  const evidenceAbortDeferred = deferred();
  let holdEvidenceAbort = true;
  const evidenceAbort = makeHarness({
    evidence: async (command) => {
      if (holdEvidenceAbort) return evidenceAbortDeferred.promise;
      return matchingReceipt(command);
    },
  });
  await restoreReady(evidenceAbort);
  const abortEvidenceEvent = withSnapshot({
    client_event_id: 'event-abort-0001',
    event_type: 'attempted',
    occurred_at: NOW,
    evidence: { operation: { value: 'held' } },
  }, { stage: 'attempted' });
  const evidenceController = new AbortController();
  const abortedEvidencePromise = evidenceAbort.runtime.emitEvidence(
    abortEvidenceEvent,
    evidenceController.signal,
  );
  await tick();
  evidenceController.abort('caller-cancelled-evidence');
  const evidenceAbortOutcome = await Promise.race([
    abortedEvidencePromise.then(
      () => ({ type: 'resolved' }),
      (error) => ({ type: 'rejected', code: error && error.code }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ type: 'timeout' }), 50)),
  ]);
  assert.deepEqual(evidenceAbortOutcome, { type: 'rejected', code: 'operation_aborted' });
  holdEvidenceAbort = false;
  evidenceAbortDeferred.resolve(matchingReceipt(evidenceAbort.calls.evidence[0].sidecar));
  const retriedAfterAbort = await evidenceAbort.runtime.emitEvidence(abortEvidenceEvent);
  assert.equal(retriedAfterAbort.receipt.learner_sequence, 1);

  const assessAbortDeferred = deferred();
  let holdAssessAbort = true;
  const assessAbort = makeHarness({
    evaluation: async () => (
      holdAssessAbort ? assessAbortDeferred.promise : { feedback: 'retry-safe' }
    ),
  });
  await restoreReady(assessAbort);
  const assessController = new AbortController();
  const abortedAssessPromise = assessAbort.runtime.assess(
    { observation: 'held' },
    assessController.signal,
  );
  await tick();
  assessController.abort('caller-cancelled-assess');
  await assert.rejects(abortedAssessPromise, rejectsCode('operation_aborted'));
  holdAssessAbort = false;
  assessAbortDeferred.resolve({ feedback: 'late-must-not-land' });
  assert.equal(
    (await assessAbort.runtime.assess({ observation: 'retry' })).value.feedback,
    'retry-safe',
  );

  let latchMode = 'conflict';
  let latchReleaseOpen = true;
  let latchBlockId = '';
  const latchedManual = makeHarness({
    release: async (scope) => ({
      state: latchReleaseOpen ? 'open' : 'locked',
      scope: {
        class_id: scope.class_id,
        course_id: scope.course_id,
        course_unit_id: scope.course_unit_id,
      },
      revision: 'release-r1',
    }),
    recovery: async (runtimeIdentity) => {
      if (latchMode === 'conflict') {
        return recoveryBundle(runtimeIdentity, {
          serverEvents: [
            eventFact(runtimeIdentity, 1, 'predicted', 'event-latch-0001', { value: 'A' }),
          ],
          offlineEvents: [
            eventFact(runtimeIdentity, 1, 'predicted', 'event-latch-0001', { value: 'B' }),
          ],
        });
      }
      return recoveryBundle(runtimeIdentity, {
        ...(latchMode === 'resolved' ? {
          manualResolution: {
            status: 'resolved',
            block_id: latchBlockId,
            resolution_id: 'resolution-latch1',
            action: 'apply-atomic-snapshot',
            identity: clone(runtimeIdentity),
          },
        } : {}),
      });
    },
  });
  const latchedConflict = await latchedManual.runtime.restore(latchedManual.context);
  latchBlockId = latchedConflict.block_id;
  latchMode = 'valid';
  latchReleaseOpen = false;
  const transientDenied = await latchedManual.runtime.restore(latchedManual.context);
  assert.equal(transientDenied.reason, 'release_not_open');
  assert.equal(transientDenied.resolution, 'manual-intervention');
  assert.equal(transientDenied.block_id, latchBlockId);
  latchReleaseOpen = true;
  const bypassAttempt = await latchedManual.runtime.restore(latchedManual.context);
  assert.equal(bypassAttempt.reason, 'manual_intervention_unresolved');
  assert.equal(bypassAttempt.block_id, latchBlockId);
  latchMode = 'resolved';
  assert.equal((await latchedManual.runtime.restore(latchedManual.context)).state, 'ready');

  for (const mutateContext of [
    (value) => { value.subject_identity.id = 'learner-99'; },
    (value) => { value.course_id = 202; },
    (value) => { value.run_id = 'run-cross-2'; },
    (value) => { value.generation = 'generation-cross'; },
  ]) {
    let crossMode = 'conflict';
    let crossBlockId = '';
    const crossIdentity = makeHarness({
      recovery: async (runtimeIdentity) => {
        if (crossMode === 'conflict') {
          return recoveryBundle(runtimeIdentity, {
            serverEvents: [
              eventFact(runtimeIdentity, 1, 'predicted', 'event-cross-0001', { value: 'A' }),
            ],
            offlineEvents: [
              eventFact(runtimeIdentity, 1, 'predicted', 'event-cross-0001', { value: 'B' }),
            ],
          });
        }
        return recoveryBundle(runtimeIdentity, {
          manualResolution: {
            status: 'resolved',
            block_id: crossBlockId,
            resolution_id: 'resolution-cross1',
            action: 'apply-atomic-snapshot',
            identity: clone(runtimeIdentity),
          },
        });
      },
    });
    const originalContext = clone(crossIdentity.context);
    const originalBlock = await crossIdentity.runtime.restore(originalContext);
    crossBlockId = originalBlock.block_id;
    crossMode = 'resolved';
    const changedContext = clone(originalContext);
    mutateContext(changedContext);
    const crossAttempt = await crossIdentity.runtime.restore(changedContext);
    assert.equal(crossAttempt.state, 'blocked');
    assert.equal(crossAttempt.resolution, 'manual-intervention');
    assert.equal(crossAttempt.block_id, crossBlockId);
    assert.notEqual(crossAttempt.state, 'ready');
    assert.equal((await crossIdentity.runtime.restore(originalContext)).state, 'ready');
  }

  const recoveryDeferred = deferred();
  let deferredIdentity;
  const lateRestore = makeHarness({
    recovery: async (runtimeIdentity) => {
      deferredIdentity = clone(runtimeIdentity);
      return recoveryDeferred.promise;
    },
  });
  const restorePromise = lateRestore.runtime.restore(lateRestore.context);
  await tick();
  await lateRestore.runtime.dispose('route-left');
  recoveryDeferred.resolve(recoveryBundle(deferredIdentity));
  await assert.rejects(restorePromise, rejectsCode('activity_disposed'));
  await assert.rejects(lateRestore.runtime.predict({ value: 'late' }), rejectsCode('activity_disposed'));

  const assessmentDeferred = deferred();
  const lateAssessment = makeHarness({
    evaluation: async () => assessmentDeferred.promise,
  });
  await restoreReady(lateAssessment);
  const assessmentPromise = lateAssessment.runtime.assess({ observation: 'held' });
  await tick();
  await lateAssessment.runtime.dispose('identity-cleared');
  assessmentDeferred.resolve({ feedback: 'late' });
  await assert.rejects(assessmentPromise, rejectsCode('activity_disposed'));

  const evidenceDeferred = deferred();
  const lateEvidence = makeHarness({
    evidence: async () => evidenceDeferred.promise,
  });
  await restoreReady(lateEvidence);
  const evidencePromise = lateEvidence.runtime.emitEvidence(withSnapshot({
    client_event_id: 'event-late-0001',
    event_type: 'explained',
    occurred_at: NOW,
    evidence: { artifact: { value: 'held' } },
  }, { stage: 'explained' }));
  await tick();
  await lateEvidence.runtime.dispose('page-disposed');
  evidenceDeferred.resolve({
    status: 'confirmed',
    client_event_id: 'event-late-0001',
    event_type: 'explained',
    run_id: 'run-0001',
    group_id: 'group-0001',
    learner_sequence: 1,
    server_sequence: 1,
    server_last_sequence: 1,
  });
  await assert.rejects(evidencePromise, rejectsCode('activity_disposed'));

  const rawRecords = [
    {
      source_id: 'raw-request-01',
      source_kind: 'request',
      captured_at: NOW,
      payload: { class_id: 11, course_id: 101 },
    },
    {
      source_id: 'raw-response-1',
      source_kind: 'response',
      captured_at: NOW,
      payload: { status: 200, rows: 0 },
    },
    {
      source_id: 'raw-state-0001',
      source_kind: 'state',
      captured_at: NOW,
      payload: { foreign_rows: 0 },
    },
    {
      source_id: 'raw-dom-000001',
      source_kind: 'dom',
      captured_at: NOW,
      payload: { foreign_submission: false },
    },
  ];
  let verifierSawClaims = false;
  const verifier = {
    id: 'qa021-independent',
    version: 'v1',
    recompute(input) {
      verifierSawClaims = Object.hasOwn(input, 'canonical_facts');
      const byId = Object.fromEntries(input.raw_records.map((record) => [record.source_id, record]));
      return [
        {
          fact_id: 'scope-is-physics',
          source_ids: ['raw-request-01'],
          value: { valid: byId['raw-request-01'].payload.course_id === 101 },
        },
        {
          fact_id: 'response-is-success',
          source_ids: ['raw-response-1'],
          value: {
            valid: byId['raw-response-1'].payload.status === 200
              && byId['raw-response-1'].payload.rows === 0,
          },
        },
        {
          fact_id: 'no-foreign-dom-row',
          source_ids: ['raw-state-0001', 'raw-dom-000001'],
          value: {
            valid: byId['raw-state-0001'].payload.foreign_rows === 0
              && byId['raw-dom-000001'].payload.foreign_submission === false,
          },
        },
      ];
    },
  };
  const provenanceEnvelope = {
    schema_version: 'astra-raw-evidence-provenance-v1',
    envelope_id: 'envelope-0001',
    verifier: { id: verifier.id, version: verifier.version },
    raw_records: clone(rawRecords),
    canonical_facts: verifier.recompute({ raw_records: clone(rawRecords) }),
  };
  const validProvenance = await verifyProvenance(
    provenanceEnvelope,
    verifier,
  );
  assert.equal(validProvenance.valid, true);
  assert.equal(validProvenance.assurance, 'consistency-only');
  assert.equal(verifierSawClaims, false);

  const singleLayerMutation = clone(provenanceEnvelope);
  singleLayerMutation.canonical_facts[0].value.valid = false;
  assert.equal(
    (await verifyProvenance(singleLayerMutation, verifier)).valid,
    false,
  );
  const bundledFactsMutation = clone(provenanceEnvelope);
  bundledFactsMutation.canonical_facts.forEach((fact) => { fact.value.valid = false; });
  assert.equal(
    (await verifyProvenance(bundledFactsMutation, verifier)).valid,
    false,
  );
  const missingSource = clone(provenanceEnvelope);
  missingSource.canonical_facts[0].source_ids = ['raw-missing-01'];
  assert.equal(
    (await verifyProvenance(missingSource, verifier)).valid,
    false,
  );

  const coordinatedRawChange = clone(provenanceEnvelope);
  coordinatedRawChange.raw_records[0].payload.course_id = 202;
  coordinatedRawChange.canonical_facts = verifier.recompute({
    raw_records: coordinatedRawChange.raw_records,
  });
  const coordinatedResult = await verifyProvenance(
    coordinatedRawChange,
    verifier,
  );
  assert.equal(coordinatedResult.valid, true);
  assert.match(coordinatedResult.limitation, /external source-authenticity verifier/);

  assert.ok(normal.calls.authority.length >= 8, 'authority must be checked around lifecycle work');
  assert.ok(normal.calls.release.length >= 8, 'release must be checked around lifecycle work');
  console.log('learning-activity-runtime-contract: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
