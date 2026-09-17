import { randomUUID } from "node:crypto";
import {
  AdminAgentCollaborationEpisodeV3Schema,
  AgentObservationSchema,
  AgentObservationSchemaVersion,
  AgentStateSchema,
  AgentStateSchemaVersion,
  StudentAgentCollaborationEpisodeV3Schema,
  TeacherAgentCollaborationEpisodeV3Schema,
  type AdminAgentCollaborationEpisodeV3,
  type AgentObservation,
  type AgentState,
  type SimulationResolution,
  type StudentAgentCollaborationEpisodeV3,
  type TeacherAgentCollaborationEpisodeV3,
  type WorldSnapshot,
} from "@ronggang/contracts";
import {
  SimulationAgentTaskV3Schema,
  SimulationAgentTaskV3SchemaVersion,
  createSimulationDispatchPlanV3,
  hashSimulationRuntimeValueV3,
  runSimulationAgentTaskV3,
  type SimulationAgentExecutorV3,
  type SimulationAgentTemplateV3,
} from "@ronggang/agent-runtime";
import {
  type SimulationIntentRunProposal,
  type SimulationQueuedEvent,
  type SimulationRunEffects,
  type SimulationSessionRecord,
  type WorldSimulationEngineV3,
} from "@ronggang/world-core";
import {
  SimulationCollaborationRecordV3Version,
  validateSimulationCollaborationRecordV3,
  type SimulationCollaborationSessionRecordV3,
  type SimulationCollaborationStoreV3,
  type SimulationContributionRecordV3,
  type SimulationPreparedEpisodeRecordV3,
  type SimulationStudentDecisionRecordV3,
} from "./simulation-store-v3.js";

export interface SimulationEpisodeViewsV3 {
  student: StudentAgentCollaborationEpisodeV3;
  teacher: TeacherAgentCollaborationEpisodeV3;
  admin: AdminAgentCollaborationEpisodeV3;
}

export interface SimulationOrchestratorV3Options {
  engine: Pick<
    WorldSimulationEngineV3,
    "getRecord" | "resolveNextEvent" | "declineNextEvent" | "decideTeacherGate"
  >;
  store: SimulationCollaborationStoreV3;
  templates: SimulationAgentTemplateV3[];
  executors: ReadonlyMap<
    string,
    SimulationAgentExecutorV3<SimulationRunEffects>
  >;
  maxSelectedAgents?: number;
  now?: () => string;
  monotonicNowMs?: () => number;
  idFactory?: (prefix: string) => string;
  buildTaskInstruction?: (input: {
    world: SimulationSessionRecord;
    event: SimulationQueuedEvent;
    publicCue: string;
  }) => string;
}

export interface RecordSimulationStudentDecisionV3Input {
  sessionId: string;
  episodeId: string;
  decisionRef: string;
  decision: SimulationStudentDecisionRecordV3["decision"];
  rationale: string;
}

export interface DecideSimulationEpisodeGateV3Input {
  sessionId: string;
  episodeId: string;
  decision: "approved" | "revised" | "rejected";
  teacherDecisionRef: string;
  revisionPolicy: "reduce_effects" | null;
  revisedConsequenceSummary: string | null;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function assertOperation(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`V3 智能体编排失败：${message}`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function referenceKey(reference: { objectType: string; objectId: string }): string {
  return `${reference.objectType}:${reference.objectId}`;
}

function trustBand(value: number): "low" | "medium" | "high" {
  return value < 35 ? "low" : value < 70 ? "medium" : "high";
}

function episodeFailureFromResolution(
  resolution: SimulationResolution,
): NonNullable<SimulationPreparedEpisodeRecordV3["failureCode"]> {
  return resolution.failure?.code === "state_version_drift"
    ? "version_hash_drift"
    : "resolution_failed";
}

export class SimulationAgentOrchestratorV3 {
  readonly #engine: SimulationOrchestratorV3Options["engine"];
  readonly #store: SimulationCollaborationStoreV3;
  readonly #templates: SimulationAgentTemplateV3[];
  readonly #executors: SimulationOrchestratorV3Options["executors"];
  readonly #maxSelectedAgents: number;
  readonly #now: () => string;
  readonly #monotonicNowMs: () => number;
  readonly #idFactory: (prefix: string) => string;
  readonly #buildTaskInstruction: NonNullable<
    SimulationOrchestratorV3Options["buildTaskInstruction"]
  >;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(options: SimulationOrchestratorV3Options) {
    assertOperation(options.templates.length > 0 && options.templates.length <= 14,
      "运行目录必须包含 1—14 个智能体模板");
    this.#engine = options.engine;
    this.#store = options.store;
    this.#templates = structuredClone(options.templates);
    this.#executors = options.executors;
    this.#maxSelectedAgents = options.maxSelectedAgents ?? 5;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#monotonicNowMs = options.monotonicNowMs ?? (() => Date.now());
    this.#idFactory = options.idFactory
      ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.#buildTaskInstruction = options.buildTaskInstruction
      ?? ((input) => input.publicCue);
  }

  async prepareNextEpisode(sessionId: string): Promise<SimulationEpisodeViewsV3> {
    return this.#serialized(sessionId, async () => {
      const world = await this.#engine.getRecord(sessionId);
      let collaboration = await this.#loadOrCreate(world);
      const openEpisode = collaboration.episodes.find((episode) => (
        episode.status === "suggestion_ready"
          || (episode.status === "decided"
            && episode.studentDecision?.decision === "accept")
          || episode.status === "awaiting_gate"
      ));
      if (openEpisode) return this.#project(world, collaboration, openEpisode);

      const event = this.#nextReadyEvent(world);
      if (!event) return this.#waitingViews(world);
      const existing = collaboration.episodes.find(
        (episode) => episode.event.eventId === event.eventId,
      );
      if (existing) return this.#project(world, collaboration, existing);
      const eventTemplate = world.release.eventTemplates.find(
        (template) => template.eventTemplateId === event.eventTemplateId,
      );
      assertOperation(eventTemplate !== undefined, "事件模板不存在");

      const exhaustedAgentIds = new Set(
        collaboration.agentStates
          .filter((state) => state.remainingActionBudget === 0)
          .map((state) => state.agentId),
      );
      const effectiveTemplates = this.#templates.map((template) => ({
        ...template,
        available: template.available && !exhaustedAgentIds.has(template.agentId),
      }));
      const now = this.#now();
      const taskInstruction = this.#buildTaskInstruction({
        world,
        event,
        publicCue: eventTemplate.publicCue,
      });
      const plan = createSimulationDispatchPlanV3({
        sessionId,
        sourceWorldEventId: event.eventId,
        sourceWorldStateVersion: world.currentSnapshot.stateVersion,
        eventType: event.eventType,
        affectedObjectRefs: event.affectedObjectRefs,
        candidateAgentTemplateIds: eventTemplate.candidateAgentTemplateIds,
        templates: effectiveTemplates,
        maxSelected: this.#maxSelectedAgents,
        createdAt: now,
        dispatchPlanId: this.#idFactory("dispatch-plan"),
      });
      const nextStates = structuredClone(collaboration.agentStates);
      const observations: AgentObservation[] = [];
      const tasks = [];
      const runs = [];
      const intents = [];
      const contributions: SimulationContributionRecordV3[] = [];

      for (const decision of plan.decisions.filter(
        (item) => item.decision === "selected",
      )) {
        const template = effectiveTemplates.find(
          (candidate) => candidate.agentTemplateId === decision.agentTemplateId,
        );
        assertOperation(template !== undefined, "派发模板无法回溯");
        let state = this.#stateFor(template, world.currentSnapshot, nextStates, now);
        const observation = this.#observationFor({
          state,
          template,
          snapshot: world.currentSnapshot,
          event,
          instruction: taskInstruction,
          generatedAt: now,
        });
        state = this.#stateAfterObservation(
          state,
          observation,
          world.currentSnapshot,
          event,
          now,
        );
        const task = SimulationAgentTaskV3Schema.parse({
          schemaVersion: SimulationAgentTaskV3SchemaVersion,
          agentTaskId: this.#idFactory("agent-task"),
          sessionId,
          sourceWorldEventId: event.eventId,
          eventType: event.eventType,
          affectedObjectRefs: event.affectedObjectRefs,
          dispatchPlanId: plan.dispatchPlanId,
          agentId: template.agentId,
          agentTemplateId: template.agentTemplateId,
          professionalRoleId: template.professionalRoleId,
          agentStateId: state.agentStateId,
          observationId: observation.observationId,
          expectedWorldStateVersion: world.currentSnapshot.stateVersion,
          taskInstructionHash: hashSimulationRuntimeValueV3(
            observation.taskInstruction,
          ),
          status: "pending",
          attempt: 1,
          createdAt: now,
          startedAt: null,
          completedAt: null,
          failureCode: null,
        });
        const executor = this.#executors.get(template.agentTemplateId)
          ?? (async () => {
            throw Object.assign(new Error("该智能体执行器尚未注册"), {
              code: "executor_missing",
            });
          });
        const outcome = await runSimulationAgentTaskV3({
          template,
          state,
          observation,
          task,
          executor,
          now: this.#now,
          monotonicNowMs: this.#monotonicNowMs,
          idFactory: this.#idFactory,
        });
        state = this.#stateAfterRun({
          state,
          event,
          task: outcome.task,
          runId: outcome.run.agentRunId,
          succeeded: outcome.run.status === "succeeded",
          updatedAt: outcome.run.completedAt,
        });
        const stateIndex = nextStates.findIndex(
          (candidate) => candidate.agentStateId === state.agentStateId,
        );
        if (stateIndex < 0) nextStates.push(state);
        else nextStates[stateIndex] = state;
        observations.push(observation);
        tasks.push(outcome.task);
        runs.push(outcome.run);
        if (outcome.intent !== null
          && outcome.effects !== null
          && outcome.publicSummary !== null
          && outcome.rationale !== null
          && outcome.run.outputHash !== null) {
          intents.push(outcome.intent);
          contributions.push({
            contributionId: this.#idFactory("contribution"),
            contributionKind: template.contributionKind,
            agentId: template.agentId,
            agentTemplateId: template.agentTemplateId,
            professionalRoleId: template.professionalRoleId,
            displayName: template.displayName,
            agentTaskId: outcome.task.agentTaskId,
            agentRunId: outcome.run.agentRunId,
            observationId: observation.observationId,
            intentId: outcome.intent.intentId,
            outputHash: outcome.run.outputHash,
            summary: outcome.publicSummary,
            rationale: outcome.rationale,
            evidenceRefs: outcome.evidenceRefs,
            riskLevel: outcome.intent.riskLevel,
            effects: outcome.effects,
          });
        }
      }

      const selectedSuggestion = [...contributions].sort((left, right) => {
        const leftTemplate = effectiveTemplates.find(
          (template) => template.agentTemplateId === left.agentTemplateId,
        )!;
        const rightTemplate = effectiveTemplates.find(
          (template) => template.agentTemplateId === right.agentTemplateId,
        )!;
        return Number(right.contributionKind === "professional_advisor")
          - Number(left.contributionKind === "professional_advisor")
          || rightTemplate.dispatchPriority - leftTemplate.dispatchPriority
          || left.contributionId.localeCompare(right.contributionId);
      })[0] ?? null;
      const failed = contributions.length === 0 || selectedSuggestion === null;
      const episode: SimulationPreparedEpisodeRecordV3 = {
        episodeId: this.#idFactory("collaboration-episode"),
        event: structuredClone(event),
        dispatchPlanId: plan.dispatchPlanId,
        selectedSuggestionContributionId:
          selectedSuggestion?.contributionId ?? null,
        studentDecision: null,
        resolutionProposalId: null,
        resolutionId: null,
        status: failed ? "failed" : "suggestion_ready",
        failureCode: failed
          ? plan.selectedCount === 0
            ? "no_applicable_agent"
            : "agent_execution_failed"
          : null,
        createdAt: now,
        updatedAt: this.#now(),
      };
      collaboration = this.#nextRecord(collaboration, {
        agentStates: nextStates,
        observations: [...collaboration.observations, ...observations],
        dispatchPlans: [...collaboration.dispatchPlans, plan],
        tasks: [...collaboration.tasks, ...tasks],
        runs: [...collaboration.runs, ...runs],
        intents: [...collaboration.intents, ...intents],
        contributions: [...collaboration.contributions, ...contributions],
        episodes: [...collaboration.episodes, episode],
      });
      await this.#save(collaboration.recordRevision - 1, collaboration);
      return this.#project(world, collaboration, episode);
    });
  }

  async getCurrentEpisode(sessionId: string): Promise<SimulationEpisodeViewsV3> {
    const world = await this.#engine.getRecord(sessionId);
    const collaboration = await this.#store.load(sessionId);
    if (!collaboration || collaboration.episodes.length === 0) {
      return this.#waitingViews(world);
    }
    const parsed = validateSimulationCollaborationRecordV3(collaboration);
    // Episodes are append-only in authoritative world-event sequence. Using a
    // timestamp/id sort here can resurrect an older episode when two events
    // share one logical clock tick (and lexical "...-10" ordering differs
    // from insertion order), which makes the learner decide an already
    // completed suggestion. The last validated record is the actual current
    // episode.
    const episode = parsed.episodes.at(-1)!;
    return this.#project(world, parsed, episode);
  }

  async recordStudentDecision(
    input: RecordSimulationStudentDecisionV3Input,
  ): Promise<SimulationEpisodeViewsV3> {
    return this.#serialized(input.sessionId, async () => {
      assertOperation(identifierPattern.test(input.decisionRef), "学生决定引用非法");
      assertOperation(input.rationale.trim().length > 0
        && input.rationale.trim().length <= 1_000, "学生决定理由必须为 1—1000 字");
      const world = await this.#engine.getRecord(input.sessionId);
      const collaboration = await this.#loadRequired(input.sessionId);
      const episode = collaboration.episodes.find(
        (candidate) => candidate.episodeId === input.episodeId,
      );
      assertOperation(episode !== undefined, "Episode 不存在");
      if (episode.studentDecision !== null) {
        const replay = episode.studentDecision.decisionRef === input.decisionRef
          && episode.studentDecision.decision === input.decision
          && episode.studentDecision.rationale === input.rationale.trim();
        assertOperation(replay, "学生决定引用已被不同内容占用");
        return this.#project(world, collaboration, episode);
      }
      assertOperation(episode.status === "suggestion_ready", "Episode 当前不可决策");
      let updated: SimulationPreparedEpisodeRecordV3 = {
        ...episode,
        studentDecision: {
          decisionRef: input.decisionRef,
          decision: input.decision,
          rationale: input.rationale.trim(),
          rationaleSource: "student_submitted",
          decidedAt: this.#now(),
        },
        status: "decided",
        updatedAt: this.#now(),
      };
      if (input.decision !== "accept") {
        const resolutionProposalId = this.#idFactory("resolution-proposal");
        const contributions = collaboration.contributions.filter(
          (contribution) => collaboration.tasks.some((task) => (
            task.agentTaskId === contribution.agentTaskId
              && task.sourceWorldEventId === episode.event.eventId
          )),
        );
        const resolution = await this.#engine.declineNextEvent({
          sessionId: input.sessionId,
          sourceWorldEventId: episode.event.eventId,
          dispatchPlanId: episode.dispatchPlanId,
          resolutionProposalId,
          expectedWorldStateVersion: world.currentSnapshot.stateVersion,
          skippedIntents: contributions.map((contribution) => ({
            intentId: contribution.intentId,
            reasonCode: input.decision === "request_evidence"
              ? "insufficient_evidence" as const
              : "not_necessary" as const,
          })),
        });
        updated = {
          ...updated,
          resolutionProposalId,
          resolutionId: resolution.resolutionId,
        };
      }
      const next = this.#nextRecord(collaboration, {
        episodes: collaboration.episodes.map((candidate) => (
          candidate.episodeId === updated.episodeId ? updated : candidate
        )),
      });
      await this.#save(collaboration.recordRevision, next);
      return this.#project(world, next, updated);
    });
  }

  async resolveAcceptedEpisode(
    sessionId: string,
    episodeId: string,
  ): Promise<SimulationEpisodeViewsV3> {
    return this.#serialized(sessionId, async () => {
      let collaboration = await this.#loadRequired(sessionId);
      let episode = collaboration.episodes.find(
        (candidate) => candidate.episodeId === episodeId,
      );
      assertOperation(episode !== undefined, "Episode 不存在");
      if (episode.status === "completed"
        || episode.status === "awaiting_gate"
        || episode.status === "failed") {
        return this.#project(
          await this.#engine.getRecord(sessionId),
          collaboration,
          episode,
        );
      }
      assertOperation(episode.status === "decided", "Episode 尚未形成学生决定");
      assertOperation(episode.studentDecision?.decision === "accept",
        "补证或拒绝决定必须保持零世界写回，需由后续学生动作继续推进");
      const selectedId = episode.selectedSuggestionContributionId;
      const contributions = collaboration.contributions.filter(
        (contribution) => contribution.agentTaskId
          && collaboration.tasks.some((task) => (
            task.agentTaskId === contribution.agentTaskId
              && task.sourceWorldEventId === episode!.event.eventId
          )),
      );
      const included = contributions.filter((contribution) => (
        contribution.contributionKind === "world_actor"
          || contribution.contributionId === selectedId
      ));
      assertOperation(included.length > 0, "接受决定没有可结算的真实智能体运行");
      const runs: SimulationIntentRunProposal[] = included.map((contribution) => {
        const intent = collaboration.intents.find(
          (candidate) => candidate.intentId === contribution.intentId,
        );
        assertOperation(intent !== undefined, "贡献意图引用不存在");
        return {
          intent,
          outputHash: contribution.outputHash,
          effects: structuredClone(contribution.effects),
        };
      });
      const resolutionProposalId = this.#idFactory("resolution-proposal");
      const sourceVersion = collaboration.dispatchPlans.find(
        (plan) => plan.dispatchPlanId === episode!.dispatchPlanId,
      )?.sourceWorldStateVersion;
      assertOperation(sourceVersion !== undefined, "Episode 派发计划不存在");
      const resolution = await this.#engine.resolveNextEvent({
        sessionId,
        dispatchPlanId: episode.dispatchPlanId,
        resolutionProposalId,
        expectedWorldStateVersion: sourceVersion,
        runs,
        consequenceSummary: this.#consequenceSummary(
          episode,
          included,
          await this.#engine.getRecord(sessionId),
        ),
        evidenceIds: uniqueStrings(included.flatMap(
          (contribution) => contribution.evidenceRefs,
        )),
      });
      episode = {
        ...episode,
        resolutionProposalId,
        resolutionId: resolution.resolutionId,
        status: resolution.status === "committed"
          ? "completed"
          : resolution.status === "pending_teacher_gate"
            ? "awaiting_gate"
            : "failed",
        failureCode: resolution.status === "failed"
          ? episodeFailureFromResolution(resolution)
          : resolution.status === "rejected"
            ? "teacher_rejected"
            : null,
        updatedAt: this.#now(),
      };
      collaboration = this.#nextRecord(collaboration, {
        episodes: collaboration.episodes.map((candidate) => (
          candidate.episodeId === episode!.episodeId ? episode! : candidate
        )),
      });
      await this.#save(collaboration.recordRevision - 1, collaboration);
      return this.#project(
        await this.#engine.getRecord(sessionId),
        collaboration,
        episode,
      );
    });
  }

  async decideTeacherGate(
    input: DecideSimulationEpisodeGateV3Input,
  ): Promise<SimulationEpisodeViewsV3> {
    return this.#serialized(input.sessionId, async () => {
      let collaboration = await this.#loadRequired(input.sessionId);
      let episode = collaboration.episodes.find(
        (candidate) => candidate.episodeId === input.episodeId,
      );
      assertOperation(episode !== undefined && episode.status === "awaiting_gate",
        "Episode 当前不在教师门等待态");
      assertOperation(episode.resolutionId !== null, "教师门缺少解析引用");
      const resolution = await this.#engine.decideTeacherGate({
        sessionId: input.sessionId,
        resolutionId: episode.resolutionId,
        decision: input.decision,
        teacherDecisionRef: input.teacherDecisionRef,
        revisionPolicy: input.revisionPolicy,
        revisedConsequenceSummary: input.revisedConsequenceSummary,
      });
      episode = {
        ...episode,
        status: resolution.status === "committed" ? "completed" : "failed",
        failureCode: resolution.status === "rejected" ? "teacher_rejected" : null,
        updatedAt: this.#now(),
      };
      collaboration = this.#nextRecord(collaboration, {
        episodes: collaboration.episodes.map((candidate) => (
          candidate.episodeId === episode!.episodeId ? episode! : candidate
        )),
      });
      await this.#save(collaboration.recordRevision - 1, collaboration);
      return this.#project(
        await this.#engine.getRecord(input.sessionId),
        collaboration,
        episode,
      );
    });
  }

  async getRecord(
    sessionId: string,
  ): Promise<SimulationCollaborationSessionRecordV3> {
    return this.#loadRequired(sessionId);
  }

  /**
   * Read-only nullable access for downstream evidence collectors. Unlike
   * `getRecord`, this does not manufacture an empty collaboration record and
   * therefore cannot turn "no agent episode happened" into synthetic proof.
   */
  async loadRecord(
    sessionId: string,
  ): Promise<SimulationCollaborationSessionRecordV3 | null> {
    const record = await this.#store.load(sessionId);
    return record === null
      ? null
      : validateSimulationCollaborationRecordV3(record);
  }

  #nextReadyEvent(world: SimulationSessionRecord): SimulationQueuedEvent | null {
    return world.queue
      .filter((event) => event.status === "queued")
      .filter((event) => event.notBeforeVirtualMinute
        <= world.currentSnapshot.virtualTime.elapsedMinutes)
      .sort((left, right) => left.sequence - right.sequence)[0] ?? null;
  }

  #stateFor(
    template: SimulationAgentTemplateV3,
    snapshot: WorldSnapshot,
    states: AgentState[],
    updatedAt: string,
  ): AgentState {
    const existing = states.find((state) => state.agentId === template.agentId);
    if (existing) {
      return AgentStateSchema.parse({
        ...existing,
        stateVersion: Math.max(existing.stateVersion + 1, snapshot.stateVersion),
        lastObservedWorldStateVersion: snapshot.stateVersion,
        updatedAt,
      });
    }
    return AgentStateSchema.parse({
      schemaVersion: AgentStateSchemaVersion,
      agentStateId: this.#idFactory("agent-state"),
      sessionId: snapshot.sessionId,
      simulationReleaseRef: snapshot.simulationReleaseRef,
      agentId: template.agentId,
      agentTemplateId: template.agentTemplateId,
      professionalRoleId: template.professionalRoleId,
      stateVersion: snapshot.stateVersion,
      visibility: "server_private",
      currentGoals: template.initialGoals.map((goal) => ({
        ...goal,
        status: "active" as const,
      })),
      beliefs: [],
      privateMemory: [],
      relationshipModel: [],
      activePlan: [],
      disclosurePolicyRef: template.disclosurePolicyRef,
      toolCapabilityRefs: template.toolCapabilityRefs,
      remainingActionBudget: template.initialActionBudget,
      lastObservedWorldStateVersion: snapshot.stateVersion,
      updatedAt,
    });
  }

  #observationFor(input: {
    state: AgentState;
    template: SimulationAgentTemplateV3;
    snapshot: WorldSnapshot;
    event: SimulationQueuedEvent;
    instruction: string;
    generatedAt: string;
  }): AgentObservation {
    const affectedKeys = new Set(input.event.affectedObjectRefs.map(referenceKey));
    const affectedEntityIds = new Set(
      input.event.affectedObjectRefs
        .filter((reference) => reference.objectType === "entity")
        .map((reference) => reference.objectId),
    );
    const visibleFacts = input.snapshot.facts
      .filter((fact) => fact.visibleScopes.some(
        (scope) => scope === "student" || scope === "teacher" || scope === "admin",
      ))
      .filter((fact) => affectedKeys.has(`fact:${fact.factId}`))
      .map((fact) => ({
        factRef: fact.factId,
        status: fact.status,
        confidence: fact.confidence,
      }));
    const visibleRelationships = input.snapshot.relationships
      .filter((relationship) => (
        affectedKeys.has(`relationship:${relationship.relationshipId}`)
          || affectedEntityIds.has(relationship.sourceEntityId)
          || affectedEntityIds.has(relationship.targetEntityId)
      ))
      .map((relationship) => ({
        relationshipRef: relationship.relationshipId,
        trustBand: trustBand(relationship.trust),
        tensionBand: trustBand(relationship.tension),
      }));
    const visibleObjects = input.event.affectedObjectRefs.filter((reference) => {
      if (reference.objectType === "entity") {
        return input.snapshot.entities.some((entity) => (
          entity.entityId === reference.objectId
            && entity.visibleScopes.some(
              (scope) => scope === "student" || scope === "teacher" || scope === "admin",
            )
        ));
      }
      if (reference.objectType === "world_variable") {
        return input.snapshot.variables.some((variable) => (
          variable.variableId === reference.objectId
            && variable.visibleScopes.some(
              (scope) => scope === "student" || scope === "teacher" || scope === "admin",
            )
        ));
      }
      return true;
    });
    return AgentObservationSchema.parse({
      schemaVersion: AgentObservationSchemaVersion,
      observationId: this.#idFactory("observation"),
      agentStateId: input.state.agentStateId,
      agentId: input.template.agentId,
      sessionId: input.snapshot.sessionId,
      worldStateVersion: input.snapshot.stateVersion,
      sourceWorldEventIds: [input.event.eventId],
      authorizedScopes: ["public_world", "assigned_task"],
      visibleObjects,
      visibleFacts,
      visibleRelationships,
      taskInstruction: input.instruction,
      contextHash: hashSimulationRuntimeValueV3({
        worldStateVersion: input.snapshot.stateVersion,
        sourceWorldEventIds: [input.event.eventId],
        visibleObjects,
        visibleFacts,
        visibleRelationships,
        taskInstruction: input.instruction,
      }),
      generatedAt: input.generatedAt,
    });
  }

  #stateAfterRun(input: {
    state: AgentState;
    event: SimulationQueuedEvent;
    task: { agentTaskId: string; status: string };
    runId: string;
    succeeded: boolean;
    updatedAt: string;
  }): AgentState {
    const memoryId = this.#idFactory("memory");
    return AgentStateSchema.parse({
      ...input.state,
      stateVersion: input.state.stateVersion + 1,
      privateMemory: [
        ...input.state.privateMemory,
        {
          memoryId,
          memoryKind: "episode",
          contentHash: hashSimulationRuntimeValueV3({
            eventId: input.event.eventId,
            taskId: input.task.agentTaskId,
            runId: input.runId,
            succeeded: input.succeeded,
          }),
          retention: "session",
        },
      ].slice(-64),
      activePlan: [{
        stepId: this.#idFactory("plan-step"),
        actionType: input.event.eventType,
        targetRefs: input.event.affectedObjectRefs,
        status: input.succeeded ? "done" : "blocked",
      }],
      remainingActionBudget: input.succeeded
        ? Math.max(0, input.state.remainingActionBudget - 1)
        : input.state.remainingActionBudget,
      updatedAt: input.updatedAt,
    });
  }

  #stateAfterObservation(
    state: AgentState,
    observation: AgentObservation,
    snapshot: WorldSnapshot,
    event: SimulationQueuedEvent,
    updatedAt: string,
  ): AgentState {
    const beliefs = new Map(state.beliefs.map((belief) => [belief.beliefId, belief]));
    for (const fact of observation.visibleFacts) {
      const beliefId = `belief-${state.agentId}-${fact.factRef}`.slice(0, 250);
      beliefs.set(beliefId, {
        beliefId,
        proposition: `世界事实 ${fact.factRef} 当前状态为 ${fact.status}。`,
        confidence: fact.confidence,
        evidenceRefs: [fact.factRef],
      });
    }
    const relationshipModel = observation.visibleRelationships.flatMap((visible) => {
      const relationship = snapshot.relationships.find(
        (candidate) => candidate.relationshipId === visible.relationshipRef,
      );
      if (!relationship) return [];
      return [{
        entityRef: relationship.targetEntityId,
        trust: relationship.trust,
        tension: relationship.tension,
        privateNotesHash: hashSimulationRuntimeValueV3({
          relationshipRef: relationship.relationshipId,
          trustBand: visible.trustBand,
          tensionBand: visible.tensionBand,
        }),
      }];
    });
    return AgentStateSchema.parse({
      ...state,
      stateVersion: state.stateVersion + 1,
      beliefs: [...beliefs.values()].slice(-48),
      relationshipModel: relationshipModel.slice(0, 32),
      activePlan: [{
        stepId: this.#idFactory("plan-step"),
        actionType: event.eventType,
        targetRefs: event.affectedObjectRefs,
        status: "planned",
      }],
      lastObservedWorldStateVersion: observation.worldStateVersion,
      updatedAt,
    });
  }

  #consequenceSummary(
    episode: SimulationPreparedEpisodeRecordV3,
    contributions: SimulationContributionRecordV3[],
    world: SimulationSessionRecord,
  ): string {
    const template = world.release.eventTemplates.find(
      (candidate) => candidate.eventTemplateId === episode.event.eventTemplateId,
    );
    const summaries = uniqueStrings(contributions.map(
      (contribution) => contribution.summary.trim(),
    ));
    return `${template?.title ?? "现场事件"}：${summaries.join("；")}`.slice(0, 1_000);
  }

  #triggerReceipt(
    world: SimulationSessionRecord,
    episode: SimulationPreparedEpisodeRecordV3,
  ) {
    const template = world.release.eventTemplates.find(
      (candidate) => candidate.eventTemplateId === episode.event.eventTemplateId,
    );
    assertOperation(template !== undefined, "Episode 事件模板不存在");
    return {
      eventId: episode.event.eventId,
      eventType: episode.event.eventType,
      title: template.title,
      occurredAt: episode.event.occurredAt,
      sourceKind: episode.event.sourceKind,
      affectedObjectRefs: uniqueStrings(
        episode.event.affectedObjectRefs.map((reference) => reference.objectId),
      ),
      evidenceRefs: [] as string[],
    };
  }

  #resolutionFor(
    world: SimulationSessionRecord,
    episode: SimulationPreparedEpisodeRecordV3,
  ): SimulationResolution | null {
    return episode.resolutionId === null
      ? null
      : world.resolutions.find(
        (resolution) => resolution.resolutionId === episode.resolutionId,
      ) ?? null;
  }

  #gateReceipt(resolution: SimulationResolution | null) {
    if (!resolution?.teacherGate) return null;
    const reviewed = resolution.teacherGate.status !== "pending";
    return {
      gateId: resolution.teacherGate.gateId,
      status: resolution.teacherGate.status,
      teacherDecisionRef: resolution.teacherGate.teacherDecisionRef,
      safeSummary: reviewed
        ? "教师已完成高风险业务门审查，结果已按决定处理。"
        : "该业务后果正在等待教师审查，当前保持零权威写回。",
      reviewedAt: reviewed ? resolution.resolvedAt : null,
    };
  }

  #consequenceReceipt(
    world: SimulationSessionRecord,
    resolution: SimulationResolution | null,
  ) {
    if (!resolution || resolution.status !== "committed") return null;
    const consequence = world.consequences.find(
      (candidate) => candidate.resolutionId === resolution.resolutionId,
    );
    assertOperation(consequence !== undefined, "正式解析缺少世界后果记录");
    return {
      resolutionId: resolution.resolutionId,
      status: "committed" as const,
      publicSummary: consequence.publicSummary,
      worldEventIds: resolution.emittedWorldEventIds,
      evidenceIds: resolution.emittedEvidenceIds,
      resultingStateVersion: consequence.resultingStateVersion,
    };
  }

  #project(
    world: SimulationSessionRecord,
    collaboration: SimulationCollaborationSessionRecordV3,
    episode: SimulationPreparedEpisodeRecordV3,
  ): SimulationEpisodeViewsV3 {
    const plan = collaboration.dispatchPlans.find(
      (candidate) => candidate.dispatchPlanId === episode.dispatchPlanId,
    );
    assertOperation(plan !== undefined, "Episode 派发计划不存在");
    const taskIds = new Set(
      collaboration.tasks
        .filter((task) => task.sourceWorldEventId === episode.event.eventId)
        .map((task) => task.agentTaskId),
    );
    const contributions = collaboration.contributions.filter(
      (contribution) => taskIds.has(contribution.agentTaskId),
    );
    const selected = episode.selectedSuggestionContributionId === null
      ? null
      : contributions.find((contribution) => (
        contribution.contributionId === episode.selectedSuggestionContributionId
      )) ?? null;
    const resolution = this.#resolutionFor(world, episode);
    const trigger = this.#triggerReceipt(world, episode);
    const gate = this.#gateReceipt(resolution);
    const consequence = this.#consequenceReceipt(world, resolution);
    const shared = {
      schemaVersion: "agent-collaboration-episode/3.0.0" as const,
      episodeId: episode.episodeId,
      sessionId: collaboration.sessionId,
      scenarioId: world.release.scenarioReleaseRef.scenarioId,
      courseReleaseRef: world.release.courseReleaseRef,
      simulationReleaseRef: world.release.simulationReleaseRef,
      sourceWorldStateVersion: plan.sourceWorldStateVersion,
      generatedAt: episode.updatedAt,
    };
    const decision = episode.studentDecision
      ? {
          ...structuredClone(episode.studentDecision),
          rationaleSource: episode.studentDecision.rationaleSource ?? "legacy_unspecified" as const,
        }
      : null;
    const studentFailureCode = episode.failureCode === "teacher_rejected"
      ? "resolution_failed"
      : episode.failureCode;
    const student = StudentAgentCollaborationEpisodeV3Schema.parse({
      ...shared,
      audience: "student",
      status: episode.status === "suggestion_ready"
        ? "suggestion_ready"
        : episode.status === "completed"
          ? "completed"
          : episode.status === "failed"
            ? "failed"
            : "decided",
      triggerEvent: {
        eventId: trigger.eventId,
        eventType: trigger.eventType,
        title: trigger.title,
        occurredAt: trigger.occurredAt,
        sourceKind: trigger.sourceKind,
      },
      suggestion: selected ? {
        suggestionId: `suggestion-${selected.contributionId}`,
        sourceContributionId: selected.contributionId,
        provenanceVerified: true,
        professionalRole: selected.professionalRoleId,
        displayName: selected.displayName,
        summary: selected.summary,
        rationale: selected.rationale,
        evidenceRefs: selected.evidenceRefs,
        riskLevel: selected.riskLevel,
        allowedDecisions: ["accept", "request_evidence", "reject"],
      } : null,
      studentDecision: decision,
      teacherGate: gate,
      consequence,
      failure: episode.status === "failed" ? {
        code: studentFailureCode ?? "resolution_failed",
        safeMessage: resolution?.failure?.safeMessage
          ?? (episode.failureCode === "teacher_rejected"
            ? "教师未批准该高风险后果，世界保持未写入状态。"
            : "本次智能体协作未能形成安全结果，世界保持未写入状态。"),
      } : null,
    });
    const businessStatus = episode.status === "suggestion_ready"
      || episode.status === "decided"
      ? "in_progress"
      : episode.status === "awaiting_gate"
        ? "awaiting_gate"
        : episode.status;
    const businessContributions = contributions.map((contribution) => ({
      contributionId: contribution.contributionId,
      agentId: contribution.agentId,
      professionalRoleId: contribution.professionalRoleId,
      agentTaskId: contribution.agentTaskId,
      agentRunId: contribution.agentRunId,
      observationId: contribution.observationId,
      intentId: contribution.intentId,
      outputHash: contribution.outputHash,
      summary: contribution.summary,
      rationale: contribution.rationale,
      evidenceRefs: contribution.evidenceRefs,
      riskLevel: contribution.riskLevel,
      status: decision?.decision === "reject"
        && contribution.contributionId === episode.selectedSuggestionContributionId
        ? "rejected" as const
        : "ready" as const,
    }));
    const business = {
      ...shared,
      status: businessStatus,
      triggerEvent: trigger,
      dispatchPlan: {
        dispatchPlanId: plan.dispatchPlanId,
        decisions: plan.decisions,
        selectedCount: plan.selectedCount,
        skippedCount: plan.skippedCount,
      },
      contributions: businessContributions,
      studentDecision: decision,
      teacherGate: gate,
      resolutionProposalId: episode.resolutionProposalId,
      consequence,
      failureCode: episode.failureCode,
    };
    const teacher = TeacherAgentCollaborationEpisodeV3Schema.parse({
      ...business,
      audience: "teacher",
    });
    const episodeRuns = collaboration.runs.filter((run) => taskIds.has(run.agentTaskId));
    const successfulRuns = episodeRuns.filter((run) => run.status === "succeeded");
    const allLive = successfulRuns.length > 0
      && successfulRuns.length === episodeRuns.length
      && successfulRuns.every((run) => run.executionMode === "live");
    const allDeterministic = successfulRuns.length > 0
      && successfulRuns.length === episodeRuns.length
      && successfulRuns.every((run) => run.executionMode === "deterministic_demo");
    const executionMode = allLive
      ? "live" as const
      : allDeterministic
        ? "deterministic_demo" as const
        : "degraded" as const;
    const firstLive = successfulRuns.find((run) => run.executionMode === "live");
    const admin = AdminAgentCollaborationEpisodeV3Schema.parse({
      ...business,
      audience: "admin",
      execution: {
        executionMode,
        providerId: executionMode === "live" ? firstLive?.providerId ?? null : null,
        modelId: executionMode === "live" ? firstLive?.modelId ?? null : null,
        traceRefs: uniqueStrings(episodeRuns.flatMap(
          (run) => run.traceRef ? [run.traceRef] : [],
        )),
        promptTemplateRefs: uniqueStrings(episodeRuns.flatMap(
          (run) => run.promptTemplateRef ? [run.promptTemplateRef] : [],
        )),
        failedAgentIds: uniqueStrings(episodeRuns
          .filter((run) => run.status === "failed")
          .map((run) => run.agentId)),
        totalLatencyMs: episodeRuns.reduce((sum, run) => sum + run.latencyMs, 0),
        estimatedCostMicrounits: episodeRuns.reduce(
          (sum, run) => sum + run.estimatedCostMicrounits,
          0,
        ),
        recoveryActions: episodeRuns.some((run) => run.status === "failed")
          ? ["失败智能体未参与世界结算；可在管理员端重试或继续确定性降级。"]
          : [],
      },
    });
    return { student, teacher, admin };
  }

  #waitingViews(world: SimulationSessionRecord): SimulationEpisodeViewsV3 {
    const shared = {
      schemaVersion: "agent-collaboration-episode/3.0.0" as const,
      episodeId: `waiting-${world.sessionId}`,
      sessionId: world.sessionId,
      scenarioId: world.release.scenarioReleaseRef.scenarioId,
      courseReleaseRef: world.release.courseReleaseRef,
      simulationReleaseRef: world.release.simulationReleaseRef,
      sourceWorldStateVersion: world.currentSnapshot.stateVersion,
      generatedAt: this.#now(),
    };
    return {
      student: StudentAgentCollaborationEpisodeV3Schema.parse({
        ...shared,
        audience: "student",
        status: "waiting",
        triggerEvent: null,
        suggestion: null,
        studentDecision: null,
        teacherGate: null,
        consequence: null,
        failure: null,
      }),
      teacher: TeacherAgentCollaborationEpisodeV3Schema.parse({
        ...shared,
        audience: "teacher",
        status: "waiting",
        triggerEvent: null,
        dispatchPlan: null,
        contributions: [],
        studentDecision: null,
        teacherGate: null,
        resolutionProposalId: null,
        consequence: null,
        failureCode: null,
      }),
      admin: AdminAgentCollaborationEpisodeV3Schema.parse({
        ...shared,
        audience: "admin",
        status: "waiting",
        triggerEvent: null,
        dispatchPlan: null,
        contributions: [],
        studentDecision: null,
        teacherGate: null,
        resolutionProposalId: null,
        consequence: null,
        failureCode: null,
        execution: {
          executionMode: "deterministic_demo",
          providerId: null,
          modelId: null,
          traceRefs: [],
          promptTemplateRefs: [],
          failedAgentIds: [],
          totalLatencyMs: 0,
          estimatedCostMicrounits: 0,
          recoveryActions: [],
        },
      }),
    };
  }

  async #loadOrCreate(
    world: SimulationSessionRecord,
  ): Promise<SimulationCollaborationSessionRecordV3> {
    const existing = await this.#store.load(world.sessionId);
    if (existing) {
      assertOperation(existing.simulationReleaseRef.contentHash
        === world.release.simulationReleaseRef.contentHash
        && existing.simulationReleaseRef.releaseId
          === world.release.simulationReleaseRef.releaseId,
      "协作记录与世界发布版漂移");
      return validateSimulationCollaborationRecordV3(existing);
    }
    const now = this.#now();
    const created = validateSimulationCollaborationRecordV3({
      recordVersion: SimulationCollaborationRecordV3Version,
      recordRevision: 0,
      sessionId: world.sessionId,
      simulationReleaseRef: world.release.simulationReleaseRef,
      agentStates: [],
      observations: [],
      dispatchPlans: [],
      tasks: [],
      runs: [],
      intents: [],
      contributions: [],
      episodes: [],
      createdAt: now,
      updatedAt: now,
    });
    await this.#store.create(created);
    return created;
  }

  async #loadRequired(
    sessionId: string,
  ): Promise<SimulationCollaborationSessionRecordV3> {
    const record = await this.#store.load(sessionId);
    assertOperation(record !== null, `协作会话不存在：${sessionId}`);
    return validateSimulationCollaborationRecordV3(record);
  }

  #nextRecord(
    record: SimulationCollaborationSessionRecordV3,
    changes: Partial<SimulationCollaborationSessionRecordV3>,
  ): SimulationCollaborationSessionRecordV3 {
    return validateSimulationCollaborationRecordV3({
      ...record,
      ...changes,
      recordVersion: SimulationCollaborationRecordV3Version,
      recordRevision: record.recordRevision + 1,
      sessionId: record.sessionId,
      updatedAt: this.#now(),
    });
  }

  async #save(
    expectedRevision: number,
    record: SimulationCollaborationSessionRecordV3,
  ): Promise<void> {
    await this.#store.compareAndSet(
      record.sessionId,
      expectedRevision,
      record,
    );
  }

  async #serialized<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.#locks.set(sessionId, chained);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.#locks.get(sessionId) === chained) this.#locks.delete(sessionId);
    }
  }
}
