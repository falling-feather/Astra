import type {
  CourseEnrollment,
  CourseOutcomeMutationReceipt,
  CourseProgressItem,
  CourseProgressList,
  CourseReviewWorkspace,
  LearningActivity,
  StudentPortfolio,
  StudentTrainingContext,
  StudentCollaborationEpisode,
  SessionExperienceDescriptor,
} from "@ronggang/contracts";
import { sessionExperienceCapabilities } from "@ronggang/contracts";
import type { ExperienceGateway } from "../src/v2/gateway";
import type {
  CourseReleaseDetailView,
  CourseReleaseSummary,
} from "../src/v2/models";

export const courseHash = "a".repeat(64);

export function sessionExperienceDescriptorFixture(
  experienceGeneration: SessionExperienceDescriptor["experienceGeneration"] = "flagship_v4",
  overrides: Partial<SessionExperienceDescriptor> = {},
): SessionExperienceDescriptor {
  return {
    schemaVersion: "session-experience-descriptor/4.0.0",
    descriptorId: `experience-${experienceGeneration}`,
    sessionId: "session-xunpu-001",
    courseReleaseRef: enrollmentFixture().courseReleaseRef,
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-media",
      version: "2.0.1",
      contentHash: "b".repeat(64),
    },
    experienceGeneration,
    capabilities: sessionExperienceCapabilities(experienceGeneration),
    entryRoute: {
      student: "/student/training/:sessionId",
      teacher: "/teacher/director/:sessionId",
      studentReview: "/student/reviews/:sessionId",
      teacherReview: "/teacher/reviews/:sessionId",
      administrator: "/admin/agent-topology/:sessionId",
    },
    compatibility: "current",
    frozenAt: "2026-08-09T02:01:00.000Z",
    ...overrides,
  } as SessionExperienceDescriptor;
}

export const frozenCourseCatalog = [
  {
    courseId: "course-xunpu-intangible-media",
    title: "泉州蟳埔簪花围非遗专题采编实战",
    summary: "从现场变化出发，完成信源核验、采访与报道修订。",
    chapterCount: 7,
    hashDigit: "a",
  },
  {
    courseId: "course-village-super-multiplatform",
    title: "贵州村超多平台视听报道",
    summary: "围绕村超现场完成脚本、直播快讯与多平台版本适配。",
    chapterCount: 6,
    hashDigit: "b",
  },
  {
    courseId: "course-ai-tourism-copyright-governance",
    title: "AI 文旅视觉版权与内容治理",
    summary: "核验素材来源、生成标识、版权边界与平台治理要求。",
    chapterCount: 6,
    hashDigit: "c",
  },
  {
    courseId: "course-scenic-rain-emergency-reporting",
    title: "景区暴雨闭园与复开应急报道",
    summary: "在气象预警与景区动态中完成连续核查和多平台更新。",
    chapterCount: 6,
    hashDigit: "d",
  },
] as const;

export function courseReleaseSummaryFixture(
  overrides: Partial<CourseReleaseSummary> = {},
): CourseReleaseSummary {
  return {
    schemaVersion: "course-release-summary/2.0.0",
    courseId: "course-xunpu-intangible-media",
    courseReleaseId: "course-xunpu-intangible-media-r1",
    releaseId: "course-xunpu-intangible-media-r1",
    version: 1,
    contentHash: courseHash,
    title: "泉州蟳埔簪花围非遗专题采编实战",
    summary: "从现场变化出发，完成信源核验、采访与报道修订。",
    primaryJob: {
      jobId: "integrated_media_reporter",
      title: "融媒体采编岗",
      studentRoleId: "reporter",
    },
    chapterCount: 7,
    sourceCount: 12,
    publishedAt: "2026-08-09T02:00:00.000Z",
    ...overrides,
  };
}

export function fourCourseSummaryFixtures(): CourseReleaseSummary[] {
  return frozenCourseCatalog.map((course) => ({
    ...courseReleaseSummaryFixture({
      courseId: course.courseId,
      courseReleaseId: `${course.courseId}-r1`,
      releaseId: `${course.courseId}-r1`,
      contentHash: course.hashDigit.repeat(64),
      title: course.title,
      summary: course.summary,
      chapterCount: course.chapterCount,
      sourceCount: 2,
    }),
  }));
}

export function courseReleaseFixture(
  summary: CourseReleaseSummary = courseReleaseSummaryFixture(),
): CourseReleaseDetailView {
  const sources: CourseReleaseDetailView["sources"] = [1, 2].map((order) => ({
    sourceId: `${summary.courseId}:source-${order}`,
    title: `${summary.title}公开来源 ${order}`,
    publisher: order === 1 ? "政府公开平台" : "行业规范发布机构",
    url: `https://example.com/${encodeURIComponent(summary.courseId)}/source-${order}`,
    publishedAt: "2026-01-02",
    accessedAt: "2026-08-09",
    locator: `第 ${order} 节公开说明`,
    sourceVersion: `2026-${order}`,
    reviewStatus: order === 1 ? "verified" : "pending_expert_review",
    copyrightNote: "仅保存来源元数据与改写后的教学材料。",
    excerpt: null,
  }));
  const chapters: CourseReleaseDetailView["chapters"] = Array.from(
    { length: summary.chapterCount },
    (_, index) => {
      const order = index + 1;
      return {
        chapterId: `${summary.courseId}:chapter-${order}`,
        order,
        title: `第 ${order} 节 · 真实工作任务`,
        objective: `完成第 ${order} 节岗位目标并说明判断依据。`,
        taskBrief: `围绕课程公开来源完成第 ${order} 节采编任务。`,
        publicSourceRefs: [sources[index % sources.length]!.sourceId],
        deliverableIds: [`${summary.courseId}:deliverable-${order}`],
        evidenceRequirements: [`提交第 ${order} 节事实依据与成果说明`],
        rubricCriteria: [{
          criterionId: `${summary.courseId}:criterion-${order}`,
          title: "事实与证据",
          description: "判断必须能够回到公开来源和过程证据。",
          weight: 100,
          evidenceTypes: ["source_note"],
        }],
        transferReflection: "说明本节方法如何迁移到新的文旅报道情境。",
        finalChapter: order === summary.chapterCount,
      };
    },
  );
  return {
    schemaVersion: "course-release-detail/2.0.0",
    releaseStatus: "released",
    courseId: summary.courseId,
    courseReleaseId: summary.courseReleaseId,
    releaseId: summary.releaseId,
    version: summary.version,
    contentHash: summary.contentHash,
    title: summary.title,
    summary: summary.summary,
    primaryJob: summary.primaryJob,
    sources,
    chapters,
    studentDecisionOptions: ["accept", "request_evidence", "reject"],
    publishedAt: summary.publishedAt,
  };
}

export function enrollmentFixture(
  overrides: Partial<CourseEnrollment> = {},
): CourseEnrollment {
  return {
    schemaVersion: "course-enrollment/2.0.0",
    enrollmentId: "enrollment-xunpu-001",
    bindingId: "binding-student-xunpu",
    courseReleaseRef: {
      courseId: "course-xunpu-intangible-media",
      releaseId: "course-xunpu-intangible-media-r1",
      version: 1,
      contentHash: courseHash,
    },
    primaryJobId: "integrated_media_reporter",
    primaryRoleId: "reporter",
    status: "in_progress",
    activeSessionId: "session-xunpu-001",
    claimedAt: "2026-08-09T02:00:00.000Z",
    startedAt: "2026-08-09T02:01:00.000Z",
    submittedAt: null,
    completedAt: null,
    stateVersion: 18,
    updatedAt: "2026-08-09T02:04:00.000Z",
    ...overrides,
  } as CourseEnrollment;
}

export function courseProgressItemFixture(
  enrollment: CourseEnrollment = enrollmentFixture(),
  overrides: Partial<CourseProgressItem> = {},
): CourseProgressItem {
  const chapterIds = Array.from(
    { length: 7 },
    (_, index) => `course-xunpu-intangible-media:chapter-${index + 1}`,
  );
  const completedChapterIds = enrollment.status === "claimed"
    ? []
    : enrollment.status === "in_progress"
      ? [chapterIds[0]!]
      : chapterIds;
  return {
    enrollment,
    chapterCount: 7,
    completedChapterIds,
    currentChapterId: enrollment.status === "in_progress" ? chapterIds[1]! : null,
    submittedDeliverableCount: enrollment.status === "claimed" ? 0 : 1,
    portfolioItemCount: enrollment.status === "claimed" ? 0 : 1,
    evidenceCount: enrollment.status === "claimed" ? 0 : 1,
    reviewStatus: enrollment.status === "awaiting_review"
      ? "awaiting_review"
      : enrollment.status === "completed" ? "completed" : "not_submitted",
    ...overrides,
  } as CourseProgressItem;
}

export function courseProgressListFixture(
  items: CourseProgressItem[] = [courseProgressItemFixture()],
): CourseProgressList {
  return {
    schemaVersion: "course-progress-list/2.0.0",
    generatedAt: "2026-08-09T02:05:00.000Z",
    items,
  };
}

export function studentPortfolioFixture(): StudentPortfolio {
  const enrollment = enrollmentFixture();
  const evidenceId = "evidence-xunpu-source-map";
  const revisionId = "revision-xunpu-topic-r1";
  return {
    schemaVersion: "student-portfolio/2.0.0",
    generatedAt: "2026-08-09T02:08:00.000Z",
    items: [{
      portfolioItemId: "portfolio-xunpu-topic",
      enrollmentId: enrollment.enrollmentId,
      courseReleaseRef: enrollment.courseReleaseRef,
      sessionId: enrollment.activeSessionId!,
      artifactId: "artifact-xunpu-topic",
      revisionId,
      chapterId: "course-xunpu-intangible-media:chapter-1",
      deliverableIds: ["deliverable-xunpu-topic"],
      origin: "student_artifact",
      title: "簪花围专题选题与信源图",
      kind: "article",
      status: "draft",
      revisionNumber: 1,
      summary: "区分已核事实、待补证判断与采访问题。",
      contentHash: "f".repeat(64),
      evidenceIds: [evidenceId],
      updatedAt: "2026-08-09T02:07:00.000Z",
    }],
    evidence: [{
      evidenceId,
      enrollmentId: enrollment.enrollmentId,
      courseReleaseRef: enrollment.courseReleaseRef,
      sessionId: enrollment.activeSessionId!,
      title: "公开来源核验记录",
      basis: "来源发布主体、日期与统计口径均已登记。",
      artifactRevisionRefs: [revisionId],
      createdAt: "2026-08-09T02:06:00.000Z",
    }],
  };
}

export function courseReviewWorkspaceFixture(
  status: "not_submitted" | "awaiting_review" | "completed" = "not_submitted",
  viewer: "student" | "teacher" = "student",
): CourseReviewWorkspace {
  const enrollment = status === "not_submitted"
    ? enrollmentFixture({ stateVersion: 18 })
    : status === "awaiting_review"
      ? enrollmentFixture({
        status: "awaiting_review",
        submittedAt: "2026-08-09T02:10:00.000Z",
        stateVersion: 19,
        updatedAt: "2026-08-09T02:10:00.000Z",
      })
      : enrollmentFixture({
        status: "completed",
        submittedAt: "2026-08-09T02:10:00.000Z",
        completedAt: "2026-08-09T02:15:00.000Z",
        stateVersion: 20,
        updatedAt: "2026-08-09T02:15:00.000Z",
      });
  if (status === "not_submitted") {
    return {
      schemaVersion: "course-review-workspace/2.0.0",
      viewer,
      generatedAt: "2026-08-09T02:09:00.000Z",
      status,
      enrollment,
      submission: null,
      review: null,
    } as CourseReviewWorkspace;
  }
  const evidenceId = "evidence-xunpu-source-map";
  const submission = {
    submissionId: "submission-xunpu-001",
    reviewTaskId: "review-task-xunpu-001",
    enrollmentId: enrollment.enrollmentId,
    courseReleaseRef: enrollment.courseReleaseRef,
    sessionId: enrollment.activeSessionId!,
    submittedAt: enrollment.submittedAt!,
    deliverableIds: ["deliverable-xunpu-final"],
    portfolioItemIds: ["portfolio-xunpu-topic"],
    evidenceIds: [evidenceId],
    rubric: Array.from({ length: 7 }, (_, index) => ({
      chapterId: `course-xunpu-intangible-media:chapter-${index + 1}`,
      title: `第 ${index + 1} 节`,
      criteria: [{
        criterionId: `criterion-${index + 1}`,
        title: "事实与证据",
        description: "判断能够回到冻结证据。",
        weight: 100,
        evidenceTypes: ["source_note"],
      }],
    })),
  };
  return {
    schemaVersion: "course-review-workspace/2.0.0",
    viewer,
    generatedAt: "2026-08-09T02:15:00.000Z",
    status,
    enrollment,
    submission,
    review: status === "completed" ? {
      reviewId: "review-xunpu-001",
      finalScore: 88,
      dimensions: [{
        dimensionId: "dimension-evidence",
        label: "事实与证据",
        score: 88,
        maxScore: 100,
        feedback: "公开来源与过程证据对应清楚。",
        evidenceRefs: [evidenceId],
      }],
      publicSummary: "已经形成可核验、可迁移的专题采编成果。",
      finalizedAt: enrollment.completedAt!,
    } : null,
  } as CourseReviewWorkspace;
}

export function courseOutcomeReceiptFixture(
  status: "awaiting_review" | "completed" = "awaiting_review",
): CourseOutcomeMutationReceipt {
  return {
    schemaVersion: "course-outcome-receipt/2.0.0",
    accepted: true,
    requestId: "request-course-outcome-001",
    sessionId: "session-xunpu-001",
    enrollmentId: "enrollment-xunpu-001",
    status,
    stateVersion: status === "completed" ? 20 : 19,
  };
}

export function learningActivityFixture(
  overrides: Partial<LearningActivity> = {},
): LearningActivity {
  return {
    schemaVersion: "learning-activity/2.0.0",
    bindingId: "binding-student-xunpu",
    stateVersion: 18,
    generatedAt: "2026-08-09T02:04:00.000Z",
    status: "active",
    enrollment: enrollmentFixture(),
    courseReleaseRef: enrollmentFixture().courseReleaseRef,
    sessionId: "session-xunpu-001",
    currentTask: {
      taskId: "session-xunpu-001:xunpu-topic-brief:task",
      chapterId: "xunpu-topic-brief",
      title: "核实现场变化并修订报道计划",
      objective: "确认可公开引用的事实与仍需补证的判断。",
      sceneId: "scene-xunpu-topic",
      sourceEventId: "event-xunpu-topic",
      priority: "high",
    },
    guideSteps: [
      {
        stepId: "xunpu-topic-brief:understand",
        order: 1,
        title: "读清任务",
        instruction: "观察现场，识别关键变化。",
        status: "completed",
      },
      {
        stepId: "xunpu-topic-brief:verify",
        order: 2,
        title: "核验证据",
        instruction: "确认来源与事实口径。",
        status: "current",
      },
      {
        stepId: "xunpu-topic-brief:deliver",
        order: 3,
        title: "完成成果",
        instruction: "提交本节报道判断。",
        status: "pending",
      },
    ],
    submittedDeliverableIds: [],
    completion: null,
    primaryAction: {
      actionId: "continue_task",
      label: "继续当前任务",
      description: "完成当前唯一主行动。",
    },
    ...overrides,
  } as LearningActivity;
}

export function studentTrainingContextFixture(
  stateVersion = 18,
  actionStatus: "ready" | "in_progress" | "completed" = "in_progress",
): StudentTrainingContext {
  return {
    schemaVersion: "student-training-context/2.0.0",
    sessionId: "session-xunpu-001",
    bindingId: "binding-student-xunpu",
    courseReleaseRef: enrollmentFixture().courseReleaseRef,
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-media",
      version: "2.0.1",
      contentHash: "b".repeat(64),
    },
    stateVersion,
    generatedAt: "2026-08-09T02:05:00.000Z",
    actor: {
      roleId: "reporter",
      displayName: "记者",
    },
    remainingMinutes: 18,
    scene: {
      sceneId: "scene-xunpu-topic",
      title: "蟳埔簪花围报道现场",
      description: "游客采访、传承人口述与公开资料正在同一现场汇合。",
      phase: "active",
      riskLevel: "medium",
      stateTags: ["信源待核", "采访窗口开放"],
    },
    hotspots: [{
      hotspotId: "hotspot-inheritor",
      label: "非遗传承人",
      description: "可核实簪花围技艺流程与社区语境。",
      status: "available",
      relationship: "cooperative",
      consequencePreview: "形成一手采访证据",
    }],
    eventCards: [{
      eventRef: "event-xunpu-topic",
      title: "现场采访窗口已开放",
      changes: ["传承人与游客均可接受采访"],
      tone: "info",
    }],
    currentAction: actionStatus === "completed"
      ? null
      : {
        actionRef: "xunpu-topic-compare-angles",
        sceneId: "scene-xunpu-topic",
        label: "提交报道角度判断",
        description: "比较旅游消费与社区文化两个报道角度。",
        expectedOutput: "选题判断与依据",
        status: actionStatus,
        priority: "normal",
        sourceEventRefs: ["event-xunpu-topic"],
      },
    evidenceRefs: stateVersion > 18 ? ["evidence-choice-confirmed"] : [],
  } as StudentTrainingContext;
}

export function studentEpisodeFixture(
  decision: "accept" | "request_evidence" | "reject" | null = null,
  stateVersion = decision ? 19 : 18,
): StudentCollaborationEpisode {
  return {
    schemaVersion: "agent-collaboration-episode/2.0.0",
    audience: "student",
    status: decision ? "decided" : "suggestion_ready",
    sessionId: "session-xunpu-001",
    scenarioId: "scenario-xunpu-media",
    courseReleaseRef: enrollmentFixture().courseReleaseRef,
    stateVersion,
    generatedAt: "2026-08-09T02:05:00.000Z",
    triggerEvent: {
      eventId: "event-source-conflict",
      eventType: "source_conflict_detected",
      title: "两项客流数据口径不同",
      occurredAt: "2026-08-09T02:02:00.000Z",
      source: "world",
      evidenceRefs: ["evidence-source-a"],
    },
    suggestion: {
      suggestionId: "suggestion-source-conflict",
      agent: {
        agentId: "agent-evidence-coach",
        groupId: "fact_verification",
        title: "事实核查智能体",
      },
      summary: "先保留权威来源数据，并把宣传口径标记为待补证。",
      rationale: "两项数据统计口径不同，不能直接合并。",
      evidenceRefs: ["evidence-source-a"],
      riskLevel: "high",
      allowedDecisions: ["accept", "request_evidence", "reject"],
    },
    studentDecision: decision ? {
      decision,
      reason: `学生选择 ${decision}`,
      decidedAt: "2026-08-09T02:06:00.000Z",
      evidenceRefs: ["evidence-source-a"],
    } : null,
    teacherGate: null,
    authorityWriteback: null,
    failure: null,
  };
}

export function gatewayFixture(
  overrides: Partial<ExperienceGateway> = {},
): ExperienceGateway {
  return {
    authorizeSession: async () => "binding-student-xunpu",
    getCourses: async () => [courseReleaseSummaryFixture()],
    getCourse: async () => courseReleaseFixture(),
    getEnrollments: async () => [enrollmentFixture()],
    getSessionExperienceDescriptor: async () => sessionExperienceDescriptorFixture(),
    getCourseProgress: async () => courseProgressListFixture(),
    getPortfolio: async () => studentPortfolioFixture(),
    claimCourse: async () => enrollmentFixture(),
    getLearningActivity: async () => learningActivityFixture(),
    getStudentTrainingContext: async () => studentTrainingContextFixture(),
    getStudentEpisode: async () => studentEpisodeFixture(),
    getCourseReview: async () => courseReviewWorkspaceFixture(),
    submitCourseForReview: async () => courseOutcomeReceiptFixture(),
    recordAdviceDecision: async () => undefined,
    recordExperienceAction: async () => undefined,
    ...overrides,
  };
}
