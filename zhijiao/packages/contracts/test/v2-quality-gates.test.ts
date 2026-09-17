import { describe, expect, it } from "vitest";
import {
  ActorKindSchema,
  AdminCollaborationEpisodeSchema,
  AgentCollaborationEpisodeSchema,
  AgentTopologyManifestSchema,
  CourseEnrollmentSchema,
  CourseReleaseSchema,
  LearningActivitySchema,
  StudentCollaborationEpisodeSchema,
  TeacherCollaborationEpisodeSchema,
} from "../src/index.js";
import {
  adminCollaborationEpisodeFixture,
  agentTopologyManifestFixture,
  courseEnrollmentFixture,
  courseReleaseFixture,
  learningActivityFixture,
  studentCollaborationEpisodeFixture,
  teacherCollaborationEpisodeFixture,
} from "./v2-learning.fixture.js";

interface SafeParser {
  safeParse(value: unknown): { success: boolean };
}

function expectRejected(schema: SafeParser, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe("QA-005 V2 contract quality gates", () => {
  it("accepts every canonical course, enrollment, activity and audience fixture", () => {
    expect(CourseReleaseSchema.parse(courseReleaseFixture()).releaseStatus)
      .toBe("released");

    for (const status of [
      "claimed",
      "in_progress",
      "awaiting_review",
      "completed",
    ] as const) {
      expect(CourseEnrollmentSchema.parse(
        courseEnrollmentFixture(status),
      ).status).toBe(status);
    }

    for (const status of [
      "empty",
      "ready",
      "active",
      "awaiting_review",
      "completed",
    ] as const) {
      expect(LearningActivitySchema.parse(
        learningActivityFixture(status),
      ).status).toBe(status);
    }

    expect(AgentCollaborationEpisodeSchema.parse(
      studentCollaborationEpisodeFixture(),
    ).audience).toBe("student");
    expect(AgentCollaborationEpisodeSchema.parse(
      teacherCollaborationEpisodeFixture(),
    ).audience).toBe("teacher");
    expect(AgentCollaborationEpisodeSchema.parse(
      adminCollaborationEpisodeFixture(),
    ).audience).toBe("admin");
    expect(AgentTopologyManifestSchema.parse(
      agentTopologyManifestFixture(),
    )).toMatchObject({
      groups: expect.any(Array),
      agents: expect.any(Array),
    });
  });

  it.each([
    [
      "CourseRelease",
      CourseReleaseSchema,
      { ...courseReleaseFixture(), schemaVersion: "course-release/2.0.1" },
    ],
    [
      "CourseEnrollment",
      CourseEnrollmentSchema,
      {
        ...courseEnrollmentFixture("claimed"),
        schemaVersion: "course-enrollment/2.0.1",
      },
    ],
    [
      "LearningActivity",
      LearningActivitySchema,
      {
        ...learningActivityFixture("active"),
        schemaVersion: "learning-activity/2.0.1",
      },
    ],
    [
      "AgentCollaborationEpisode",
      AgentCollaborationEpisodeSchema,
      {
        ...studentCollaborationEpisodeFixture(),
        schemaVersion: "agent-collaboration-episode/2.0.1",
      },
    ],
    [
      "AgentTopologyManifest",
      AgentTopologyManifestSchema,
      {
        ...agentTopologyManifestFixture(),
        schemaVersion: "agent-topology-manifest/2.0.1",
      },
    ],
  ] as const)("rejects %s schema-version drift", (_name, schema, value) => {
    expectRejected(schema, value);
  });

  it("rejects course role escalation, raw-source payloads and ambiguous source IDs", () => {
    const roleEscalation = structuredClone(courseReleaseFixture());
    (roleEscalation.primaryJob as { studentRoleId: string }).studentRoleId =
      "responsible_editor";
    expectRejected(CourseReleaseSchema, roleEscalation);

    expectRejected(CourseReleaseSchema, {
      ...courseReleaseFixture(),
      rawArticle: "不应进入课程发布 DTO 的完整原文",
      prompt: "不应进入课程发布 DTO 的提示词",
    });

    const duplicateSource = structuredClone(courseReleaseFixture());
    duplicateSource.sources[1]!.sourceId = duplicateSource.sources[0]!.sourceId;
    expectRejected(CourseReleaseSchema, duplicateSource);
  });

  it("keeps V2 enrollment reporter-only and rejects client authority claims", () => {
    expectRejected(CourseEnrollmentSchema, {
      ...courseEnrollmentFixture("claimed"),
      primaryRoleId: "responsible_editor",
    });
    expectRejected(CourseEnrollmentSchema, {
      ...courseEnrollmentFixture("claimed"),
      actorId: "student-editor",
      principalId: "principal-forged",
      requestedRoleId: "responsible_editor",
    });
  });

  it("rejects enrollment lifecycle rollback and status-field contradictions", () => {
    expectRejected(CourseEnrollmentSchema, {
      ...courseEnrollmentFixture("completed"),
      submittedAt: "2026-08-09T01:00:00.000Z",
    });
    expectRejected(CourseEnrollmentSchema, {
      ...courseEnrollmentFixture("claimed"),
      activeSessionId: "session-forged",
      startedAt: "2026-08-09T02:01:00.000Z",
    });
  });

  it.each([
    "empty",
    "ready",
    "awaiting_review",
    "completed",
  ] as const)("rejects a current task in %s activity", (status) => {
    expectRejected(LearningActivitySchema, {
      ...learningActivityFixture(status),
      currentTask: learningActivityFixture("active").currentTask,
    });
  });

  it("requires one active task, one current guide step and a matching session", () => {
    const active = learningActivityFixture("active");
    expectRejected(LearningActivitySchema, { ...active, currentTask: null });

    const noCurrentStep = structuredClone(active);
    noCurrentStep.guideSteps[1]!.status = "pending";
    expectRejected(LearningActivitySchema, noCurrentStep);

    expectRejected(LearningActivitySchema, {
      ...active,
      sessionId: "session-not-enrolled",
    });
  });

  it("fails closed on learning release version and hash drift", () => {
    const versionDrift = structuredClone(learningActivityFixture("active"));
    if (versionDrift.status !== "active") throw new Error("fixture drift");
    versionDrift.courseReleaseRef.version += 1;
    expectRejected(LearningActivitySchema, versionDrift);

    const hashDrift = structuredClone(learningActivityFixture("active"));
    if (hashDrift.status !== "active") throw new Error("fixture drift");
    hashDrift.courseReleaseRef.contentHash = "f".repeat(64);
    expectRejected(LearningActivitySchema, hashDrift);
  });

  it("rejects projection, trace and private execution claims in learning activity", () => {
    expectRejected(LearningActivitySchema, {
      ...learningActivityFixture("active"),
      projection: { stateVersion: 999 },
      traceRefs: ["trace-private"],
      privateMemory: "PRIVATE_MEMORY_CANARY",
      token: "TOKEN_CANARY",
    });
  });

  it("keeps student and teacher Episode projections below admin visibility", () => {
    expectRejected(StudentCollaborationEpisodeSchema, {
      ...studentCollaborationEpisodeFixture(),
      affectedAgents: teacherCollaborationEpisodeFixture().affectedAgents,
      execution: adminCollaborationEpisodeFixture().execution,
      prompt: "PROMPT_CANARY",
    });
    expectRejected(TeacherCollaborationEpisodeSchema, {
      ...teacherCollaborationEpisodeFixture(),
      execution: adminCollaborationEpisodeFixture().execution,
      privateMemory: "PRIVATE_MEMORY_CANARY",
    });

    const adminAsTeacher = {
      ...adminCollaborationEpisodeFixture(),
      audience: "teacher",
    };
    expectRejected(AgentCollaborationEpisodeSchema, adminAsTeacher);
  });

  it("keeps student waiting Episode states free of a teacher gate", () => {
    expectRejected(StudentCollaborationEpisodeSchema, {
      ...studentCollaborationEpisodeFixture(),
      status: "waiting",
      triggerEvent: null,
      suggestion: null,
      studentDecision: null,
      teacherGate: studentCollaborationEpisodeFixture().teacherGate,
      authorityWriteback: null,
      failure: null,
    });
  });

  it("keeps failed teacher Episode states write-free", () => {
    expectRejected(TeacherCollaborationEpisodeSchema, {
      ...teacherCollaborationEpisodeFixture(),
      status: "failed",
      failureCode: "agent_execution_failed",
    });
  });

  it.each(["pending", "rejected"] as const)(
    "rejects authority writeback after a %s teacher gate",
    (status) => {
      const episode = structuredClone(teacherCollaborationEpisodeFixture());
      episode.teacherGate = {
        ...episode.teacherGate!,
        status,
        reviewedAt: status === "rejected"
          ? "2026-08-09T02:04:00.000Z"
          : null,
      };
      expectRejected(TeacherCollaborationEpisodeSchema, episode);
    },
  );

  it("keeps admin as a projection audience instead of a World actor kind", () => {
    expect(AdminCollaborationEpisodeSchema.safeParse(
      adminCollaborationEpisodeFixture(),
    ).success).toBe(true);
    expect(ActorKindSchema.safeParse("admin").success).toBe(false);
    expect(ActorKindSchema.options).toEqual([
      "teacher",
      "student",
      "agent",
      "system",
    ]);
  });

  it("freezes six groups, fourteen unique agents and safe topology edges", () => {
    const manifest = AgentTopologyManifestSchema.parse(
      agentTopologyManifestFixture(),
    );
    expect(manifest.groups).toHaveLength(6);
    expect(manifest.agents).toHaveLength(14);
    expect(new Set(manifest.agents.map((agent) => agent.agentId)).size)
      .toBe(14);

    const duplicateGroup = structuredClone(agentTopologyManifestFixture());
    duplicateGroup.groups[1]!.groupId = duplicateGroup.groups[0]!.groupId;
    expectRejected(AgentTopologyManifestSchema, duplicateGroup);

    const danglingEdge = structuredClone(agentTopologyManifestFixture());
    danglingEdge.edges[0]!.sourceAgentId = "agent-not-registered";
    expectRejected(AgentTopologyManifestSchema, danglingEdge);
  });

  it("rejects a topology action allowed and forbidden at the same time", () => {
    const contradictory = structuredClone(agentTopologyManifestFixture());
    contradictory.agents[0]!.allowedActions = ["write_world_directly"];
    expectRejected(AgentTopologyManifestSchema, contradictory);
  });

  it("rejects private execution fields on topology nodes", () => {
    const privateNode = structuredClone(agentTopologyManifestFixture());
    expectRejected(AgentTopologyManifestSchema, {
      ...privateNode,
      agents: privateNode.agents.map((agent, index) => index === 0
        ? {
            ...agent,
            prompt: "PROMPT_CANARY",
            providerApiKey: "SECRET_CANARY",
          }
        : agent),
    });
  });
});
