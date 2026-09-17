import {
  AgentCollaborationEpisodeSchemaVersion,
  AgentTopologyManifestSchemaVersion,
  type AdminCollaborationEpisode,
  type AgentGroupId,
  type AgentTopologyManifest,
  type CourseOutcomeMutationReceipt,
  type CourseReviewTaskList,
  type CourseReviewWorkspace,
  type SessionControlOverview,
  type TeacherCollaborationEpisode,
} from "@ronggang/contracts";
import { buildAdminTopologyView, type AdminTopologyView } from "../src/v2/admin-models";
import type { TeacherClassView } from "../src/v2/teacher-models";
import {
  courseOutcomeReceiptFixture,
  courseReviewWorkspaceFixture,
} from "./v2-student.fixture";

const courseReleaseRef = {
  courseId: "course-xunpu-intangible-media",
  releaseId: "course-xunpu-intangible-media-r1",
  version: 1,
  contentHash: "a".repeat(64),
};

const triggerEvent = {
  eventId: "event-xunpu-source-conflict",
  eventType: "source_conflict_detected",
  title: "游客量数据出现来源冲突",
  occurredAt: "2026-08-09T02:02:00.000Z",
  source: "world" as const,
  evidenceRefs: ["evidence-source-a", "evidence-source-b"],
};

export function teacherReviewTasksFixture(
  status: "awaiting_review" | "completed" = "awaiting_review",
): CourseReviewTaskList {
  return {
    schemaVersion: "course-review-task-list/2.0.0",
    generatedAt: "2026-08-09T02:15:00.000Z",
    sessionId: "session-xunpu-001",
    items: [{
      reviewTaskId: "review-task-xunpu-001",
      enrollmentId: "enrollment-xunpu-001",
      learnerRef: "learner:0123456789abcdef",
      courseReleaseRef,
      sessionId: "session-xunpu-001",
      status,
      stateVersion: status === "completed" ? 20 : 19,
      submittedAt: "2026-08-09T02:10:00.000Z",
      completedAt: status === "completed" ? "2026-08-09T02:15:00.000Z" : null,
    }],
  };
}

export function teacherReviewWorkspaceFixture(
  status: "awaiting_review" | "completed" = "awaiting_review",
): CourseReviewWorkspace {
  return courseReviewWorkspaceFixture(status, "teacher");
}

export function teacherOutcomeReceiptFixture(): CourseOutcomeMutationReceipt {
  return {
    ...courseOutcomeReceiptFixture("completed"),
    requestId: "request-teacher-review-001",
  };
}

const selectedAgent = {
  agentId: "agent-v2-1",
  templateId: "template-v2-1",
  instanceId: "instance-v2-1",
  groupId: "teaching_direction" as const,
  title: "情境导演智能体",
};

const skippedAgent = {
  agentId: "agent-v2-2",
  templateId: "template-v2-2",
  instanceId: null,
  groupId: "editorial_production" as const,
  title: "材料理解智能体",
};

export function teacherSessionOverviewFixture(
  visible = true,
): SessionControlOverview {
  return {
    schemaVersion: "session-control.v1",
    classrooms: visible ? [{
      classroomId: "classroom-xunpu-a",
      courseId: courseReleaseRef.courseId,
      name: "蟳埔非遗采编 A 班",
      status: "active",
    }] : [],
    teams: visible ? [{
      teamId: "team-xunpu-a",
      classroomId: "classroom-xunpu-a",
      name: "A 班采编组",
      status: "active",
    }] : [],
    sessions: visible ? [{
      schemaVersion: "session-control.v1",
      sessionId: "session-xunpu-a",
      classroomId: "classroom-xunpu-a",
      teamId: "team-xunpu-a",
      releaseId: courseReleaseRef.releaseId,
      experienceTitle: "泉州蟳埔非遗采编旗舰世界",
      status: "active",
      statusVersion: 18,
      requestedBy: "principal-teacher-a",
      createdAt: "2026-08-09T01:00:00.000Z",
      updatedAt: "2026-08-09T02:02:00.000Z",
      activatedAt: "2026-08-09T01:05:00.000Z",
      completedAt: null,
      lastRecoveryErrorCode: null,
    }] : [],
  };
}

export function teacherClassFixture(): TeacherClassView {
  return {
    session: teacherSessionOverviewFixture().sessions[0]!,
    classroomName: "蟳埔非遗采编 A 班",
    teamName: "A 班采编组",
    experienceTitle: "泉州蟳埔非遗采编旗舰世界",
  };
}

export function teacherEpisodeFixture(
  status: TeacherCollaborationEpisode["status"] = "awaiting_gate",
): TeacherCollaborationEpisode {
  if (status === "waiting") {
    return {
      schemaVersion: AgentCollaborationEpisodeSchemaVersion,
      audience: "teacher",
      status,
      sessionId: "session-xunpu-a",
      scenarioId: "scenario-xunpu-media",
      courseReleaseRef,
      stateVersion: 18,
      generatedAt: "2026-08-09T02:05:00.000Z",
      triggerEvent: null,
      affectedAgents: [],
      contributions: [],
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
      failureCode: null,
    };
  }
  const completed = status === "completed";
  return {
    schemaVersion: AgentCollaborationEpisodeSchemaVersion,
    audience: "teacher",
    status,
    sessionId: "session-xunpu-a",
    scenarioId: "scenario-xunpu-media",
    courseReleaseRef,
    stateVersion: completed ? 20 : 18,
    generatedAt: "2026-08-09T02:05:00.000Z",
    triggerEvent,
    affectedAgents: [
      {
        agent: selectedAgent,
        decision: "selected",
        reasonCode: "affected_object_match",
        reason: "来源冲突直接影响事实核查对象。",
        evidenceRefs: triggerEvent.evidenceRefs,
      },
      {
        agent: skippedAgent,
        decision: "skipped",
        reasonCode: "not_affected",
        reason: "当前尚未进入素材理解与生产阶段。",
        evidenceRefs: [],
      },
    ],
    contributions: [{
      contributionId: "contribution-source-conflict",
      agent: selectedAgent,
      summary: "先保留权威来源数据，并把商业口径标记为待补证。",
      rationale: "两项数据统计口径不同，不能直接合并。",
      evidenceRefs: triggerEvent.evidenceRefs,
      riskLevel: "high",
      status: "ready",
    }],
    studentDecision: {
      decision: "request_evidence",
      reason: "需要确认两项数据的统计日期与覆盖范围。",
      decidedAt: "2026-08-09T02:03:00.000Z",
      evidenceRefs: ["evidence-source-a"],
    },
    teacherGate: {
      gateId: "gate-xunpu-source-conflict",
      status: completed ? "approved" : "pending",
      summary: completed ? "已批准补证后继续。" : "补证后方可继续发布。",
      reviewedAt: completed ? "2026-08-09T02:04:00.000Z" : null,
    },
    authorityWriteback: completed ? {
      occurred: true,
      summary: "世界任务增加数据口径补证要求。",
      worldEventIds: ["event-xunpu-evidence-requested"],
      taskIds: ["task-xunpu-source-map"],
      evidenceIds: ["evidence-xunpu-source-decision"],
      consequences: ["发布前必须补齐统计口径。"],
    } : null,
    failureCode: null,
  };
}

export function adminEpisodeFixture(): AdminCollaborationEpisode {
  return {
    ...teacherEpisodeFixture("awaiting_gate"),
    audience: "admin",
    execution: {
      mode: "live",
      providerId: "iflytek-spark",
      selectedCount: 1,
      skippedCount: 1,
      failedAgentIds: [],
      traceRefs: ["trace-xunpu-dispatch-001"],
    },
  };
}

export function agentTopologyManifestFixture(): AgentTopologyManifest {
  const groupIds: AgentGroupId[] = [
    "teaching_direction",
    "editorial_production",
    "fact_verification",
    "content_governance",
    "operations_distribution",
    "evaluation_learning",
  ];
  return {
    schemaVersion: AgentTopologyManifestSchemaVersion,
    generatedAt: "2026-08-09T02:05:00.000Z",
    groups: groupIds.map((groupId, index) => ({
      groupId,
      title: `智能体分组 ${index + 1}`,
      responsibility: `承担第 ${index + 1} 类受控岗位协作职责。`,
      order: index + 1,
    })),
    agents: Array.from({ length: 14 }, (_, index) => ({
      agentId: `agent-v2-${index + 1}`,
      templateId: `template-v2-${index + 1}`,
      title: index === 0 ? "情境导演智能体" : `智能体 ${index + 1}`,
      groupId: groupIds[index % groupIds.length]!,
      responsibility: "在权限和教师门内生成结构化业务候选。",
      subscribedEventTypes: [`event-type-${(index % 4) + 1}`],
      inputTypes: ["role_safe_projection"],
      outputTypes: ["structured_candidate"],
      allowedActions: ["propose_candidate"],
      forbiddenActions: ["write_world_directly"],
      teacherGateRequired: index % 3 === 0,
      status: "active",
    })),
    edges: [{
      edgeId: "edge-v2-1",
      sourceAgentId: "agent-v2-1",
      targetAgentId: "agent-v2-2",
      eventType: "event-type-1",
      relation: "supports",
    }],
  };
}

export function adminTopologyFixture(): AdminTopologyView {
  return buildAdminTopologyView(
    agentTopologyManifestFixture(),
    adminEpisodeFixture(),
  );
}
