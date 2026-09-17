import {
  AgentArchitectureProfileSchema,
  AgentDispatchPlanSchema,
  AgentInstanceContextSchema,
  AgentScaleSchemaVersion,
  AgentSubscriptionSchema,
  AgentTaskSchema,
  ExperimentObservationRefSchema,
  RoleInteractionRequestSchema,
  type AgentArchitectureProfile,
  type AgentDispatchPlan,
  type AgentDispatchReason,
  type AgentInstanceContext,
  type AgentInstanceRef,
  type RoleContract,
  type AgentSubscription,
  type AgentTask,
  type AgentWaveBudgetObservation,
  type ExperimentObservationRef,
  type WorldEvent,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import type { AgentTemplateCatalog } from "./catalog.js";

export class AgentSchedulerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSchedulerConfigurationError";
  }
}

export interface AgentSchedulerOptions {
  waveBudget?: number;
  templateCatalog?: Pick<AgentTemplateCatalog, "assertSubscription">;
}

export interface CreateAgentTasksInput {
  event: WorldEvent;
  outboxId: string;
  sessionEpoch: string;
  causalDepth: number;
  expectedStateVersion: number;
  createdAt: string;
  completedIdempotencyKeys?: ReadonlySet<string>;
  recentlyScheduledAtByInstanceSubscription?: ReadonlyMap<string, string>;
  architectureProfile?: AgentArchitectureProfile | null;
  experimentObservation?: ExperimentObservationRef | null;
  instanceContextsByAgentId?: ReadonlyMap<string, AgentInstanceContext>;
  instanceResolver?: (
    event: WorldEvent,
    subscription: AgentSubscription,
  ) => AgentInstanceResolution;
  waveBudget?: number;
  nextTaskId: () => string;
}

export interface AgentInstanceResolution {
  instanceRef: AgentInstanceRef;
  instanceContext: AgentInstanceContext;
  roleSnapshot: RoleContract | null;
}

interface EvaluatedSubscription {
  subscription: AgentSubscription;
  instanceRef: AgentInstanceRef;
  instanceContext: AgentInstanceContext;
  roleSnapshot: RoleContract | null;
  idempotencyKey: string;
  decisionId: string;
  affected: boolean;
  reason: AgentDispatchReason;
  selectedOrder: number | null;
}

const standardArchitecturePolicy = {
  profileId: "architecture:standard",
  profileVersion: AgentScaleSchemaVersion,
  enabledTemplateIds: null,
  disabledTemplateIds: [],
} as const;

const standardArchitectureProfile = AgentArchitectureProfileSchema.parse({
  ...standardArchitecturePolicy,
  policyHash: hashValue(standardArchitecturePolicy),
});

function taskIdempotencyKey(
  event: WorldEvent,
  subscription: AgentSubscription,
  sessionEpoch: string,
): string {
  return `${sessionEpoch}:${event.eventId}:${subscription.subscriptionId}`;
}

function instanceRef(
  event: WorldEvent,
  subscription: AgentSubscription,
  sessionEpoch: string,
): AgentInstanceRef {
  return {
    instanceId: `${event.sessionId}:${sessionEpoch}:${subscription.agentId}`,
    instanceVersion: subscription.definitionVersion,
  };
}

export function agentDebounceKey(
  instanceId: string,
  subscriptionId: string,
): string {
  return `${instanceId}\u001f${subscriptionId}`;
}

function targetMatches(
  event: WorldEvent,
  subscription: AgentSubscription,
): boolean {
  if (subscription.targetActorIdField === null) return true;
  if (subscription.targetActorIdField === "interaction.toActorId") {
    const interaction = RoleInteractionRequestSchema.safeParse(
      event.payload.interaction,
    );
    return (
      interaction.success
      && interaction.data.toActorId === subscription.agentId
    );
  }
  return (
    subscription.targetActorIdField === "payload.targetAgentId"
    && event.payload.targetAgentId === subscription.agentId
  );
}

function architectureProfileIncludes(
  profile: AgentArchitectureProfile,
  subscription: AgentSubscription,
): boolean {
  if (profile.disabledTemplateIds.includes(subscription.templateRef.templateId)) {
    return false;
  }
  return (
    profile.enabledTemplateIds === null
    || profile.enabledTemplateIds.includes(subscription.templateRef.templateId)
  );
}

function fallbackLegacyInstanceContext(
  subscription: AgentSubscription,
): AgentInstanceContext {
  return AgentInstanceContextSchema.parse({
    bindingKind: "legacy_derived",
    bindingId: `legacy:${subscription.agentId}`,
    actorId: subscription.agentId,
    actorKind: "agent",
    courseId: "legacy/unobserved",
    teamId: "legacy/unobserved",
    privateMemoryNamespaceRef: "legacy/unobserved",
    configHash: "0".repeat(64),
    lifecycle: "legacy_derived",
    subjectActorId: null,
    subjectRoleId: null,
    resourceRef: null,
  });
}

function resolveInstance(
  input: CreateAgentTasksInput,
  subscription: AgentSubscription,
): AgentInstanceResolution {
  if (input.instanceResolver) {
    const resolved = input.instanceResolver(input.event, subscription);
    const context = AgentInstanceContextSchema.parse(
      resolved.instanceContext,
    );
    if (
      context.actorId !== subscription.agentId
      || resolved.instanceRef.instanceVersion
        !== subscription.definitionVersion
      || (
        resolved.roleSnapshot
        && (
          resolved.roleSnapshot.agentId !== subscription.agentId
          || resolved.roleSnapshot.roleId !== subscription.roleId
        )
      )
    ) {
      throw new AgentSchedulerConfigurationError(
        `智能体实例解析结果与订阅不一致：${subscription.subscriptionId}`,
      );
    }
    return {
      instanceRef: resolved.instanceRef,
      instanceContext: context,
      roleSnapshot: resolved.roleSnapshot,
    };
  }
  const context = input.instanceContextsByAgentId?.get(subscription.agentId);
  if (!context) {
    return {
      instanceRef: instanceRef(
        input.event,
        subscription,
        input.sessionEpoch,
      ),
      instanceContext: fallbackLegacyInstanceContext(subscription),
      roleSnapshot: null,
    };
  }
  const parsed = AgentInstanceContextSchema.parse(context);
  if (parsed.actorId !== subscription.agentId) {
    throw new AgentSchedulerConfigurationError(
      `智能体实例上下文绑定错误：${subscription.agentId}`,
    );
  }
  return {
    instanceRef: instanceRef(
      input.event,
      subscription,
      input.sessionEpoch,
    ),
    instanceContext: parsed,
    roleSnapshot: null,
  };
}

function debounceActive(
  input: CreateAgentTasksInput,
  subscription: AgentSubscription,
  ref: AgentInstanceRef,
): boolean {
  if (subscription.debounceMs === 0) return false;
  const previous = input.recentlyScheduledAtByInstanceSubscription?.get(
    agentDebounceKey(ref.instanceId, subscription.subscriptionId),
  );
  if (!previous) return false;
  const currentMs = Date.parse(input.createdAt);
  const previousMs = Date.parse(previous);
  if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs)) {
    throw new AgentSchedulerConfigurationError(
      `智能体去抖时间无效：${ref.instanceId}/${subscription.subscriptionId}`,
    );
  }
  return currentMs - previousMs < subscription.debounceMs;
}

function budgetObservation(input: {
  limit: number;
  affected: number;
  selected: number;
  consumed: number;
  exhausted: boolean;
}): AgentWaveBudgetObservation {
  return {
    limit: input.limit,
    affected: input.affected,
    selected: input.selected,
    filtered: Math.max(0, input.affected - input.selected),
    consumed: input.consumed,
    remaining: Math.max(0, input.limit - input.consumed),
    exhausted: input.exhausted,
  };
}

export class AgentScheduler {
  readonly #subscriptions: readonly AgentSubscription[];
  readonly #waveBudget: number;

  constructor(
    rawSubscriptions: readonly AgentSubscription[],
    options: AgentSchedulerOptions = {},
  ) {
    const subscriptions = rawSubscriptions.map((subscription) => (
      AgentSubscriptionSchema.parse(subscription)
    ));
    const seen = new Set<string>();
    for (const subscription of subscriptions) {
      if (seen.has(subscription.subscriptionId)) {
        throw new AgentSchedulerConfigurationError(
          `智能体订阅 ID 重复：${subscription.subscriptionId}`,
        );
      }
      seen.add(subscription.subscriptionId);
      options.templateCatalog?.assertSubscription(subscription);
    }
    const waveBudget = options.waveBudget ?? 32;
    if (!Number.isInteger(waveBudget) || waveBudget <= 0) {
      throw new AgentSchedulerConfigurationError("单波预算必须为正整数");
    }
    this.#waveBudget = waveBudget;
    this.#subscriptions = subscriptions
      .slice()
      .sort((left, right) => (
        right.priority - left.priority
        || left.subscriptionId.localeCompare(right.subscriptionId)
      ));
  }

  createDispatchPlan(input: CreateAgentTasksInput): AgentDispatchPlan {
    const completed = input.completedIdempotencyKeys ?? new Set<string>();
    const architectureProfile = input.architectureProfile
      ? AgentArchitectureProfileSchema.parse(input.architectureProfile)
      : standardArchitectureProfile;
    const expectedArchitecturePolicyHash = hashValue({
      profileId: architectureProfile.profileId,
      profileVersion: architectureProfile.profileVersion,
      enabledTemplateIds: architectureProfile.enabledTemplateIds,
      disabledTemplateIds: architectureProfile.disabledTemplateIds,
    });
    if (architectureProfile.policyHash !== expectedArchitecturePolicyHash) {
      throw new AgentSchedulerConfigurationError(
        `架构配置哈希不一致：${architectureProfile.profileId}@${architectureProfile.profileVersion}`,
      );
    }
    // Experiment metadata is deliberately parsed only as an observation. It
    // never participates in affected-set calculation, routing or permissions.
    const experimentObservation = input.experimentObservation
      ? ExperimentObservationRefSchema.parse(input.experimentObservation)
      : null;
    const limit = input.waveBudget ?? this.#waveBudget;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new AgentSchedulerConfigurationError("单波预算必须为正整数");
    }

    const planId = `dispatch-plan:${hashValue({
      sessionEpoch: input.sessionEpoch,
      outboxId: input.outboxId,
      policyHash: architectureProfile.policyHash,
    })}`;
    const waveId = `dispatch-wave:${hashValue({
      sessionEpoch: input.sessionEpoch,
      rootActionId: input.event.actionContext?.rootActionId
        ?? input.event.correlationId,
      causalDepth: input.causalDepth,
    })}`;

    // A dispatch plan is complete for subscriptions that declare the event
    // type. Subscriptions for unrelated event types are not candidates in
    // this wave; excluding them keeps the evidence log proportional to the
    // actual routing graph instead of materializing an all-to-all matrix.
    const evaluated: EvaluatedSubscription[] = this.#subscriptions
      .filter((subscription) => (
        subscription.eventTypes.includes(input.event.eventType)
      ))
      .map(
      (subscription) => {
        const resolution = resolveInstance(input, subscription);
        const ref = resolution.instanceRef;
        const context = resolution.instanceContext;
        const idempotencyKey = taskIdempotencyKey(
          input.event,
          subscription,
          input.sessionEpoch,
        );
        const base = {
          subscription,
          instanceRef: ref,
          instanceContext: context,
          roleSnapshot: resolution.roleSnapshot,
          idempotencyKey,
          decisionId: `dispatch-decision:${hashValue({
            planId,
            subscriptionId: subscription.subscriptionId,
          })}`,
          selectedOrder: null,
        };
        if (!subscription.enabled) {
          return {
            ...base,
            affected: false,
            reason: "subscription_disabled" as const,
          };
        }
        if (!targetMatches(input.event, subscription)) {
          return {
            ...base,
            affected: false,
            reason: "target_mismatch" as const,
          };
        }
        if (
          context.lifecycle === "paused"
          || context.lifecycle === "retired"
        ) {
          return {
            ...base,
            affected: true,
            reason: "instance_inactive" as const,
          };
        }
        if (input.causalDepth > subscription.maxCausalDepth) {
          return {
            ...base,
            affected: true,
            reason: "causal_depth_exceeded" as const,
          };
        }
        if (completed.has(idempotencyKey)) {
          return {
            ...base,
            affected: true,
            reason: "duplicate_suppressed" as const,
          };
        }
        if (debounceActive(input, subscription, ref)) {
          return {
            ...base,
            affected: true,
            reason: "debounce_active" as const,
          };
        }
        if (!architectureProfileIncludes(architectureProfile, subscription)) {
          return {
            ...base,
            affected: true,
            reason: "architecture_profile_excluded" as const,
          };
        }
        return {
          ...base,
          affected: true,
          reason: "selected" as const,
        };
      },
    );

    let consumed = 0;
    let selected = 0;
    let exhausted = false;
    for (const candidate of evaluated) {
      if (candidate.reason !== "selected") continue;
      if (consumed + candidate.subscription.waveCost > limit) {
        candidate.reason = "wave_budget_exhausted";
        exhausted = true;
        continue;
      }
      candidate.selectedOrder = selected;
      selected += 1;
      consumed += candidate.subscription.waveCost;
    }
    const affected = evaluated.filter((candidate) => candidate.affected).length;
    const budget = budgetObservation({
      limit,
      affected,
      selected,
      consumed,
      exhausted,
    });

    const decisions = evaluated.map((candidate) => ({
      subscriptionId: candidate.subscription.subscriptionId,
      agentId: candidate.subscription.agentId,
      roleId: candidate.subscription.roleId,
      templateRef: candidate.subscription.templateRef,
      instanceRef: candidate.instanceRef,
      instanceContext: candidate.instanceContext,
      decision: {
        decisionId: candidate.decisionId,
        affected: candidate.affected,
        decision: candidate.reason === "selected"
          ? "selected" as const
          : "filtered" as const,
        reason: candidate.reason,
        selectedOrder: candidate.selectedOrder,
        budget,
      },
    }));

    const tasks = evaluated
      .filter((candidate) => candidate.reason === "selected")
      .map((candidate) => AgentTaskSchema.parse({
        taskId: input.nextTaskId(),
        outboxId: input.outboxId,
        subscriptionId: candidate.subscription.subscriptionId,
        agentId: candidate.subscription.agentId,
        roleId: candidate.subscription.roleId,
        templateRef: candidate.subscription.templateRef,
        instanceRef: candidate.instanceRef,
        instanceContext: candidate.instanceContext,
        roleSnapshot: candidate.roleSnapshot,
        definitionVersion: candidate.subscription.definitionVersion,
        promptVersion: candidate.subscription.promptVersion,
        sessionId: input.event.sessionId,
        sessionEpoch: input.sessionEpoch,
        sceneId: input.event.sceneId,
        triggerEventId: input.event.eventId,
        triggerEventType: input.event.eventType,
        expectedStateVersion: input.expectedStateVersion,
        priority: candidate.subscription.priority,
        correlationId: input.event.correlationId,
        causalDepth: input.causalDepth,
        actionContext: input.event.actionContext,
        experimentObservation,
        dispatchDecision: {
          decisionId: candidate.decisionId,
          affected: true,
          decision: "selected",
          reason: "selected",
          selectedOrder: candidate.selectedOrder,
          budget,
        },
        idempotencyKey: candidate.idempotencyKey,
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        availableAt: input.createdAt,
        lease: null,
        lastErrorCode: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        completedAt: null,
      }));

    return AgentDispatchPlanSchema.parse({
      planId,
      waveId,
      policyVersion: AgentScaleSchemaVersion,
      sessionId: input.event.sessionId,
      sessionEpoch: input.sessionEpoch,
      eventId: input.event.eventId,
      outboxId: input.outboxId,
      createdAt: input.createdAt,
      architectureProfile,
      experimentObservation,
      affectedInstanceIds: [...new Set(
        evaluated
          .filter((candidate) => candidate.affected)
          .map((candidate) => candidate.instanceRef.instanceId),
      )],
      budget,
      decisions,
      tasks,
    });
  }

  /**
   * Keep the V1.0 call surface: callers that do not need complete decision
   * evidence still receive executable tasks only.
   */
  createTasks(input: CreateAgentTasksInput): AgentTask[] {
    return this.createDispatchPlan(input).tasks;
  }
}
