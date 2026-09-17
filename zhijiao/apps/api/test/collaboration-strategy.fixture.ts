import {
  CollaborationStrategyContentSchema,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  FlagshipCollaborationScenarioReleaseId,
  FlagshipCollaborationTaskAnchorId,
  type CollaborationStrategyContent,
} from "@ronggang/contracts";

export function collaborationStrategyContent(
  overrides: Partial<CollaborationStrategyContent> = {},
): CollaborationStrategyContent {
  return CollaborationStrategyContentSchema.parse({
    eventConditions: {
      scenarioReleaseId: FlagshipCollaborationScenarioReleaseId,
      routeId: FlagshipCollaborationRouteId,
      triggerEventId: FlagshipCollaborationEventId,
      taskAnchorId: FlagshipCollaborationTaskAnchorId,
      requiredEventRefs: ["event-rain-triggered"],
    },
    agentSet: [
      "agent-evidence-coach",
      "agent-material-understanding",
    ],
    permissions: [
      {
        agentId: "agent-evidence-coach",
        visibleScopes: ["assigned_team", "role_private"],
        capabilities: ["read-assigned-evidence", "suggest-verification"],
        privateDataPolicy: "subject_only",
        authoritativeWorldWrite: false,
      },
      {
        agentId: "agent-material-understanding",
        visibleScopes: ["assigned_team"],
        capabilities: ["read-assigned-material", "summarize-material"],
        privateDataPolicy: "none",
        authoritativeWorldWrite: false,
      },
    ],
    basisRefs: [
      {
        refType: "world_event",
        refId: "event-rain-triggered",
        version: "state-41",
      },
      {
        refType: "student_action",
        refId: "action-rain-collaboration",
        version: null,
      },
    ],
    recommendationSummary: "暴雨触发后先核对材料，再由学生决定协作路径。",
    studentChoice: {
      decision: "accepted",
      selectedAgentIds: ["agent-evidence-coach"],
      reason: "先补足来源证据再改写交付顺序。",
      actionRef: "action-rain-collaboration",
      decidedAt: "2026-07-30T16:20:00.000Z",
    },
    consequenceRefs: ["consequence-rain-priority-updated"],
    evidenceRefs: ["evidence-rain-source-check"],
    ...overrides,
  });
}
