import { describe, expect, it } from "vitest";
import {
  RoleContractSchema,
  SchemaVersion,
  WorldEventSchema,
  type RoleContract,
} from "@ronggang/contracts";
import { createScopedAgentInstanceBinding } from "@ronggang/context-engine";
import {
  AgentScheduler,
  AgentTemplateCatalogConfigurationError,
  assistanceProfilesByAgentId,
  assistanceSubscriptions,
  assistanceTemplateProfiles,
  createAssistanceRoleSnapshot,
  productionAgentTemplateCatalog,
} from "../src/index.js";

const studentRole = RoleContractSchema.parse({
  agentId: "student-editor",
  actorKind: "student",
  roleId: "responsible_editor",
  displayName: "责任编辑",
  purpose: "核验证据并形成可追溯成果",
  teamId: "team-editorial-01",
  visibleScopes: ["public_world", "assigned_team", "role_private"],
  privateScopes: ["editorial_notes"],
  allowedIntents: ["record_evidence"],
  deniedActions: ["mutate_world_state"],
  toolPolicy: ["rag_search"],
  tokenBudget: 1_800,
});

const teacherRole = RoleContractSchema.parse({
  agentId: "teacher-main",
  actorKind: "teacher",
  roleId: "teacher",
  displayName: "主讲教师",
  purpose: "监督课堂并作出人工复核决定",
  teamId: "team-editorial-01",
  visibleScopes: ["teacher_only", "audit_only"],
  privateScopes: ["teacher_notes"],
  allowedIntents: ["review_evaluation"],
  deniedActions: ["mutate_world_state"],
  toolPolicy: ["evaluation.case.read"],
  tokenBudget: 2_400,
});

const evidenceRecorded = WorldEventSchema.parse({
  kind: "WorldEvent",
  sessionId: "session-assistance-catalog",
  sceneId: "scenario-local-tourism-media-v0.1",
  actorId: studentRole.agentId,
  messageId: "message-evidence-recorded",
  correlationId: "correlation-evidence-recorded",
  timestamp: "2026-07-29T04:00:00.000Z",
  schemaVersion: SchemaVersion,
  eventId: "event-evidence-recorded",
  eventType: "evidence_recorded",
  stateVersion: 18,
  visibility: ["assigned_team", "role_private", "audit_only"],
  visibleToActorIds: [studentRole.agentId],
  summary: "学生证据已进入世界",
  payload: {
    evidence: {
      evidenceId: "evidence-student-001",
      actorId: studentRole.agentId,
    },
  },
});

function resolveAssistanceInstance(
  agentId: string,
): ReturnType<typeof createScopedAgentInstanceBinding> {
  const profile = assistanceProfilesByAgentId.get(agentId);
  if (!profile) {
    throw new Error(`测试缺少辅助模板：${agentId}`);
  }
  const subjectRole: RoleContract = profile.plane === "teacher_assistance"
    ? teacherRole
    : studentRole;
  return createScopedAgentInstanceBinding({
    templateRef: {
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
    },
    definitionVersion: profile.definitionVersion,
    roleSnapshot: createAssistanceRoleSnapshot(profile, subjectRole.teamId),
    scenarioId: evidenceRecorded.sceneId,
    scenarioVersion: "1.0.0",
    courseId: "course-local-tourism-media",
    sessionId: evidenceRecorded.sessionId,
    sessionEpoch: "epoch-assistance-001",
    bindingKind: profile.plane === "teacher_assistance"
      ? "teacher_assistant"
      : "student_role",
    subjectRole,
  });
}

describe("production agent template catalogue", () => {
  it("registers the 14-agent baseline and nine admitted assistance candidates", () => {
    const entries = productionAgentTemplateCatalog.list();
    const assistanceEntries = entries.filter((entry) => (
      entry.plane === "student_assistance"
      || entry.plane === "material_production"
      || entry.plane === "teacher_assistance"
    ));
    const baselineEntries = entries.filter((entry) => (
      entry.lifecycle === "baseline"
    ));

    expect(entries).toHaveLength(23);
    expect(baselineEntries).toHaveLength(14);
    expect(assistanceEntries).toHaveLength(9);
    expect(assistanceEntries.filter((entry) => entry.lifecycle === "active"))
      .toHaveLength(3);
    expect(new Set(
      assistanceEntries.map((entry) => entry.template.outputSchemaRef),
    ).size).toBe(9);
    expect(assistanceEntries.every((entry) => (
      entry.admission.responsibilityCase.length > 0
      && entry.admission.permissionBoundary.length > 0
      && entry.admission.contextBoundary.length > 0
      && entry.admission.outputContract.length > 0
      && entry.admission.triggerAndFilterPolicy.length > 0
      && entry.admission.ablationHypothesis.length > 0
      && entry.admission.failureRoute.length > 0
    ))).toBe(true);
    expect(
      assistanceEntries
        .filter((entry) => entry.lifecycle === "active")
        .map((entry) => entry.template.templateId)
        .sort(),
    ).toEqual([
      "assistant/evaluation-review",
      "assistant/evidence-coach",
      "assistant/material-understanding",
    ]);
  });

  it("selects only the evidence coach and records disabled candidates in the same evidence wave", () => {
    const evidenceWaveSubscriptions = assistanceSubscriptions.filter(
      (subscription) => (
        subscription.eventTypes.includes("evidence_recorded")
      ),
    );
    let taskSequence = 0;
    const plan = new AgentScheduler(
      evidenceWaveSubscriptions,
      { templateCatalog: productionAgentTemplateCatalog },
    ).createDispatchPlan({
      event: evidenceRecorded,
      outboxId: "outbox-evidence-recorded",
      sessionEpoch: "epoch-assistance-001",
      causalDepth: 0,
      expectedStateVersion: 19,
      createdAt: "2026-07-29T04:00:01.000Z",
      instanceResolver: (_event, subscription) => (
        resolveAssistanceInstance(subscription.agentId)
      ),
      nextTaskId: () => `task-assistance-${++taskSequence}`,
    });

    expect(plan.decisions).toHaveLength(3);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      agentId: "agent-evidence-coach",
      roleId: "student_assistant",
      roleSnapshot: {
        agentId: "agent-evidence-coach",
        roleId: "student_assistant",
        teamId: studentRole.teamId,
      },
      instanceContext: {
        bindingKind: "student_role",
        subjectActorId: studentRole.agentId,
        subjectRoleId: studentRole.roleId,
        resourceRef: null,
      },
      dispatchDecision: {
        decision: "selected",
        reason: "selected",
      },
    });
    expect(
      plan.decisions
        .filter((decision) => (
          decision.decision.reason === "subscription_disabled"
        ))
        .map((decision) => decision.agentId)
        .sort(),
    ).toEqual([
      "agent-live-intervention",
      "agent-task-planning",
    ]);
    expect(plan.decisions.every((decision) => (
      decision.agentId === "agent-evidence-coach"
      || (
        decision.decision.decision === "filtered"
        && decision.decision.affected === false
      )
    ))).toBe(true);
  });

  it("rejects subscriptions that drift from their registered template contract", () => {
    const registered = assistanceSubscriptions.find(
      (subscription) => subscription.agentId === "agent-evidence-coach",
    );
    expect(registered).toBeDefined();
    expect(() => productionAgentTemplateCatalog.assertSubscription({
      ...registered!,
      promptVersion: "unregistered-prompt/9.9.9",
    })).toThrow(AgentTemplateCatalogConfigurationError);
  });

  it("keeps all nine declared profiles registered exactly once", () => {
    const registeredTemplateIds = new Set(
      productionAgentTemplateCatalog.list().map((entry) => (
        entry.template.templateId
      )),
    );
    expect(assistanceTemplateProfiles).toHaveLength(9);
    expect(assistanceTemplateProfiles.every((profile) => (
      registeredTemplateIds.has(profile.templateId)
    ))).toBe(true);
  });
});
