import {
  LearnerAdaptationVariantRefV4Schema,
  LearnerCalibrationPolicyVersionV4,
  LearnerCalibrationFieldPolicyVersionV4,
  LearnerCalibrationObservationWindowPlanV4Schema,
  LearnerCalibrationResultV4Schema,
  type LearnerAdaptationVariantRefV4,
  type LearnerCalibrationObservationWindowPlanV4,
  type LearnerCalibrationResultV4,
} from "@ronggang/contracts";
import type { SimulationSessionRecord } from "@ronggang/world-core";
import { isFieldBoundaryRequest } from "@ronggang/world-core";
import type { FlagshipAssessmentRecordV4 } from "./flagship-assessment-v4.js";

type SimulationEventV4 = SimulationSessionRecord["queue"][number];
type SimulationActionV4 = SimulationSessionRecord["studentActions"][number];

interface CalibrationRequirementV4 {
  id: string;
  label: string;
  satisfied(context: CalibrationContextV4): boolean;
}

interface CalibrationPolicyV4 {
  variantRef: LearnerAdaptationVariantRefV4;
  observationWindow: LearnerCalibrationObservationWindowPlanV4;
  requirements: readonly CalibrationRequirementV4[];
}

const policyVersion = LearnerCalibrationPolicyVersionV4;

const policyWindows: Record<
  LearnerAdaptationVariantRefV4,
  LearnerCalibrationObservationWindowPlanV4
> = {
  "variant-xunpu-source-triangulation": LearnerCalibrationObservationWindowPlanV4Schema.parse({
    policyVersion,
    startVirtualMinute: 0,
    endVirtualMinute: 52,
    minimumCommittedWorldEvents: 2,
  }),
  "variant-xunpu-consent-negotiation": LearnerCalibrationObservationWindowPlanV4Schema.parse({
    policyVersion,
    startVirtualMinute: 0,
    endVirtualMinute: 50,
    minimumCommittedWorldEvents: 3,
  }),
  "variant-xunpu-deadline-service": LearnerCalibrationObservationWindowPlanV4Schema.parse({
    policyVersion,
    startVirtualMinute: 0,
    endVirtualMinute: 45,
    minimumCommittedWorldEvents: 3,
  }),
  "variant-xunpu-editorial-independence": LearnerCalibrationObservationWindowPlanV4Schema.parse({
    policyVersion,
    startVirtualMinute: 0,
    endVirtualMinute: 48,
    minimumCommittedWorldEvents: 3,
  }),
};

function eventTypes(...types: string[]): Set<string> {
  return new Set(types);
}

function hasAnyEvent(
  context: CalibrationContextV4,
  types: Set<string>,
): boolean {
  return context.committedEvents.some((event) => types.has(event.eventType));
}

function distinctEventTypeCount(
  context: CalibrationContextV4,
  types: Set<string>,
): number {
  return new Set(
    context.committedEvents
      .filter((event) => types.has(event.eventType))
      .map((event) => event.eventType),
  ).size;
}

function consequenceCount(
  context: CalibrationContextV4,
  types: Set<string>,
): number {
  const eventIds = new Set(
    context.committedEvents
      .filter((event) => types.has(event.eventType))
      .map((event) => event.eventId),
  );
  return context.record.consequences.filter((consequence) => (
    eventIds.has(consequence.sourceWorldEventId)
  )).length;
}

function eventSequence(
  context: CalibrationContextV4,
  types: Set<string>,
): number | null {
  const sequences = context.committedEvents
    .filter((event) => types.has(event.eventType))
    .map((event) => event.sequence);
  return sequences.length > 0 ? Math.max(...sequences) : null;
}

function hasEventAfter(
  context: CalibrationContextV4,
  types: Set<string>,
  afterSequence: number,
): boolean {
  return context.committedEvents.some((event) => (
    event.sequence > afterSequence && types.has(event.eventType)
  ));
}

function makeRequirement(
  id: string,
  label: string,
  satisfied: (context: CalibrationContextV4) => boolean,
): CalibrationRequirementV4 {
  return { id, label, satisfied };
}

const sourceEvents = eventTypes(
  "student_inspects_source",
  "student_compares_sources",
  "student_probes_researcher",
  "student_requests_official_data",
);
const sourceComparisonEvents = eventTypes(
  "student_compares_sources",
  "student_probes_researcher",
);
const contactEvents = eventTypes(
  "student_asks_gatekeeper",
  "student_asks_community_source",
  "student_asks_inheritor",
);
const rightsEvents = eventTypes(
  "student_inspects_rights",
  "rights_contact_flags_scope",
);
const recoveryEvents = eventTypes(
  "student_inspects_rights",
  "student_submits_correction",
);

const calibrationPolicies: Record<
  LearnerAdaptationVariantRefV4,
  CalibrationPolicyV4
> = {
  "variant-xunpu-source-triangulation": {
    variantRef: "variant-xunpu-source-triangulation",
    observationWindow: policyWindows["variant-xunpu-source-triangulation"],
    requirements: [
      makeRequirement(
        "source-event-observed",
        "已提交至少一条来源核验事件",
        (context) => hasAnyEvent(context, sourceEvents),
      ),
      makeRequirement(
        "source-event-triangulation",
        "至少提交两类不同的来源核验事件，形成三角核验",
        (context) => distinctEventTypeCount(context, sourceEvents) >= 2,
      ),
      makeRequirement(
        "source-comparison-or-probe",
        "完成来源比较或研究者探查，而不是只查看一次材料",
        (context) => hasAnyEvent(context, sourceComparisonEvents),
      ),
      makeRequirement(
        "source-consequences",
        "来源核验至少形成两条已提交的真实世界后果",
        (context) => consequenceCount(context, sourceEvents) >= 2,
      ),
      makeRequirement(
        "evidence-state-improved",
        "最终证据状态或可核验事实相较初始状态得到改善",
        (context) => (context.variableDelta("evidence_confidence") ?? -1) > 0
          || context.hasFactStatus(new Set(["corroborated", "confirmed"])),
      ),
    ],
  },
  "variant-xunpu-consent-negotiation": {
    variantRef: "variant-xunpu-consent-negotiation",
    observationWindow: policyWindows["variant-xunpu-consent-negotiation"],
    requirements: [
      makeRequirement(
        "person-boundary-dialogue",
        "至少完成一次人物用途、范围或撤回边界沟通",
        (context) => hasAnyEvent(context, contactEvents),
      ),
      makeRequirement(
        "rights-scope-check",
        "至少完成一次权利范围核验",
        (context) => hasAnyEvent(context, rightsEvents),
      ),
      makeRequirement(
        "rights-state-held",
        "最终版权风险没有高于初始值，社区信任没有低于初始值",
        (context) => (context.variableDelta("copyright_risk") ?? 1) <= 0
          && (context.variableDelta("community_trust") ?? -1) >= 0,
      ),
      makeRequirement(
        "withdrawal-recovery",
        "发生撤回时已在撤回后完成权利核验或公开恢复动作",
        (context) => {
          const withdrawal = eventSequence(
            context,
            eventTypes("tourist_withdraws_consent"),
          );
          return withdrawal === null || hasEventAfter(context, recoveryEvents, withdrawal);
        },
      ),
    ],
  },
  "variant-xunpu-deadline-service": {
    variantRef: "variant-xunpu-deadline-service",
    observationWindow: policyWindows["variant-xunpu-deadline-service"],
    requirements: [
      makeRequirement(
        "official-timestamp-request",
        "已向公共联络员提出带主体、时点或口径的实际请求",
        (context) => hasAnyEvent(context, eventTypes("student_requests_official_data")),
      ),
      makeRequirement(
        "bounded-service-response",
        "已形成有边界的等待或限定性服务提醒",
        (context) => hasAnyEvent(context, eventTypes(
          "student_waits_for_verification",
          "student_submits_limited_alert",
        )),
      ),
      makeRequirement(
        "work-or-teacher-result",
        "已有真实作品版本或已结算的教师门结果",
        (context) => context.workRefs.length > 0 || context.hasResolvedTeacherGate,
      ),
      makeRequirement(
        "public-service-state",
        "最终公共安全风险不升高且公众信任不下降",
        (context) => (context.variableDelta("public_safety_risk") ?? 1) <= 0
          && (context.variableDelta("public_trust") ?? -1) >= 0,
      ),
    ],
  },
  "variant-xunpu-editorial-independence": {
    variantRef: "variant-xunpu-editorial-independence",
    observationWindow: policyWindows["variant-xunpu-editorial-independence"],
    requirements: [
      makeRequirement(
        "commercial-trigger",
        "已观察到商户提出素材与版面交换条件",
        (context) => hasAnyEvent(context, eventTypes("shopkeeper_requests_placement")),
      ),
      makeRequirement(
        "independent-response",
        "已提交对商业交换的独立回应",
        (context) => hasAnyEvent(context, eventTypes("student_resolves_commercial_exchange")),
      ),
      makeRequirement(
        "editorial-work-chain",
        "商业判断之后形成真实稿件版本或发布动作",
        (context) => context.workRefs.length > 0,
      ),
      makeRequirement(
        "editorial-state-held",
        "最终编辑独立性不下降且没有新增更正债务",
        (context) => (context.variableDelta("editorial_independence") ?? -1) >= 0
          && (context.variableDelta("correction_debt") ?? 1) <= 0,
      ),
      makeRequirement(
        "commercial-error-recovery",
        "若曾造成独立性损害，窗口内仍出现可追溯恢复动作",
        (context) => {
          const damage = (context.variableDelta("editorial_independence") ?? 0) < 0
            || (context.variableDelta("correction_debt") ?? 0) > 0;
          const response = eventSequence(
            context,
            eventTypes("student_resolves_commercial_exchange"),
          );
          return !damage || (
            response !== null
            && hasEventAfter(context, eventTypes("student_submits_correction"), response)
          );
        },
      ),
    ],
  },
};

export function calibrationWindowPlanForVariantV4(
  variantRef: LearnerAdaptationVariantRefV4,
  fieldMode = false,
): LearnerCalibrationObservationWindowPlanV4 {
  const parsed = LearnerAdaptationVariantRefV4Schema.parse(variantRef);
  return { ...structuredClone(calibrationPolicies[parsed].observationWindow), ...(fieldMode ? { policyVersion: LearnerCalibrationFieldPolicyVersionV4 } : {}) };
}

export interface LearnerCalibrationEvaluationV4 {
  status: "observing" | "completed";
  observedBehaviorAlignment: number;
  completionBasis: string[];
  unmetRequirements: string[];
  result: LearnerCalibrationResultV4 | null;
}

class CalibrationContextV4 {
  readonly committedEvents: SimulationEventV4[];
  readonly studentActions: SimulationActionV4[];
  readonly workRefs: string[];
  readonly factRefs: string[];
  readonly variableRefs: string[];
  readonly consequenceRefs: string[];
  readonly teacherGateRefs: string[];
  readonly hasResolvedTeacherGate: boolean;
  readonly hasPendingTeacherGate: boolean;
  readonly hasRejectedTeacherGate: boolean;

  constructor(
    readonly record: SimulationSessionRecord,
    learnerActorId: string,
  ) {
    this.committedEvents = record.queue.filter((event) => event.status === "committed");
    const committedStudentEventSources = new Set(
      this.committedEvents
        .filter((event) => event.sourceKind === "student_action")
        .map((event) => event.sourceRef),
    );
    const committedEventRefs = new Set(this.committedEvents.map((event) => event.eventId));
    this.studentActions = record.studentActions.filter((action) => (
      action.actorId === learnerActorId
      && (action.submissionStatus === "accepted"
        || (action.action.verb === "draft" && action.submissionStatus === "draft"))
      && (
        committedStudentEventSources.has(action.workActionId)
        || action.sourceWorldEventIds.some((eventId) => committedEventRefs.has(eventId))
      )
    ));
    this.workRefs = [...new Set(this.studentActions.flatMap((action) => {
      if (action.action.verb !== "draft" && action.action.verb !== "submit") return [];
      const payload = action.action;
      return [
        action.workActionId,
        payload.artifactId,
        payload.revisionId,
        ...(payload.verb === "submit" ? payload.evidenceRefs : []),
      ];
    }))];
    const actualEvidenceRefs = new Set([
      ...this.committedEvents.map((event) => event.eventId),
      ...record.consequences.flatMap((consequence) => consequence.evidenceIds),
      ...record.resolutions.flatMap((resolution) => resolution.emittedEvidenceIds),
    ]);
    this.factRefs = record.currentSnapshot.facts
      .filter((fact) => fact.status !== "unknown" || fact.sourceRefs.some((ref) => actualEvidenceRefs.has(ref)))
      .map((fact) => fact.factId);
    const changedVariables = record.currentSnapshot.variables.filter((variable) => {
      const definition = record.release.variableDefinitions.find((candidate) => (
        candidate.variableId === variable.variableId
      ));
      return definition !== undefined
        && Math.abs(variable.after - definition.initialValue) > 0.000_001;
    });
    this.variableRefs = changedVariables.map((variable) => variable.variableId);
    const committedEventIds = new Set(this.committedEvents.map((event) => event.eventId));
    const consequences = record.consequences.filter((consequence) => (
      committedEventIds.has(consequence.sourceWorldEventId)
    ));
    this.consequenceRefs = consequences.map((consequence) => consequence.eventId);
    const teacherGateRefs = record.resolutions.flatMap((resolution) => {
      if (!resolution.teacherGate) return [];
      return [
        resolution.resolutionId,
        resolution.teacherGate.gateId,
        ...(resolution.teacherGate.teacherDecisionRef === null
          ? []
          : [resolution.teacherGate.teacherDecisionRef]),
      ];
    });
    this.teacherGateRefs = [...new Set(teacherGateRefs)];
    this.hasResolvedTeacherGate = record.resolutions.some((resolution) => (
      resolution.teacherGate !== null
      && resolution.teacherGate.status !== "pending"
    ));
    this.hasPendingTeacherGate = record.pendingGate !== null
      && record.pendingGate !== undefined
      || record.resolutions.some((resolution) => (
        resolution.teacherGate?.status === "pending"
      ));
    this.hasRejectedTeacherGate = record.resolutions.some((resolution) => (
      resolution.teacherGate?.status === "rejected"
    ));
  }

  variableDelta(variableId: string): number | null {
    const definition = this.record.release.variableDefinitions.find((candidate) => (
      candidate.variableId === variableId
    ));
    const current = this.record.currentSnapshot.variables.find((variable) => (
      variable.variableId === variableId
    ));
    if (!definition || !current) return null;
    return Number((current.after - definition.initialValue).toFixed(3));
  }

  hasFactStatus(statuses: Set<string>): boolean {
    return this.record.currentSnapshot.facts.some((fact) => statuses.has(fact.status));
  }
}

type CalibrationContext = CalibrationContextV4;

function requirementEvidence(
  context: CalibrationContext,
): LearnerCalibrationResultV4["evidence"] {
  return {
    committedWorldEventRefs: context.committedEvents.map((event) => event.eventId),
    studentActionRefs: context.studentActions.map((action) => action.workActionId),
    consequenceRefs: context.consequenceRefs,
    variableRefs: context.variableRefs,
    factRefs: context.factRefs,
    workRefs: context.workRefs,
    teacherGateRefs: context.teacherGateRefs,
  };
}

function evaluateFieldCalibration(input: {
  record: SimulationSessionRecord; learnerActorId: string; assessment?: FlagshipAssessmentRecordV4 | null;
}, variant: LearnerAdaptationVariantRefV4, plan: LearnerCalibrationObservationWindowPlanV4): LearnerCalibrationEvaluationV4 {
  const field = input.record.fieldInterview;
  if (!field || field.actorId !== input.learnerActorId) throw new Error("采访校准缺少同一学生的权威现场记录");
  const assessment = input.assessment;
  if (assessment && (assessment.sessionId !== input.record.sessionId || assessment.learnerActorId !== field.actorId || assessment.learnerBindingId !== field.bindingId)) throw new Error("校准作品与采访主体不一致");
  const events = field.events.filter(event => event.afterMinute <= plan.endVirtualMinute);
  const eventRefs = new Set(events.flatMap(event => event.evidenceRefs));
  const turns = field.turns.filter(turn => eventRefs.has(turn.id) && (turn.topicId || turn.choiceConfirmed || isFieldBoundaryRequest(turn.studentText)));
  const choices = new Set(turns.filter(turn => turn.choiceConfirmed).map(turn => turn.choiceId));
  const materials = new Set(field.materialIds.filter(ref => eventRefs.has(ref)));
  const facts = assessment?.evidenceFacts ?? [];
  const codes = new Set(facts.map(fact => fact.evidenceCode));
  const workRefs = assessment?.blindInput.artifactRevisions.map(work => work.revisionRef) ?? [];
  const requirements: Array<{ label: string; passed: boolean }> = [
    { label: `窗口内已发生至少${plan.minimumCommittedWorldEvents}项实质问答或确认安排`, passed: turns.length >= plan.minimumCommittedWorldEvents },
    { label: "至少一项本人的送审作品可对照本场证据", passed: workRefs.length > 0 },
    { label: "没有未解决的教师门或被忽略的记录边界", passed: !input.record.pendingGate && !turns.some(turn => isFieldBoundaryRequest(turn.studentText)) },
  ];
  if (variant === "variant-xunpu-source-triangulation") requirements.push(
    { label: "已经取得两个独立范围的原始或公开材料", passed: ["material-local-standard", "material-public-service", "material-service-update", "material-resident-account"].filter(id => materials.has(id)).length >= 2 },
    { label: "送审表述留下来源比较与未知范围，且无已识别的无依据主张", passed: codes.has("cross_source_comparison") && codes.has("bounded_unknown") && !codes.has("current_unsupported_claim") },
  );
  else if (variant === "variant-xunpu-consent-negotiation") requirements.push(
    { label: "由本人确认文字或替代记录方式", passed: choices.has("ahuan-scope") || choices.has("zhou-no-closeup") },
    { label: "作品和实际问答保留用途与同意边界", passed: codes.has("purpose_and_scope_declared") && codes.has("consent_scope_recorded") && !codes.has("consent_ignored") },
  );
  else if (variant === "variant-xunpu-editorial-independence") requirements.push(
    { label: "实际确认了商业素材的取舍与独立边界", passed: choices.has("wu-self-shoot") || choices.has("wu-interview-only") || (choices.has("wu-credit-check") && choices.has("wu-limited")) },
    { label: "送审成果保留公共价值或时效取舍，并无已识别的权利范围越界", passed: (codes.has("public_value_tradeoff") || codes.has("deadline_tradeoff_evidenced")) && !codes.has("rights_scope_exceeded") },
  );
  else requirements.push(
    { label: "本场咨询更新已经到达并作为实际资料取得", passed: materials.has("material-service-update") },
    { label: "送审成果保留限定发布与可追溯的后续调整", passed: codes.has("deadline_tradeoff_evidenced") && codes.has("bounded_unknown") && codes.has("grounded_transfer_reflection") },
  );
  const completionBasis = requirements.filter(item => item.passed).map(item => item.label);
  const unmetRequirements = requirements.filter(item => !item.passed).map(item => item.label);
  const observedBehaviorAlignment = Number((completionBasis.length / requirements.length).toFixed(3));
  const terminal = input.record.currentSnapshot.endingState.status !== "active";
  const elapsed = input.record.currentSnapshot.virtualTime.elapsedMinutes;
  if (!terminal && elapsed < plan.endVirtualMinute) return { status: "observing", observedBehaviorAlignment, completionBasis, unmetRequirements, result: null };
  const result = LearnerCalibrationResultV4Schema.parse({ policyVersion: plan.policyVersion,
    outcome: unmetRequirements.length ? "failure" : "success", observedBehaviorAlignment,
    observationWindow: { policyVersion: plan.policyVersion, startVirtualMinute: plan.startVirtualMinute, endVirtualMinute: Math.min(elapsed, plan.endVirtualMinute),
      startWorldStateVersion: 0, endWorldStateVersion: input.record.currentSnapshot.stateVersion, closedBy: terminal ? "world_terminal" : "window_elapsed" },
    evidence: { committedWorldEventRefs: events.map(event => event.id), studentActionRefs: turns.map(turn => turn.id), consequenceRefs: [], variableRefs: [],
      factRefs: [...materials], workRefs, teacherGateRefs: [] },
    completionBasis: ["冻结采访窗口已结束；校准是预测对账，不产生新的能力分。", ...completionBasis], unmetRequirements });
  return { status: "completed", observedBehaviorAlignment, completionBasis, unmetRequirements, result };
}

export function evaluateLearnerCalibrationV4(input: {
  variantRef: LearnerAdaptationVariantRefV4;
  learnerActorId: string;
  record: SimulationSessionRecord;
  observationWindow?: LearnerCalibrationObservationWindowPlanV4;
  assessment?: FlagshipAssessmentRecordV4 | null;
}): LearnerCalibrationEvaluationV4 {
  const variantRef = LearnerAdaptationVariantRefV4Schema.parse(input.variantRef);
  const policy = calibrationPolicies[variantRef];
  const plan = input.observationWindow
    ? LearnerCalibrationObservationWindowPlanV4Schema.parse(input.observationWindow)
    : policy.observationWindow;
  if (plan.policyVersion !== policyVersion && plan.policyVersion !== LearnerCalibrationFieldPolicyVersionV4) {
    throw new Error("校准观察窗口 policyVersion 不受支持");
  }
  if (plan.startVirtualMinute !== policy.observationWindow.startVirtualMinute
    || plan.endVirtualMinute !== policy.observationWindow.endVirtualMinute
    || plan.minimumCommittedWorldEvents
      !== policy.observationWindow.minimumCommittedWorldEvents) {
    throw new Error("校准观察窗口与 variant 策略不一致");
  }
  if (plan.policyVersion === LearnerCalibrationFieldPolicyVersionV4) return evaluateFieldCalibration(input, variantRef, plan);
  const context = new CalibrationContextV4(input.record, input.learnerActorId);
  const requirements: CalibrationRequirementV4[] = [
    makeRequirement(
      "minimum-committed-world-events",
      `冻结窗口内至少形成 ${plan.minimumCommittedWorldEvents} 条已提交世界事件`,
      (context) => context.committedEvents.length >= plan.minimumCommittedWorldEvents,
    ),
    makeRequirement(
      "teacher-gate-settled",
      "观察窗口内已触发的高风险教师门已进入 approved/revised 终态",
      (context) => !context.hasPendingTeacherGate && !context.hasRejectedTeacherGate,
    ),
    ...policy.requirements,
  ];
  const satisfiedRequirements = requirements.filter((requirement) => (
    requirement.satisfied(context)
  ));
  const unmetRequirements = requirements
    .filter((requirement) => !requirement.satisfied(context))
    .map((requirement) => requirement.label);
  const observedBehaviorAlignment = Number((
    satisfiedRequirements.length / requirements.length
  ).toFixed(3));
  const windowElapsed = input.record.currentSnapshot.virtualTime.elapsedMinutes
    >= plan.endVirtualMinute;
  const worldTerminal = input.record.currentSnapshot.endingState.status !== "active";
  const closed = worldTerminal || windowElapsed;
  const completionBasis = satisfiedRequirements.length > 0
    ? satisfiedRequirements.map((requirement) => requirement.label)
    : ["尚未观察到任何满足的任务结果条件。"];
  if (!closed) {
    return {
      status: "observing",
      observedBehaviorAlignment,
      completionBasis,
      unmetRequirements,
      result: null,
    };
  }
  const evidence = requirementEvidence(context);
  const outcome = unmetRequirements.length === 0 ? "success" : "failure";
  const result = LearnerCalibrationResultV4Schema.parse({
    policyVersion,
    outcome,
    observedBehaviorAlignment,
    observationWindow: {
      policyVersion,
      startVirtualMinute: plan.startVirtualMinute,
      endVirtualMinute: Math.min(
        input.record.currentSnapshot.virtualTime.elapsedMinutes,
        plan.endVirtualMinute,
      ),
      startWorldStateVersion: 0,
      endWorldStateVersion: input.record.currentSnapshot.stateVersion,
      closedBy: worldTerminal ? "world_terminal" : "window_elapsed",
    },
    evidence,
    completionBasis: [
      worldTerminal ? "世界已进入终局，观察窗口提前关闭。" : "冻结观察窗口已结束。",
      ...completionBasis,
    ].slice(0, 8),
    unmetRequirements,
  });
  return {
    status: "completed",
    observedBehaviorAlignment,
    completionBasis,
    unmetRequirements,
    result,
  };
}
