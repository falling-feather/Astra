import type {
  AdminCollaborationEpisode,
  AgentTopologyManifest,
  CourseEnrollment,
  CourseRelease,
  LearningActivity,
  StudentAgentSuggestion,
  StudentCollaborationEpisode,
  TeacherCollaborationEpisode,
} from "../src/index.js";
import {
  AgentCollaborationEpisodeSchemaVersion,
  AgentTopologyManifestSchemaVersion,
  CourseEnrollmentSchemaVersion,
  CourseReleaseSchemaVersion,
  LearningActivitySchemaVersion,
} from "../src/index.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

export function courseReleaseFixture(): CourseRelease {
  return {
    schemaVersion: CourseReleaseSchemaVersion,
    releaseStatus: "released",
    courseId: "course-xunpu-intangible-media",
    releaseId: "course-xunpu-intangible-media-r1",
    version: 1,
    contentHash: hashA,
    title: "泉州蟳埔簪花围非遗专题采编实战",
    summary: "以公开案例为依据完成信源、采访、核查、修订与发布复盘。",
    primaryJob: {
      jobId: "integrated_media_reporter",
      title: "融媒体采编岗",
      studentRoleId: "reporter",
    },
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-media",
      version: "2.0.0",
      contentHash: hashB,
    },
    sources: [
      {
        sourceId: "source-fujian-xunpu",
        title: "蟳埔簪花围文旅传播公开案例",
        publisher: "福建省文化和旅游厅",
        url: "https://wlt.fujian.gov.cn/wldt/btdt/202412/t20241209_6589570.htm",
        publishedAt: "2024-12-09",
        accessedAt: "2026-08-09",
        locator: "网页正文第 1—6 段",
        sourceVersion: "2024-12-09",
        reviewStatus: "pending_expert_review",
        copyrightNote: "仅保存元数据、必要短摘录和改写教学材料。",
        excerpt: "公开案例用于形成选题与信源训练。",
      },
      {
        sourceId: "source-moe-media-standard",
        title: "融媒体技术与运营专业教学标准",
        publisher: "中华人民共和国教育部",
        url: "https://www.moe.gov.cn/example/media-standard.pdf",
        publishedAt: "2025-02-07",
        accessedAt: "2026-08-09",
        locator: "专业核心课程与实践教学章节",
        sourceVersion: "2025",
        reviewStatus: "verified",
        copyrightNote: "仅登记公开标准定位与改写后的能力描述。",
        excerpt: null,
      },
    ],
    chapters: Array.from({ length: 5 }, (_, index) => ({
      chapterId: `xunpu-chapter-${index + 1}`,
      order: index + 1,
      title: `旗舰训练第 ${index + 1} 节`,
      objective: "在动态情境中形成可核验的融媒体采编判断。",
      taskBrief: "依据公开来源、现场事实与岗位约束完成本节交付。",
      publicSourceRefs: [
        index === 0 ? "source-moe-media-standard" : "source-fujian-xunpu",
      ],
      hiddenFactRefs: [`hidden-xunpu-${index + 1}`],
      availableActionIds: [`action-xunpu-${index + 1}`],
      dynamicEventIds: [`event-xunpu-${index + 1}`],
      candidateAgentIds: ["agent-evidence-coach"],
      teacherGateIds: [`gate-xunpu-${index + 1}`],
      deliverableIds: [`deliverable-xunpu-${index + 1}`],
      evidenceRequirements: ["必须引用至少一项公开来源或现场证据。"],
      rubricCriteria: [
        {
          criterionId: `criterion-accuracy-${index + 1}`,
          title: "准确性",
          description: "事实、来源和表述保持一致。",
          weight: 60,
          evidenceTypes: ["source_reference"],
        },
        {
          criterionId: `criterion-process-${index + 1}`,
          title: "过程证据",
          description: "选择、修订和教师门留有可复核证据。",
          weight: 40,
          evidenceTypes: ["decision_record"],
        },
      ],
      transferReflection: "说明该判断在另一类地方文旅报道中的适用与限制。",
      finalChapter: index === 4,
    })),
    studentDecisionOptions: ["accept", "request_evidence", "reject"],
    publishedAt: "2026-08-09T02:00:00.000Z",
  };
}

export function courseEnrollmentFixture(): Extract<
  CourseEnrollment,
  { status: "in_progress" }
>;
export function courseEnrollmentFixture(status: "claimed"): Extract<
  CourseEnrollment,
  { status: "claimed" }
>;
export function courseEnrollmentFixture(status: "in_progress"): Extract<
  CourseEnrollment,
  { status: "in_progress" }
>;
export function courseEnrollmentFixture(status: "awaiting_review"): Extract<
  CourseEnrollment,
  { status: "awaiting_review" }
>;
export function courseEnrollmentFixture(status: "completed"): Extract<
  CourseEnrollment,
  { status: "completed" }
>;
export function courseEnrollmentFixture(
  status: CourseEnrollment["status"],
): CourseEnrollment;
export function courseEnrollmentFixture(
  status: CourseEnrollment["status"] = "in_progress",
): CourseEnrollment {
  const common = {
    schemaVersion: CourseEnrollmentSchemaVersion,
    enrollmentId: "enrollment-xunpu-001",
    bindingId: "binding-student-xunpu",
    courseReleaseRef: {
      courseId: "course-xunpu-intangible-media",
      releaseId: "course-xunpu-intangible-media-r1",
      version: 1,
      contentHash: hashA,
    },
    primaryJobId: "integrated_media_reporter" as const,
    primaryRoleId: "reporter" as const,
    claimedAt: "2026-08-09T02:00:00.000Z",
    stateVersion: 3,
    updatedAt: "2026-08-09T02:04:00.000Z",
  };
  if (status === "claimed") {
    return {
      ...common,
      status,
      activeSessionId: null,
      startedAt: null,
      submittedAt: null,
      completedAt: null,
    };
  }
  if (status === "in_progress") {
    return {
      ...common,
      status,
      activeSessionId: "session-xunpu-001",
      startedAt: "2026-08-09T02:01:00.000Z",
      submittedAt: null,
      completedAt: null,
    };
  }
  if (status === "awaiting_review") {
    return {
      ...common,
      status,
      activeSessionId: "session-xunpu-001",
      startedAt: "2026-08-09T02:01:00.000Z",
      submittedAt: "2026-08-09T02:03:00.000Z",
      completedAt: null,
    };
  }
  return {
    ...common,
    status,
    activeSessionId: "session-xunpu-001",
    startedAt: "2026-08-09T02:01:00.000Z",
    submittedAt: "2026-08-09T02:03:00.000Z",
    completedAt: "2026-08-09T02:04:00.000Z",
  };
}

export function learningActivityFixture(
  status: LearningActivity["status"] = "active",
): LearningActivity {
  const shared = {
    schemaVersion: LearningActivitySchemaVersion,
    bindingId: "binding-student-xunpu",
    stateVersion: 3,
    generatedAt: "2026-08-09T02:04:00.000Z",
  };
  const courseReleaseRef = courseEnrollmentFixture("in_progress").courseReleaseRef;
  if (status === "empty") {
    return {
      ...shared,
      status,
      enrollment: null,
      courseReleaseRef: null,
      sessionId: null,
      currentTask: null,
      guideSteps: [],
      submittedDeliverableIds: [],
      completion: null,
      primaryAction: {
        actionId: "browse_courses",
        label: "浏览课程大厅",
        description: "先认领一门课程，再进入实训。",
      },
    };
  }
  if (status === "ready") {
    return {
      ...shared,
      status,
      enrollment: courseEnrollmentFixture("claimed"),
      courseReleaseRef,
      sessionId: null,
      currentTask: null,
      guideSteps: [],
      submittedDeliverableIds: [],
      completion: null,
      primaryAction: {
        actionId: "start_training",
        label: "开始实训",
        description: "创建冻结课程版本对应的训练会话。",
      },
    };
  }
  if (status === "active") {
    return {
      ...shared,
      status,
      enrollment: courseEnrollmentFixture("in_progress"),
      courseReleaseRef,
      sessionId: "session-xunpu-001",
      currentTask: {
        taskId: "task-xunpu-source-map",
        chapterId: "xunpu-chapter-2",
        title: "完成簪花围专题信源分级",
        objective: "确认可公开引用的事实与仍需补证的判断。",
        sceneId: "scene-xunpu-source-room",
        sourceEventId: "event-xunpu-2",
        priority: "high",
      },
      guideSteps: [
        {
          stepId: "step-collect",
          order: 1,
          title: "查看现场",
          instruction: "阅读公开材料与现场报道。",
          status: "completed",
        },
        {
          stepId: "step-verify",
          order: 2,
          title: "分级核验",
          instruction: "区分权威、当事人与平台信源。",
          status: "current",
        },
        {
          stepId: "step-submit",
          order: 3,
          title: "提交依据",
          instruction: "说明采用与待补证依据。",
          status: "pending",
        },
      ],
      submittedDeliverableIds: [],
      completion: null,
      primaryAction: {
        actionId: "continue_task",
        label: "提交信源判断",
        description: "提交后触发事实核查与教师门。",
      },
    };
  }
  if (status === "awaiting_review") {
    return {
      ...shared,
      status,
      enrollment: courseEnrollmentFixture("awaiting_review"),
      courseReleaseRef,
      sessionId: "session-xunpu-001",
      currentTask: null,
      guideSteps: [],
      submittedDeliverableIds: ["deliverable-xunpu-final"],
      completion: null,
      primaryAction: {
        actionId: "view_submission",
        label: "查看已交作品",
        description: "等待教师完成复核。",
      },
    };
  }
  return {
    ...shared,
    status,
    enrollment: courseEnrollmentFixture("completed"),
    courseReleaseRef,
    sessionId: "session-xunpu-001",
    currentTask: null,
    guideSteps: [],
    submittedDeliverableIds: ["deliverable-xunpu-final"],
    completion: {
      portfolioItemIds: ["portfolio-xunpu-final"],
      evidenceIds: ["evidence-xunpu-source-map"],
      reviewId: "review-xunpu-001",
    },
    primaryAction: {
      actionId: "review_learning",
      label: "查看评价复盘",
      description: "回看证据、反馈与迁移建议。",
    },
  };
}

const triggerEvent = {
  eventId: "event-xunpu-source-conflict",
  eventType: "source_conflict_detected",
  title: "游客量数据出现来源冲突",
  occurredAt: "2026-08-09T02:02:00.000Z",
  source: "world" as const,
  evidenceRefs: ["evidence-source-a", "evidence-source-b"],
};

const selectedAgent = {
  agentId: "agent-evidence-coach",
  templateId: "template-evidence-coach",
  instanceId: "instance-evidence-coach-xunpu",
  groupId: "fact_verification" as const,
  title: "事实核查教练",
};

const skippedAgent = {
  agentId: "agent-platform-operator",
  templateId: "template-platform-operator",
  instanceId: null,
  groupId: "operations_distribution" as const,
  title: "平台运营智能体",
};

const suggestion: StudentAgentSuggestion = {
  suggestionId: "suggestion-source-conflict",
  agent: {
    agentId: selectedAgent.agentId,
    groupId: selectedAgent.groupId,
    title: selectedAgent.title,
  },
  summary: "先保留权威来源数据，并把商业宣传口径标记为待补证。",
  rationale: "两项数据统计口径不同，不能直接合并。",
  evidenceRefs: ["evidence-source-a", "evidence-source-b"],
  riskLevel: "high" as const,
  allowedDecisions: ["accept", "request_evidence", "reject"],
};

const studentDecision = {
  decision: "request_evidence" as const,
  reason: "需要确认两项数据的统计日期与覆盖范围。",
  decidedAt: "2026-08-09T02:03:00.000Z",
  evidenceRefs: ["evidence-source-a"],
};

const teacherGate = {
  gateId: "gate-xunpu-source-conflict",
  status: "approved" as const,
  summary: "允许以待补证标记继续采访，不允许直接发布冲突数字。",
  reviewedAt: "2026-08-09T02:04:00.000Z",
};

const authorityWriteback = {
  occurred: true,
  summary: "世界任务增加数据口径补证要求。",
  worldEventIds: ["event-xunpu-evidence-requested"],
  taskIds: ["task-xunpu-source-map"],
  evidenceIds: ["evidence-xunpu-source-decision"],
  consequences: ["发布前必须补齐统计口径。"],
};

export function studentCollaborationEpisodeFixture(): StudentCollaborationEpisode {
  return {
    schemaVersion: AgentCollaborationEpisodeSchemaVersion,
    audience: "student",
    status: "completed",
    sessionId: "session-xunpu-001",
    scenarioId: "scenario-xunpu-media",
    courseReleaseRef: courseEnrollmentFixture().courseReleaseRef,
    stateVersion: 3,
    generatedAt: "2026-08-09T02:05:00.000Z",
    triggerEvent,
    suggestion,
    studentDecision,
    teacherGate,
    authorityWriteback,
    failure: null,
  };
}

export function teacherCollaborationEpisodeFixture(): TeacherCollaborationEpisode {
  return {
    schemaVersion: AgentCollaborationEpisodeSchemaVersion,
    audience: "teacher",
    status: "completed",
    sessionId: "session-xunpu-001",
    scenarioId: "scenario-xunpu-media",
    courseReleaseRef: courseEnrollmentFixture().courseReleaseRef,
    stateVersion: 3,
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
        reason: "当前尚未进入平台发布与传播阶段。",
        evidenceRefs: [],
      },
    ],
    contributions: [
      {
        contributionId: "contribution-source-conflict",
        agent: selectedAgent,
        summary: suggestion.summary,
        rationale: suggestion.rationale,
        evidenceRefs: suggestion.evidenceRefs,
        riskLevel: suggestion.riskLevel,
        status: "ready",
      },
    ],
    studentDecision,
    teacherGate,
    authorityWriteback,
    failureCode: null,
  };
}

export function adminCollaborationEpisodeFixture(): AdminCollaborationEpisode {
  return {
    ...teacherCollaborationEpisodeFixture(),
    audience: "admin",
    execution: {
      mode: "deterministic_demo",
      providerId: null,
      selectedCount: 1,
      skippedCount: 1,
      failedAgentIds: [],
      traceRefs: ["trace-xunpu-dispatch-001"],
    },
  };
}

export function agentTopologyManifestFixture(): AgentTopologyManifest {
  const groupIds = [
    "teaching_direction",
    "editorial_production",
    "fact_verification",
    "content_governance",
    "operations_distribution",
    "evaluation_learning",
  ] as const;
  const groups = groupIds.map((groupId, index) => ({
    groupId,
    title: `智能体分组 ${index + 1}`,
    responsibility: `承担第 ${index + 1} 类受控岗位协作职责。`,
    order: index + 1,
  }));
  const agents = Array.from({ length: 14 }, (_, index) => ({
    agentId: `agent-v2-${index + 1}`,
    templateId: `template-v2-${index + 1}`,
    title: `智能体 ${index + 1}`,
    groupId: groupIds[index % groupIds.length]!,
    responsibility: "在权限和教师门内生成结构化业务候选。",
    subscribedEventTypes: [`event-type-${(index % 4) + 1}`],
    inputTypes: ["role_safe_projection"],
    outputTypes: ["structured_candidate"],
    allowedActions: ["propose_candidate"],
    forbiddenActions: ["write_world_directly"],
    teacherGateRequired: index % 3 === 0,
    status: "active" as const,
  }));
  return {
    schemaVersion: AgentTopologyManifestSchemaVersion,
    generatedAt: "2026-08-09T02:05:00.000Z",
    groups,
    agents,
    edges: [
      {
        edgeId: "edge-v2-1",
        sourceAgentId: "agent-v2-1",
        targetAgentId: "agent-v2-2",
        eventType: "event-type-1",
        relation: "supports",
      },
    ],
  };
}
