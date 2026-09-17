import { describe, expect, it } from "vitest";
import {
  ActionEnvelopeSchema,
  ActionEnvelopeSchemaVersion,
  AgentArchitectureProfileSchema,
  AgentTaskSchema,
  CandidateEventSchema,
  CommandSchema,
  DeadLetterRecordSchema,
  DispatchAttemptSchema,
  ExperimentObservationRefSchema,
  ExecutableAgentIntentSchema,
  LearningCandidateSchema,
  ModelInvocationRequestSchema,
  ModelInvocationTraceSchema,
  OperationsHealthSchemaVersion,
  OperationsHealthSnapshotSchema,
  OutboxRecordSchema,
  PrincipalSchema,
  RecoveryCheckpointObservationSchema,
  RecoveryCheckpointSchemaVersion,
  RoleContractSchema,
  RoleBindingSchema,
  ScenarioCourseGuideSchema,
  SceneDirectorDecisionSchema,
  SchemaVersion,
  SessionControlOverviewSchema,
  SessionControlSchemaVersion,
  SessionTracePageSchema,
  SessionTracePageSchemaVersion,
  StudentScenarioCourseGuideSchema,
  TeachingDirectiveSchema,
  TrainingSessionSummarySchema,
} from "../src/index.js";

describe("shared contracts", () => {
  it("accepts a versioned command with optimistic concurrency", () => {
    const parsed = CommandSchema.parse({
      kind: "Command",
      sessionId: "demo-session",
      sceneId: "local-culture-report",
      actorId: "student-editor-001",
      messageId: "msg-001",
      correlationId: "corr-001",
      timestamp: "2026-07-22T06:35:00.000Z",
      schemaVersion: SchemaVersion,
      name: "inspect_material",
      expectedStateVersion: 4,
      payload: { materialId: "material-photo-001" },
    });

    expect(parsed.expectedStateVersion).toBe(4);
  });

  it("binds both student surfaces to one versioned world command without duplicating payload state", () => {
    const command = CommandSchema.parse({
      kind: "Command",
      sessionId: "demo-session",
      sceneId: "local-culture-report",
      actorId: "student-editor-001",
      messageId: "msg-action-001",
      correlationId: "corr-action-001",
      timestamp: "2026-07-29T01:00:00.000Z",
      schemaVersion: SchemaVersion,
      name: "inspect_material",
      expectedStateVersion: 7,
      payload: { materialId: "material-photo-001" },
    });
    const envelope = ActionEnvelopeSchema.parse({
      kind: "ActionEnvelope",
      envelopeVersion: ActionEnvelopeSchemaVersion,
      actionId: "action-001",
      idempotencyKey: "action-001",
      payloadHash: "a".repeat(64),
      source: {
        mode: "world_interaction",
        assertion: "client_declared",
        surfaceId: "student-world",
        interactionId: "hotspot-material-001",
      },
      actor: {
        principalId: "principal-student-001",
        bindingId: "binding-student-editor-001",
        actorId: command.actorId,
        actorKind: "student",
        roleId: "responsible_editor",
        teamId: "team-editorial-01",
        sessionEpoch: "session-epoch-001",
      },
      objectRefs: [{
        objectType: "world_state",
        objectId: command.sessionId,
        version: "7",
      }],
      causality: {
        rootActionId: "action-001",
        causationId: "hotspot-material-001",
        parentActionId: null,
        causationEventIds: [],
        causalDepth: 0,
      },
      evidence: {
        evidenceRefs: [],
        citationRefs: [],
        toolResultRefs: [],
      },
      command,
    });

    expect(envelope.command).toEqual(command);
    expect(envelope.source.mode).toBe("world_interaction");
    expect(() => ActionEnvelopeSchema.parse({
      ...envelope,
      objectRefs: [{
        objectType: "world_state",
        objectId: command.sessionId,
        version: "6",
      }],
    })).toThrow(/对象版本/u);
  });

  it("keeps ablation metadata audit-only and rejects contradictory template filters", () => {
    expect(() => AgentArchitectureProfileSchema.parse({
      profileId: "architecture-private-view",
      profileVersion: "1.0.0",
      policyHash: "b".repeat(64),
      enabledTemplateIds: ["template:agent-fact-checker"],
      disabledTemplateIds: ["template:agent-fact-checker"],
    })).toThrow(/同时启用和停用/u);
    expect(() => ExperimentObservationRefSchema.parse({
      schemaVersion: "experiment-observation/1.0.0",
      experimentId: "ablation-001",
      condition: "private_view_event_group",
      runBatchId: "batch-001",
      caseId: "case-001",
      repetition: 1,
      controlVariablesHash: "c".repeat(64),
      labels: ["gold-path", "seed-01"],
    })).toThrow();
  });

  it("keeps role permissions structural rather than prompt-only", () => {
    const role = RoleContractSchema.parse({
      agentId: "student-editor-001",
      actorKind: "student",
      roleId: "responsible_editor",
      displayName: "责任编辑",
      purpose: "在证据充分时作出发布决定",
      teamId: "team-editorial-01",
      visibleScopes: ["public_world", "assigned_team", "role_private"],
      privateScopes: ["editorial_notes"],
      allowedIntents: ["inspect_material", "submit_for_review"],
      deniedActions: ["mutate_world_state", "read_other_private_memory"],
      toolPolicy: ["rag_search", "material_preview"],
      tokenBudget: 1800,
    });

    expect(role.deniedActions).toContain("mutate_world_state");
  });

  it("separates the full teacher course guide from the student-safe role view", () => {
    const roleBrief = {
      roleId: "responsible_editor" as const,
      mission: "形成可追溯的待发版本。",
      responsibilities: ["维护事实与素材版本"],
      collaborationRoleIds: ["reporter" as const],
      primaryNodeIds: ["brief"],
      deliverableTemplateIds: ["article-main"],
      successSignals: ["结论能够回指证据"],
      decisionBoundaries: ["不得越过教师门"],
    };
    const fullGuide = ScenarioCourseGuideSchema.parse({
      contentVersion: "1.0.0",
      finalDeliverable: "完成融媒体主稿与渠道版本。",
      learningObjectives: [{
        objectiveId: "objective-1",
        label: "证据核验",
        competencyId: "C-1",
        description: "区分观察与事实。",
        evidenceKinds: ["世界事实"],
      }],
      roleBriefs: [roleBrief],
      nodeGuides: [{
        nodeId: "brief",
        situation: "首发窗口临近。",
        studentGoal: "明确岗位分工。",
        requiredOutputs: ["任务清单"],
        requiredMaterialIds: ["material-1"],
        suggestedArtifactTemplateIds: ["article-main"],
        decisionQuestions: ["哪些事实仍待核验？"],
        teacherFocus: ["观察学生是否守住岗位边界"],
      }],
      debrief: {
        completionChecklist: ["证据已经关联"],
        reflectionPrompts: ["哪项判断最关键？"],
        transferPrompt: "迁移到下一项报道。",
      },
    });
    const studentGuide = StudentScenarioCourseGuideSchema.parse({
      contentVersion: fullGuide.contentVersion,
      finalDeliverable: fullGuide.finalDeliverable,
      learningObjectives: fullGuide.learningObjectives,
      activeRoleBrief: roleBrief,
      currentNodeGuide: {
        nodeId: "brief",
        situation: "首发窗口临近。",
        studentGoal: "明确岗位分工。",
        requiredOutputs: ["任务清单"],
        requiredMaterialIds: ["material-1"],
        suggestedArtifactTemplateIds: ["article-main"],
        decisionQuestions: ["哪些事实仍待核验？"],
      },
      debrief: fullGuide.debrief,
    });

    expect(studentGuide.activeRoleBrief?.roleId).toBe("responsible_editor");
    expect(() => StudentScenarioCourseGuideSchema.parse({
      ...studentGuide,
      currentNodeGuide: {
        ...studentGuide.currentNodeGuide!,
        teacherFocus: ["不应下发给学生"],
      },
    })).toThrow();
  });

  it("rejects learning content that bypasses review", () => {
    expect(() => LearningCandidateSchema.parse({
      candidateId: "learning-001",
      candidateType: "rule",
      status: "published",
      title: "新的客流核验规则",
      proposedContent: { rule: "必须进行二次交叉核验" },
      sourceEvidenceRefs: ["evidence-001"],
      createdAt: "2026-07-22T06:35:00.000Z",
    })).toThrow();
  });

  it("requires executable agent intents to carry version, references and review risk", () => {
    const intent = ExecutableAgentIntentSchema.parse({
      kind: "AgentIntent",
      sessionId: "demo-session",
      sceneId: "local-culture-report",
      actorId: "agent-fact-checker",
      messageId: "msg-agent-001",
      correlationId: "corr-agent-001",
      timestamp: "2026-07-24T08:00:00.000Z",
      schemaVersion: SchemaVersion,
      intentId: "intent-001",
      agentRunId: "run-001",
      roleId: "fact_checker",
      intentType: "propose_data_correction",
      rationaleSummary: "两个授权来源支持更正客流口径。",
      proposedPayload: { value: 12600 },
      expectedStateVersion: 12,
      causationEventIds: ["event-001"],
      evidenceRefs: ["evidence-001"],
      citationRefs: ["course-source-verification"],
      toolResultRefs: [],
      confidence: 0.91,
      riskLevel: "medium",
      requiresTeacherReview: true,
      visibility: ["teacher_only", "audit_only"],
      visibleToActorIds: [],
      idempotencyKey: "demo-session:12:agent-fact-checker:propose_data_correction",
      expiresAt: null,
    });

    expect(intent.expectedStateVersion).toBe(12);
    expect(intent.requiresTeacherReview).toBe(true);
  });

  it("requires scheduled agent tasks to identify their committed trigger and idempotency boundary", () => {
    const task = AgentTaskSchema.parse({
      taskId: "task-001",
      outboxId: "outbox-001",
      subscriptionId: "fact-checker/material-observed/v1",
      agentId: "agent-fact-checker",
      roleId: "fact_checker",
      templateRef: {
        templateId: "template:agent-fact-checker",
        templateVersion: "fact-checker/1.2.0",
      },
      instanceRef: {
        instanceId: "demo-session:session-epoch-001:agent-fact-checker",
        instanceVersion: "fact-checker/1.2.0",
      },
      instanceContext: {
        bindingKind: "teacher_assistant",
        bindingId: "role-binding:course-001:fact_checker:agent-fact-checker",
        actorId: "agent-fact-checker",
        actorKind: "agent",
        courseId: "course-001",
        teamId: "team-editorial-01",
        privateMemoryNamespaceRef:
          "session:demo-session/epoch:session-epoch-001/team:team-editorial-01/actor:agent-fact-checker",
        configHash: "d".repeat(64),
        lifecycle: "active",
      },
      definitionVersion: "fact-checker/1.2.0",
      promptVersion: "1.2.0",
      sessionId: "demo-session",
      sessionEpoch: "session-epoch-001",
      sceneId: "local-culture-report",
      triggerEventId: "event-material-observed",
      triggerEventType: "material_observed",
      expectedStateVersion: 14,
      priority: 100,
      correlationId: "corr-001",
      causalDepth: 1,
      actionContext: null,
      experimentObservation: null,
      dispatchDecision: {
        decisionId: "dispatch-decision-001",
        affected: true,
        decision: "selected",
        reason: "selected",
        selectedOrder: 0,
        budget: {
          limit: 4,
          affected: 1,
          selected: 1,
          filtered: 0,
          consumed: 1,
          remaining: 3,
          exhausted: false,
        },
      },
      idempotencyKey: "demo-session:event-material-observed:fact-checker/material-observed/v1",
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      availableAt: "2026-07-24T08:00:00.000Z",
      lease: null,
      lastErrorCode: null,
      createdAt: "2026-07-24T08:00:00.000Z",
      updatedAt: "2026-07-24T08:00:00.000Z",
      completedAt: null,
    });

    expect(task.triggerEventType).toBe("material_observed");
    expect(task.status).toBe("queued");
    expect(task.templateRef).toEqual({
      templateId: "template:agent-fact-checker",
      templateVersion: "fact-checker/1.2.0",
    });
    expect(task.instanceRef.instanceId).toBe(
      "demo-session:session-epoch-001:agent-fact-checker",
    );
    expect(task.dispatchDecision).toMatchObject({
      decision: "selected",
      reason: "selected",
    });

    const legacyTask = AgentTaskSchema.parse({
      ...task,
      templateRef: undefined,
      instanceRef: undefined,
      instanceContext: undefined,
      dispatchDecision: undefined,
    });
    expect(legacyTask.dispatchDecision).toEqual({
      decisionId: "legacy-unobserved:task-001",
      affected: null,
      decision: "unobserved",
      reason: "legacy_unobserved",
      selectedOrder: null,
      budget: null,
    });
  });

  it("keeps the classroom, team and training-session control DTO strict and versioned", () => {
    const session = TrainingSessionSummarySchema.parse({
      schemaVersion: SessionControlSchemaVersion,
      sessionId: "session-class-a",
      classroomId: "classroom-a",
      teamId: "team-a",
      releaseId: "release-local-tourism",
      status: "active",
      statusVersion: 1,
      requestedBy: "principal-teacher-a",
      createdAt: "2026-07-26T08:00:00.000Z",
      updatedAt: "2026-07-26T08:00:01.000Z",
      activatedAt: "2026-07-26T08:00:01.000Z",
      completedAt: null,
      lastRecoveryErrorCode: null,
    });
    const overview = SessionControlOverviewSchema.parse({
      schemaVersion: SessionControlSchemaVersion,
      classrooms: [{
        classroomId: "classroom-a",
        courseId: "course-local-tourism-media",
        name: "地方文旅融媒体 A 班",
        status: "active",
      }],
      teams: [{
        teamId: "team-a",
        classroomId: "classroom-a",
        name: "A 班采编组",
        status: "active",
      }],
      sessions: [session],
    });

    expect(overview.sessions[0]?.classroomId).toBe("classroom-a");
    expect(() => TrainingSessionSummarySchema.parse({
      ...session,
      untrustedInternalField: "must-not-cross-api",
    })).toThrow();
  });

  it("keeps the operations health snapshot count-only, strict and versioned", () => {
    const health = {
      schemaVersion: OperationsHealthSchemaVersion,
      generatedAt: "2026-07-26T12:00:00.000Z",
      productVersion: "0.9.2",
      scope: {
        visibleSessionCount: 2,
      },
      sessions: {
        total: 2,
        statuses: {
          provisioning: 0,
          active: 1,
          paused: 0,
          completed: 0,
          recovery_failed: 1,
        },
        recoveryFailed: 1,
      },
      outbox: {
        pending: 3,
        delivered: 8,
      },
      agentTasks: {
        pending: 2,
        running: 1,
        completed: 5,
        failed: 1,
        deadLettered: 1,
      },
      mediaWorkItems: {
        queued: 1,
        running: 1,
        completed: 4,
        failed: 0,
      },
      oldestPendingAt: {
        overall: "2026-07-26T08:00:00.000Z",
        outbox: "2026-07-26T09:00:00.000Z",
        agentTasks: "2026-07-26T08:00:00.000Z",
        mediaWorkItems: null,
      },
      recoveryCheckpoints: {
        total: 2,
        missing: 0,
        verified: 1,
        stale: 1,
        mismatch: 0,
        latestVerifiedAt: "2026-07-26T11:59:00.000Z",
      },
    } as const;

    expect(OperationsHealthSnapshotSchema.parse(health).sessions.recoveryFailed)
      .toBe(1);
    expect(() => OperationsHealthSnapshotSchema.parse({
      ...health,
      privateMemory: "must-not-cross-api",
    })).toThrow();
    expect(() => OperationsHealthSnapshotSchema.parse({
      ...health,
      sessions: {
        ...health.sessions,
        statuses: {
          ...health.sessions.statuses,
          unknown: 1,
        },
      },
    })).toThrow();
  });

  it("keeps recovery checkpoint observations strict and hash-only", () => {
    const observation = RecoveryCheckpointObservationSchema.parse({
      schemaVersion: RecoveryCheckpointSchemaVersion,
      status: "verified",
      sessionId: "session-a",
      checkedAt: "2026-07-26T12:00:00.000Z",
      checkpointCreatedAt: "2026-07-26T11:59:00.000Z",
      sourceRevision: 2,
      sourceSequence: 8,
      worldStateVersion: 31,
      payloadHash: "a".repeat(64),
      checkpointPayloadHash: "a".repeat(64),
    });

    expect(observation.status).toBe("verified");
    expect(() => RecoveryCheckpointObservationSchema.parse({
      ...observation,
      payload: { privateMemory: "must-not-cross-api" },
    })).toThrow();
  });

  it("keeps session trace pages bounded, strict and versioned", () => {
    const page = {
      schemaVersion: SessionTracePageSchemaVersion,
      sessionId: "session-class-a",
      generatedAt: "2026-07-26T12:00:00.000Z",
      stateVersion: 17,
      records: [],
      links: [],
      nextCursor: "eyJ2IjoxLCJzIjoic2Vzc2lvbi1jbGFzcy1hIn0",
      hasMore: true,
      watermark: "trace-watermark.v1.0123456789abcdef",
    } as const;

    expect(SessionTracePageSchema.parse(page).hasMore).toBe(true);
    expect(SessionTracePageSchema.parse({
      ...page,
      nextCursor: null,
      hasMore: false,
    }).nextCursor).toBeNull();
    expect(() => SessionTracePageSchema.parse({
      ...page,
      rawPrompt: "must-not-cross-api",
    })).toThrow();
    expect(() => SessionTracePageSchema.parse({
      ...page,
      schemaVersion: "session-trace-page.v0",
    })).toThrow();
  });

  it("keeps trusted principals, role bindings, outbox and recovery records structural", () => {
    const createdAt = "2026-07-25T02:00:00.000Z";
    const principal = PrincipalSchema.parse({
      principalId: "principal-demo-operator",
      kind: "human",
      displayName: "本地演示操作者",
      status: "active",
      createdAt,
    });
    const binding = RoleBindingSchema.parse({
      bindingId: "binding-teacher",
      principalId: principal.principalId,
      sessionId: "demo-session",
      actorId: "teacher-main",
      actorKind: "teacher",
      roleId: "teacher",
      status: "active",
      createdAt,
      expiresAt: null,
    });
    const outbox = OutboxRecordSchema.parse({
      outboxId: "outbox-001",
      sessionId: "demo-session",
      sessionEpoch: "session-epoch-001",
      sceneId: "local-culture-report",
      eventId: "event-001",
      eventType: "material_observed",
      stateVersion: 14,
      correlationId: "corr-001",
      topic: "world_event",
      causalDepth: 1,
      status: "pending",
      attempts: 0,
      availableAt: createdAt,
      createdAt,
      deliveredAt: null,
      lastErrorCode: null,
    });
    const attempt = DispatchAttemptSchema.parse({
      attemptId: "attempt-001",
      taskId: "task-001",
      sessionId: "demo-session",
      attemptNumber: 3,
      workerId: "worker-001",
      startedAt: createdAt,
      completedAt: createdAt,
      outcome: "dead_lettered",
      errorCode: "runtime_failed",
    });
    const deadLetter = DeadLetterRecordSchema.parse({
      deadLetterId: "dead-letter-001",
      taskId: attempt.taskId,
      sessionId: attempt.sessionId,
      idempotencyKey: "demo-session:event-001:subscription-001",
      reasonCode: "runtime_failed",
      attempts: attempt.attemptNumber,
      createdAt,
    });

    expect(binding.actorId).toBe("teacher-main");
    expect(outbox.status).toBe("pending");
    expect(deadLetter.attempts).toBe(3);
  });

  it("validates provider-neutral model requests without embedding credentials", () => {
    const modelRequest = ModelInvocationRequestSchema.parse({
      invocationId: "model-call-001",
      profileId: "deepseek-test",
      taskKind: "fact_checker",
      systemPrompt: "只返回 JSON。",
      userPrompt: "核验授权来源。",
      outputContractId: "fact-checker-output/v1",
      outputMode: "json_object",
      temperature: 0,
      maxOutputTokens: 512,
      timeoutMs: 20_000,
    });

    expect(modelRequest.profileId).toBe("deepseek-test");
    expect(modelRequest).not.toHaveProperty("apiKey");
  });

  it("keeps sanitized provider telemetry in the agent trace contract", () => {
    const trace = ModelInvocationTraceSchema.parse({
      invocationId: "model-call-001",
      profileId: "deepseek-test",
      provider: "deepseek",
      mode: "live",
      model: "deepseek-v4-flash",
      requestId: "provider-request-001",
      status: "completed",
      outputMode: "json_object",
      finishReason: "stop",
      tokenUsage: { input: 120, output: 48, total: 168 },
      latencyMs: 420,
      attempts: 1,
      estimatedCostUsd: null,
      errorCode: null,
      startedAt: "2026-07-25T01:00:00.000Z",
      completedAt: "2026-07-25T01:00:00.420Z",
    });

    expect(trace.provider).toBe("deepseek");
    expect(trace.tokenUsage.total).toBe(168);
  });

  it("makes director candidates, teaching directives and no_op decisions first-class audit records", () => {
    const at = "2026-07-25T08:00:00.000Z";
    const directive = TeachingDirectiveSchema.parse({
      directiveId: "directive-001",
      strategy: "scaffold",
      reasonCode: "evidence_gap",
      rationaleSummary: "当前证据不足，只提供任务支架。",
      targetCompetency: "C-FACT-01",
      recommendedDifficulty: "supportive",
      targetRoleIds: ["responsible_editor", "reporter"],
      triggerEventIds: ["event-node-001"],
      evidenceRefs: [],
      confidence: 1,
      handoffToSceneDirector: true,
      proposedBy: "agent-teaching",
      proposedAt: at,
    });
    const noOp = SceneDirectorDecisionSchema.parse({
      decisionId: "decision-001",
      outcome: "no_op",
      reasonCode: "cooldown_active",
      rationaleSummary: "同类事件仍在冷却窗口。",
      routeId: null,
      alternativeRouteIds: [],
      candidateId: null,
      triggerEventIds: ["event-node-001"],
      teachingDirectiveId: directive.directiveId,
      recoveryOfCandidateId: null,
      difficulty: "standard",
      cooldownKey: null,
      cooldownUntilStateVersion: null,
      confidence: 1,
      proposedBy: "agent-scene-director",
      proposedAt: at,
    });
    const candidate = CandidateEventSchema.parse({
      candidateId: "candidate-001",
      eventType: "scenario_intervention_applied",
      title: "补齐可核验信源清单",
      triggerReason: "证据缺口需要支架。",
      competencyTarget: "C-FACT-01",
      expectedImpact: "形成补证任务。",
      payload: { routeId: "route-source-scaffold" },
      status: "pending",
      proposedBy: "agent-scene-director",
      proposedAt: at,
      approvalPolicyId: "teacher-world-event-review",
      candidateKind: "director_intervention",
      routeId: "route-source-scaffold",
      triggerEventIds: ["event-node-001"],
      evidenceRefs: [],
      sourceRefs: ["course-source-verification"],
      affectedRoleIds: ["responsible_editor", "reporter"],
      riskLevel: "low",
      confidence: 0.9,
      difficulty: "supportive",
      cooldownKey: "source-pressure",
      cooldownUntilStateVersion: 30,
      alternativeRouteIds: ["route-recovery-source-brief"],
      recoveryOfCandidateId: null,
      teachingDirectiveId: directive.directiveId,
      directorDecisionId: "decision-002",
      agentRunId: "run-001",
      policyId: "director:route-source-scaffold",
      proposedStateVersion: 20,
      preconditionHash: "a".repeat(64),
      dedupKey: "route-source-scaffold:brief:hash",
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
      requiresTeacherReview: true,
    });

    expect(noOp.outcome).toBe("no_op");
    expect(candidate.recoveryOfCandidateId).toBeNull();
    expect(candidate.requiresTeacherReview).toBe(true);
    expect(() => CandidateEventSchema.parse({
      ...candidate,
      requiresTeacherReview: false,
    })).toThrow();
  });
});
