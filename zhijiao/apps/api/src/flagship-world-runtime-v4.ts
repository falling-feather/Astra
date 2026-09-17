import { createHash } from "node:crypto";
import {
  FlagshipWorldRuntimeDefinitionV4Schema,
  type FlagshipContentReferenceV4,
  type FlagshipRuntimeAutonomyBindingV4,
  type FlagshipRuntimeGroundedBindingV4,
  type FlagshipRuntimePhaseV4,
  type FlagshipWorldRuntimeDefinitionV4,
  type SemanticActionDecisionV4,
  type SemanticActionVerbV4,
  type StudentWorkAction,
} from "@ronggang/contracts";
import type {
  XunpuFlagshipContentV4,
  XunpuStudentIntentV4,
} from "@ronggang/course-content";
import {
  evaluateFlagshipRuntimeActionPolicyV4,
  type FlagshipActionPolicyEvaluationV4,
} from "@ronggang/world-core";
import type { SimulationSessionRecord } from "@ronggang/world-core";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function sameContentRef(
  left: FlagshipContentReferenceV4,
  right: FlagshipContentReferenceV4,
): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function assertRuntime(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V4 运行时定义非法：${message}`);
}

function assertUnique(values: readonly string[], label: string): void {
  assertRuntime(new Set(values).size === values.length, `${label}存在重复引用`);
}

function handledEventTypes(record: SimulationSessionRecord): Set<string> {
  return new Set(record.queue
    .filter((event) => ["committed", "rejected", "awaiting_gate"].includes(event.status))
    .map((event) => event.eventType));
}

function phaseMatches(
  phase: FlagshipRuntimePhaseV4,
  record: SimulationSessionRecord,
  handled: ReadonlySet<string>,
): boolean {
  const terminalMatches = phase.activation.terminal
    && record.currentSnapshot.endingState.status !== "active";
  const allMatch = phase.activation.allHandledEventTypes.every((eventType) => (
    handled.has(eventType)
  ));
  const anyMatch = phase.activation.anyHandledEventTypes.length === 0
    || phase.activation.anyHandledEventTypes.some((eventType) => handled.has(eventType));
  return terminalMatches || (allMatch && anyMatch);
}

function actionFromTemplate(
  template: FlagshipWorldRuntimeDefinitionV4["eventActions"][number]["action"],
  utterance: string,
): StudentWorkAction["action"] {
  switch (template.verb) {
    case "observe":
      return {
        verb: "observe",
        targetRef: structuredClone(template.targetRef),
        observationFocus: utterance,
      };
    case "ask":
    case "probe":
    case "negotiate":
      return {
        verb: template.verb,
        targetRef: structuredClone(template.targetRef),
        utterance,
      };
    case "compare":
    case "inspect":
      return {
        verb: template.verb,
        targetRefs: structuredClone(template.targetRefs),
        evidenceQuestion: utterance,
      };
    case "wait":
      return {
        verb: "wait",
        durationMinutes: template.durationMinutes,
        reason: utterance,
      };
  }
}

export type FlagshipRuntimeActionResolutionV4 =
  | {
      kind: "event";
      bindingId: string;
      eventTemplateId: string;
      reasons: readonly string[];
    }
  | {
      kind: "workspace";
      bindingId: string;
      reasons: readonly string[];
    }
  | {
      kind: "unavailable";
      bindingId: string | null;
      reasons: readonly string[];
    };

export interface FlagshipRuntimeActionWindowOptionV4 {
  readonly kind: "event" | "workspace";
  readonly bindingId: string;
  readonly eventTemplateId: string | null;
  readonly targetRefs: readonly string[];
  readonly verbs: readonly XunpuStudentIntentV4[];
  readonly status: "available" | "blocked";
  readonly reasons: readonly string[];
}

export interface FlagshipRuntimeActionWindowOptionsV4 {
  readonly objectRefs: readonly string[];
  readonly allowedIntents: readonly XunpuStudentIntentV4[];
  readonly options: readonly FlagshipRuntimeActionWindowOptionV4[];
}

const intentByVerb: Partial<Record<SemanticActionVerbV4, XunpuStudentIntentV4>> = {
  observe: "observe",
  ask: "ask",
  probe: "probe",
  inspect: "inspect",
  compare: "compare",
  negotiate: "negotiate",
  draft: "draft",
  wait: "wait",
  escalate: "escalate",
  submit: "submit_gate",
};

function intentsForVerbs(
  verbs: readonly SemanticActionVerbV4[],
): XunpuStudentIntentV4[] {
  return [...new Set(verbs
    .map((verb) => intentByVerb[verb])
    .filter((intent): intent is XunpuStudentIntentV4 => intent !== undefined))];
}

function actionObjectIds(
  action: FlagshipWorldRuntimeDefinitionV4["eventActions"][number]["action"],
): string[] {
  return "targetRef" in action
    ? [action.targetRef.objectId]
    : "targetRefs" in action
      ? action.targetRefs.map((reference) => reference.objectId)
      : [];
}

export interface CompiledFlagshipWorldRuntimeV4 {
  readonly definitionId: string;
  readonly definitionHash: string;
  readonly definition: FlagshipWorldRuntimeDefinitionV4;
  phaseFor(record: SimulationSessionRecord): FlagshipRuntimePhaseV4;
  allowedIntentsForPhase(
    phase: FlagshipRuntimePhaseV4,
    record?: SimulationSessionRecord,
  ): XunpuStudentIntentV4[];
  actionWindowOptions(
    record: SimulationSessionRecord,
    phase: FlagshipRuntimePhaseV4,
  ): FlagshipRuntimeActionWindowOptionsV4;
  portraitAssetFor(entityId: string): string;
  resolveAction(
    record: SimulationSessionRecord,
    decision: Extract<SemanticActionDecisionV4, { status: "accepted" }>,
  ): FlagshipRuntimeActionResolutionV4;
  eventTemplateFor(
    record: SimulationSessionRecord,
    decision: Extract<SemanticActionDecisionV4, { status: "accepted" }>,
  ): string | null;
  actionForEvent(eventTemplateId: string, utterance: string): StudentWorkAction["action"];
  groundedBindingForEvent(eventTemplateId: string): FlagshipRuntimeGroundedBindingV4 | null;
  autonomySignalsForEvent(
    eventType: string,
    resolution?: SimulationSessionRecord["resolutions"][number],
  ): Record<string, boolean | number | string>;
  autonomySignalsForRecord(record: SimulationSessionRecord): Record<string, boolean | number | string>;
  autonomyActorForEvent(eventType: string): string | null;
  autonomyMemoryForEvent(
    eventType: string,
    eventId: string,
    publicSummary: string,
  ): Array<{
    entityId: string;
    memoryKey: string;
    valueHash: string;
    publicSummary: string;
  }>;
  autonomyVariablesForRecord(record: SimulationSessionRecord): Record<string, number>;
}

export function compileFlagshipWorldRuntimeV4(input: {
  definition: FlagshipWorldRuntimeDefinitionV4;
  contentRef: FlagshipContentReferenceV4;
  content: XunpuFlagshipContentV4;
}): CompiledFlagshipWorldRuntimeV4 {
  const definition = FlagshipWorldRuntimeDefinitionV4Schema.parse(input.definition);
  assertRuntime(
    sameContentRef(definition.contentRef, input.contentRef),
    "运行时定义与会话冻结内容引用漂移",
  );
  assertRuntime(
    definition.contentRef.contentHash === input.content.contentHash
      && definition.contentRef.contentSchemaVersion === input.content.schemaVersion,
    "运行时定义与内容清单哈希或 Schema 漂移",
  );

  assertUnique(definition.phases.map((item) => item.phaseId), "阶段 ID");
  assertUnique(definition.phases.map((item) => item.worldStateRef), "世界状态引用");
  assertUnique(definition.intentBindings.map((item) => item.bindingId), "意图绑定 ID");
  assertUnique(definition.eventActions.map((item) => item.eventTemplateId), "事件动作");
  assertUnique(definition.autonomyBindings.map((item) => item.eventType), "自主事件绑定");
  assertUnique(definition.portraits.map((item) => item.entityId), "人物肖像绑定");

  const locations = new Set(input.content.locations.map((item) => item.locationId));
  const cast = new Set(input.content.cast.map((item) => item.entityId));
  const worldObjects = new Set(input.content.worldObjects.map((item) => item.objectId));
  const artifacts = new Set(input.content.artifacts.map((item) => item.artifactId));
  const media = new Map(input.content.mediaAssets.map((item) => [item.assetId, item]));
  const variables = new Set<string>(
    input.content.variables.map((item) => item.variableId),
  );
  const external = new Set(definition.externalObjectRefs);
  const knownObject = (objectId: string): boolean => (
    locations.has(objectId)
    || cast.has(objectId)
    || worldObjects.has(objectId)
    || artifacts.has(objectId)
    || media.has(objectId)
    || external.has(objectId)
  );

  const defaultPhases = definition.phases.filter((phase) => (
    !phase.activation.terminal
    && phase.activation.allHandledEventTypes.length === 0
    && phase.activation.anyHandledEventTypes.length === 0
  ));
  assertRuntime(defaultPhases.length === 1, "必须且只能有一个默认阶段");
  for (const phase of definition.phases) {
    assertRuntime(locations.has(phase.locationId), `阶段 ${phase.phaseId} 引用未知地点`);
    assertRuntime(
      media.get(phase.environmentAssetId)?.productionStatus === "ready",
      `阶段 ${phase.phaseId} 环境媒体未就绪`,
    );
    assertUnique(phase.npcRefs, `阶段 ${phase.phaseId} NPC`);
    assertUnique(phase.objectRefs, `阶段 ${phase.phaseId} 对象`);
    for (const entityId of phase.npcRefs) {
      assertRuntime(cast.has(entityId), `阶段 ${phase.phaseId} 引用未知 NPC ${entityId}`);
    }
    for (const objectId of phase.objectRefs) {
      assertRuntime(knownObject(objectId), `阶段 ${phase.phaseId} 引用未知对象 ${objectId}`);
    }
  }

  const actionByEvent = new Map(definition.eventActions.map((item) => (
    [item.eventTemplateId, item.action] as const
  )));
  for (const binding of definition.intentBindings) {
    assertUnique(binding.verbs, `意图绑定 ${binding.bindingId} 动词`);
    assertUnique(binding.targetRefs, `意图绑定 ${binding.bindingId} 目标`);
    for (const targetRef of binding.targetRefs) {
      assertRuntime(knownObject(targetRef), `意图绑定 ${binding.bindingId} 引用未知目标 ${targetRef}`);
    }
    for (const eventTemplateId of binding.eventTemplateCandidates) {
      assertRuntime(
        actionByEvent.has(eventTemplateId),
        `意图绑定 ${binding.bindingId} 缺少事件动作 ${eventTemplateId}`,
      );
    }
  }
  for (const eventAction of definition.eventActions) {
    const refs = "targetRef" in eventAction.action
      ? [eventAction.action.targetRef]
      : "targetRefs" in eventAction.action
        ? eventAction.action.targetRefs
        : [];
    for (const reference of refs) {
      assertRuntime(
        knownObject(reference.objectId),
        `事件动作 ${eventAction.eventTemplateId} 引用未知对象 ${reference.objectId}`,
      );
    }
  }

  const groundedEventIds = definition.groundedBindings.flatMap((item) => (
    item.eventTemplateIds
  ));
  assertUnique(groundedEventIds, "知识协作事件模板");
  for (const binding of definition.groundedBindings) {
    for (const eventTemplateId of binding.eventTemplateIds) {
      assertRuntime(actionByEvent.has(eventTemplateId), `知识协作引用未知事件 ${eventTemplateId}`);
    }
    for (const objectRef of binding.affectedObjectRefs) {
      assertRuntime(knownObject(objectRef), `知识协作引用未知对象 ${objectRef}`);
    }
  }

  const portraitByEntity = new Map(definition.portraits.map((item) => (
    [item.entityId, item.assetId] as const
  )));
  for (const portrait of definition.portraits) {
    assertRuntime(cast.has(portrait.entityId), `肖像引用未知人物 ${portrait.entityId}`);
    assertRuntime(
      media.get(portrait.assetId)?.productionStatus === "ready",
      `人物 ${portrait.entityId} 的肖像未就绪`,
    );
  }
  for (const entityId of new Set(definition.phases.flatMap((phase) => phase.npcRefs))) {
    assertRuntime(portraitByEntity.has(entityId), `场景人物 ${entityId} 缺少肖像绑定`);
  }

  const autonomyByEvent = new Map(definition.autonomyBindings.map((item) => (
    [item.eventType, item] as const
  )));
  for (const binding of definition.autonomyBindings) {
    assertRuntime(
      (binding.actorRef === null) === (binding.memoryKey === null),
      `自主事件 ${binding.eventType} 的人物与记忆键必须同时存在或同时为空`,
    );
    if (binding.actorRef) {
      assertRuntime(cast.has(binding.actorRef), `自主事件引用未知人物 ${binding.actorRef}`);
    }
    if (binding.positiveDeltaSignal) {
      assertRuntime(
        variables.has(binding.positiveDeltaSignal.variableId),
        `自主事件引用未知变量 ${binding.positiveDeltaSignal.variableId}`,
      );
    }
  }

  const phases = [...definition.phases].sort((left, right) => (
    right.priority - left.priority || left.phaseId.localeCompare(right.phaseId)
  ));
  const intentBindings = [...definition.intentBindings].sort((left, right) => (
    right.priority - left.priority || left.bindingId.localeCompare(right.bindingId)
  ));
  const actionEvaluationFor = (
    record: SimulationSessionRecord,
    eventTemplateId: string,
  ): FlagshipActionPolicyEvaluationV4 => {
    const template = record.release.eventTemplates.find((candidate) => (
      candidate.eventTemplateId === eventTemplateId
    ));
    if (!template) {
      return {
        status: "blocked",
        allowed: false,
        eventTemplateId,
        reasons: [`当前发布不存在事件模板：${eventTemplateId}`],
      };
    }
    if (template.sourceKind !== "student_action") {
      return {
        status: "blocked",
        allowed: false,
        eventTemplateId,
        reasons: [`事件模板 ${eventTemplateId} 不接受学生行动来源`],
      };
    }
    if (!template.challengeLevels.includes(record.challengeAssignment.challengeLevel)) {
      return {
        status: "blocked",
        allowed: false,
        eventTemplateId,
        reasons: [`事件模板 ${eventTemplateId} 不属于当前挑战等级`],
      };
    }
    return evaluateFlagshipRuntimeActionPolicyV4(
      record.release.actionPolicy,
      eventTemplateId,
      record,
    );
  };
  const bindingMatches = (
    binding: FlagshipWorldRuntimeDefinitionV4["intentBindings"][number],
    verb: SemanticActionVerbV4,
    targetIds: ReadonlySet<string>,
  ): boolean => (
    binding.verbs.includes(verb)
      && (binding.targetRefs.length === 0
        || binding.targetRefs.some((objectId) => targetIds.has(objectId)))
  );
  const resolveAction = (
    record: SimulationSessionRecord,
    decision: Extract<SemanticActionDecisionV4, { status: "accepted" }>,
  ): FlagshipRuntimeActionResolutionV4 => {
    const targets = new Set(decision.canonicalAction.targetRefs.map((item) => item.objectId));
    const binding = intentBindings.find((candidate) => bindingMatches(
      candidate,
      decision.canonicalAction.verb,
      targets,
    ));
    if (!binding) {
      return {
        kind: "unavailable",
        bindingId: null,
        reasons: [
          `没有绑定动词 ${decision.canonicalAction.verb} 与当前对象的可执行世界行动`,
          "请从当前行动窗口选择已签发的人物、材料或工作对象。",
        ],
      };
    }
    if (binding.workspaceOnly) {
      return {
        kind: "workspace",
        bindingId: binding.bindingId,
        reasons: ["该行动需要作品版本、媒体或教师门证据，不能直接写入世界。"],
      };
    }
    const reasons: string[] = [];
    for (const eventTemplateId of binding.eventTemplateCandidates) {
      const evaluation = actionEvaluationFor(record, eventTemplateId);
      if (evaluation.allowed) {
        return {
          kind: "event",
          bindingId: binding.bindingId,
          eventTemplateId,
          reasons: [],
        };
      }
      reasons.push(...evaluation.reasons);
    }
    return {
      kind: "unavailable",
      bindingId: binding.bindingId,
      reasons: reasons.length > 0
        ? [...new Set(reasons)]
        : ["当前对象存在绑定，但没有满足发布条件的世界事件。"],
    };
  };
  const actionWindowOptions = (
    record: SimulationSessionRecord,
    phase: FlagshipRuntimePhaseV4,
  ): FlagshipRuntimeActionWindowOptionsV4 => {
    const location = input.content.locations.find((candidate) => (
      candidate.locationId === phase.locationId
    ));
    if (!location) throw new Error(`V4 场景位置不存在：${phase.locationId}`);
    const objectRefs = new Set<string>([
      phase.locationId,
      ...phase.npcRefs,
      ...phase.objectRefs,
    ]);
    const allowedIntents = new Set<XunpuStudentIntentV4>(location.allowedIntents);
    const options: FlagshipRuntimeActionWindowOptionV4[] = [];
    for (const binding of intentBindings) {
      const bindingVerbs = intentsForVerbs(binding.verbs);
      if (binding.workspaceOnly) {
        for (const intent of bindingVerbs) allowedIntents.add(intent);
        options.push({
          kind: "workspace",
          bindingId: binding.bindingId,
          eventTemplateId: null,
          targetRefs: structuredClone(binding.targetRefs),
          verbs: bindingVerbs,
          status: "available",
          reasons: [],
        });
        continue;
      }
      for (const eventTemplateId of binding.eventTemplateCandidates) {
        const action = actionByEvent.get(eventTemplateId);
        if (!action) continue;
        const evaluation = actionEvaluationFor(record, eventTemplateId);
        const targetRefs = binding.targetRefs.length > 0
          ? binding.targetRefs
          : actionObjectIds(action);
        if (evaluation.allowed) {
          for (const objectId of targetRefs) objectRefs.add(objectId);
          for (const intent of bindingVerbs) allowedIntents.add(intent);
        }
        options.push({
          kind: "event",
          bindingId: binding.bindingId,
          eventTemplateId,
          targetRefs: structuredClone(targetRefs),
          verbs: bindingVerbs,
          status: evaluation.allowed ? "available" : "blocked",
          reasons: structuredClone(evaluation.reasons),
        });
      }
    }
    return {
      objectRefs: [...objectRefs],
      allowedIntents: [...allowedIntents],
      options,
    };
  };
  const groundedByEvent = new Map<string, FlagshipRuntimeGroundedBindingV4>();
  for (const binding of definition.groundedBindings) {
    for (const eventTemplateId of binding.eventTemplateIds) {
      groundedByEvent.set(eventTemplateId, binding);
    }
  }

  const compiled: CompiledFlagshipWorldRuntimeV4 = {
    definitionId: definition.definitionId,
    definitionHash: hash(definition),
    definition: structuredClone(definition),
    phaseFor(record) {
      const handled = handledEventTypes(record);
      const phase = phases.find((candidate) => phaseMatches(candidate, record, handled));
      if (!phase) throw new Error("V4 运行时定义没有可达阶段");
      return structuredClone(phase);
    },
    allowedIntentsForPhase(phase, record) {
      if (record) return actionWindowOptions(record, phase).allowedIntents.slice();
      const location = input.content.locations.find((candidate) => (
        candidate.locationId === phase.locationId
      ));
      if (!location) throw new Error(`V4 场景位置不存在：${phase.locationId}`);
      return [...new Set(location.allowedIntents)];
    },
    actionWindowOptions(record, phase) {
      return actionWindowOptions(record, phase);
    },
    portraitAssetFor(entityId) {
      const assetId = portraitByEntity.get(entityId);
      if (!assetId) throw new Error(`V4 场景人物缺少肖像：${entityId}`);
      return assetId;
    },
    resolveAction(record, decision) {
      return resolveAction(record, decision);
    },
    eventTemplateFor(record, decision) {
      const resolution = resolveAction(record, decision);
      return resolution.kind === "event" ? resolution.eventTemplateId : null;
    },
    actionForEvent(eventTemplateId, utterance) {
      const template = actionByEvent.get(eventTemplateId);
      if (!template) throw new Error(`语义行动无法映射到发布事件：${eventTemplateId}`);
      return actionFromTemplate(template, utterance);
    },
    groundedBindingForEvent(eventTemplateId) {
      const binding = groundedByEvent.get(eventTemplateId);
      return binding ? structuredClone(binding) : null;
    },
    autonomySignalsForEvent(eventType, resolution) {
      const binding = autonomyByEvent.get(eventType);
      if (!binding) return {};
      const signals: Record<string, boolean | number | string> = {
        ...binding.staticSignals,
      };
      if (binding.positiveDeltaSignal) {
        const delta = resolution?.variableDeltas.find((candidate) => (
          candidate.variableId === binding.positiveDeltaSignal?.variableId
        ))?.delta ?? 0;
        if (delta > 0) signals[binding.positiveDeltaSignal.positiveSignal] = true;
      }
      return signals;
    },
    autonomySignalsForRecord(record) {
      return record.queue
        .filter((event) => event.status === "committed")
        .reduce<Record<string, boolean | number | string>>((signals, event) => {
          const binding = autonomyByEvent.get(event.eventType);
          if (!binding) return signals;
          const resolution = record.resolutions.find((candidate) => (
            candidate.resolutionId === event.resolutionId
          ));
          Object.assign(signals, compiled.autonomySignalsForEvent(event.eventType, resolution));
          return signals;
        }, { student_enters_gate: true });
    },
    autonomyActorForEvent(eventType) {
      return autonomyByEvent.get(eventType)?.actorRef ?? null;
    },
    autonomyMemoryForEvent(eventType, eventId, publicSummary) {
      const binding: FlagshipRuntimeAutonomyBindingV4 | undefined = autonomyByEvent.get(eventType);
      if (!binding?.actorRef || !binding.memoryKey) return [];
      return [{
        entityId: binding.actorRef,
        memoryKey: binding.memoryKey,
        valueHash: hash({ eventType, eventId, publicSummary }),
        publicSummary: publicSummary.slice(0, 500),
      }];
    },
    autonomyVariablesForRecord(record) {
      return Object.fromEntries(record.currentSnapshot.variables
        .filter((variable) => variables.has(variable.variableId))
        .map((variable) => [variable.variableId, variable.after]));
    },
  };
  return compiled;
}
