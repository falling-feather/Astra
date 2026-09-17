import { describe, expect, it } from "vitest";
import {
  StudentAgentCollaborationEpisodeV3Schema,
  StudentGroundedCollaborationEpisodeV4Schema,
} from "../src/index.js";
import { studentCollaborationEpisodeV3Fixture } from "./v3-simulation.fixture.js";
import { studentGroundedCollaborationEpisodeV4Fixture } from "./v4-flagship.fixture.js";

describe("student decision provenance", () => {
  it("keeps unlabelled historical rationale unknown instead of claiming student submission", () => {
    const legacy = studentCollaborationEpisodeV3Fixture();
    const parsed = StudentAgentCollaborationEpisodeV3Schema.parse(legacy);
    expect(parsed.studentDecision?.rationaleSource).toBeUndefined();
    expect(parsed.studentDecision?.rationale).toBe(legacy.studentDecision?.rationale);
  });

  it("preserves explicit submission provenance across both public decision projections", () => {
    const decision = {
      decisionRef: "decision-provenance-test",
      decision: "request_evidence" as const,
      rationale: "这份材料还缺少原始出处，请先补充可定位来源。",
      rationaleSource: "student_submitted" as const,
      decidedAt: "2026-09-07T04:00:00.000Z",
    };
    const v3 = StudentAgentCollaborationEpisodeV3Schema.parse({
      ...studentCollaborationEpisodeV3Fixture(),
      studentDecision: decision,
    });
    const v4 = StudentGroundedCollaborationEpisodeV4Schema.parse({
      ...studentGroundedCollaborationEpisodeV4Fixture(),
      status: "decided",
      studentDecision: decision,
    });
    expect(v3.studentDecision).toEqual(decision);
    expect(v4.studentDecision).toEqual(decision);
    expect(() => StudentAgentCollaborationEpisodeV3Schema.parse({
      ...v3,
      studentDecision: { ...decision, rationaleSource: "verified_human_author" },
    })).toThrow();
  });
});
