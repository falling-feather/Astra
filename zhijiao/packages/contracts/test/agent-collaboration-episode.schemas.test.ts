import { describe, expect, it } from "vitest";
import {
  AdminCollaborationEpisodeSchema,
  AgentCollaborationEpisodeSchema,
  AgentTopologyManifestSchema,
  StudentCollaborationEpisodeSchema,
  TeacherCollaborationEpisodeSchema,
} from "../src/index.js";
import {
  adminCollaborationEpisodeFixture,
  agentTopologyManifestFixture,
  studentCollaborationEpisodeFixture,
  teacherCollaborationEpisodeFixture,
} from "./v2-learning.fixture.js";

describe("agent collaboration episode schemas", () => {
  it("accepts role-specific student, teacher and admin projections", () => {
    expect(AgentCollaborationEpisodeSchema.parse(
      studentCollaborationEpisodeFixture(),
    ).audience).toBe("student");
    expect(AgentCollaborationEpisodeSchema.parse(
      teacherCollaborationEpisodeFixture(),
    ).audience).toBe("teacher");
    expect(AgentCollaborationEpisodeSchema.parse(
      adminCollaborationEpisodeFixture(),
    ).audience).toBe("admin");
  });

  it("keeps candidate pools, provider details and trace references out of student responses", () => {
    const student = studentCollaborationEpisodeFixture();
    for (const forbidden of [
      { affectedAgents: [] },
      { providerId: "provider-x" },
      { traceRefs: ["trace-private"] },
      { prompt: "private prompt" },
      { privateMemory: "private memory" },
    ]) {
      expect(() => StudentCollaborationEpisodeSchema.parse({
        ...student,
        ...forbidden,
      })).toThrow();
    }
  });

  it("requires contributions to come from selected agents and skipped agents to explain exclusion", () => {
    const unrelatedContribution = structuredClone(
      teacherCollaborationEpisodeFixture(),
    );
    unrelatedContribution.contributions[0]!.agent = {
      ...unrelatedContribution.contributions[0]!.agent,
      agentId: "agent-unrelated",
    };
    expect(() => TeacherCollaborationEpisodeSchema.parse(
      unrelatedContribution,
    )).toThrow();

    const invalidSkip = structuredClone(teacherCollaborationEpisodeFixture());
    invalidSkip.affectedAgents[1]!.reasonCode = "affected_object_match";
    expect(() => TeacherCollaborationEpisodeSchema.parse(invalidSkip)).toThrow();
  });

  it("represents no event as one compact waiting state", () => {
    const waiting = {
      ...teacherCollaborationEpisodeFixture(),
      status: "waiting",
      triggerEvent: null,
      affectedAgents: [],
      contributions: [],
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
      failureCode: null,
    };
    expect(TeacherCollaborationEpisodeSchema.parse(waiting).status).toBe(
      "waiting",
    );
    expect(() => TeacherCollaborationEpisodeSchema.parse({
      ...waiting,
      affectedAgents: teacherCollaborationEpisodeFixture().affectedAgents,
    })).toThrow();
  });

  it("limits provider and trace data to admin and verifies execution counts", () => {
    expect(() => TeacherCollaborationEpisodeSchema.parse({
      ...teacherCollaborationEpisodeFixture(),
      execution: adminCollaborationEpisodeFixture().execution,
    })).toThrow();

    expect(() => AdminCollaborationEpisodeSchema.parse({
      ...adminCollaborationEpisodeFixture(),
      execution: {
        ...adminCollaborationEpisodeFixture().execution,
        selectedCount: 9,
      },
    })).toThrow();

    expect(() => AdminCollaborationEpisodeSchema.parse({
      ...adminCollaborationEpisodeFixture(),
      execution: {
        ...adminCollaborationEpisodeFixture().execution,
        mode: "degraded",
        providerId: "iflytek-xingchen",
      },
    })).toThrow();
  });

  it("makes failed episodes write-free and rejects fabricated write references", () => {
    const failed = {
      ...teacherCollaborationEpisodeFixture(),
      status: "failed",
      authorityWriteback: null,
      failureCode: "agent_execution_failed",
    };
    expect(TeacherCollaborationEpisodeSchema.parse(failed).status).toBe(
      "failed",
    );
    expect(() => TeacherCollaborationEpisodeSchema.parse({
      ...failed,
      authorityWriteback:
        teacherCollaborationEpisodeFixture().authorityWriteback,
    })).toThrow();
  });

  it("freezes a unique six-group fourteen-agent topology", () => {
    expect(AgentTopologyManifestSchema.parse(
      agentTopologyManifestFixture(),
    ).agents).toHaveLength(14);

    const duplicateAgent = structuredClone(agentTopologyManifestFixture());
    duplicateAgent.agents[1]!.agentId = duplicateAgent.agents[0]!.agentId;
    expect(() => AgentTopologyManifestSchema.parse(duplicateAgent)).toThrow();

    const brokenEdge = structuredClone(agentTopologyManifestFixture());
    brokenEdge.edges[0]!.targetAgentId = "agent-not-registered";
    expect(() => AgentTopologyManifestSchema.parse(brokenEdge)).toThrow();
  });
});
