import { describe, expect, it } from "vitest";
import {
  CourseReleaseSchema,
  V3SimulationContractBundleSchema,
  V4FlagshipContractBundleSchema,
} from "../src/index.js";
import { courseReleaseFixture } from "./v2-learning.fixture.js";
import { v3SimulationContractBundleFixture } from "./v3-simulation.fixture.js";
import {
  refusedSemanticActionDecisionV4Fixture,
  v4FlagshipContractBundleFixture,
} from "./v4-flagship.fixture.js";

describe("V4 旗舰端到端引用闭环", () => {
  it("接受语义行动—自主世界—知识协作—媒体—评价—第二场闭环", () => {
    const bundle = V4FlagshipContractBundleSchema.parse(
      v4FlagshipContractBundleFixture(),
    );
    expect(bundle.semanticActionDecision.status).toBe("accepted");
    expect(bundle.autonomousWorldDecision.status).toBe("scheduled");
    expect(bundle.teacherCollaborationEpisode.status).toBe(
      "joint_proposal_ready",
    );
    expect(bundle.mediaWorkRevision.status).toBe("submitted");
    expect(bundle.assessmentDecision.status).toBe("final");
    expect(bundle.secondSessionHandoff.status).toBe("provisioned");
  });

  it("拒绝内容、发布版或世界状态漂移", () => {
    const contentDrift = structuredClone(v4FlagshipContractBundleFixture());
    contentDrift.adminCollaborationEpisode.flagshipContentRef.contentHash =
      "0".repeat(64);
    expect(() => V4FlagshipContractBundleSchema.parse(contentDrift)).toThrow();

    const releaseDrift = structuredClone(v4FlagshipContractBundleFixture());
    releaseDrift.mediaWorkRevision.flagshipContentRef.simulationReleaseRef.version = 99;
    expect(() => V4FlagshipContractBundleSchema.parse(releaseDrift)).toThrow();

    const stateDrift = structuredClone(v4FlagshipContractBundleFixture());
    stateDrift.semanticActionDecision.sourceWorldStateVersion = 8;
    expect(() => V4FlagshipContractBundleSchema.parse(stateDrift)).toThrow();
  });

  it("拒绝跨会话、跨绑定和换请求拼接", () => {
    const sessionDrift = structuredClone(v4FlagshipContractBundleFixture());
    sessionDrift.teacherCollaborationEpisode.sessionId = "session-other";
    expect(() => V4FlagshipContractBundleSchema.parse(sessionDrift)).toThrow();

    const bindingDrift = structuredClone(v4FlagshipContractBundleFixture());
    bindingDrift.mediaWorkRevision.bindingId = "binding-other";
    expect(() => V4FlagshipContractBundleSchema.parse(bindingDrift)).toThrow();

    const requestDrift = structuredClone(v4FlagshipContractBundleFixture());
    requestDrift.semanticActionDecision.requestId = "semantic-request-other";
    expect(() => V4FlagshipContractBundleSchema.parse(requestDrift)).toThrow();
  });

  it("三角色必须来自同一 Episode 和同一联合提案", () => {
    const episodeDrift = structuredClone(v4FlagshipContractBundleFixture());
    episodeDrift.adminCollaborationEpisode.episodeId = "episode-forged";
    expect(() => V4FlagshipContractBundleSchema.parse(episodeDrift)).toThrow();

    const proposalDrift = structuredClone(v4FlagshipContractBundleFixture());
    if (proposalDrift.studentCollaborationEpisode.suggestion === null) {
      throw new Error("fixture drift");
    }
    proposalDrift.studentCollaborationEpisode.suggestion.sourceJointProposalRef =
      "joint-proposal-forged";
    expect(() => V4FlagshipContractBundleSchema.parse(proposalDrift)).toThrow();
  });

  it("盲评只能消费精确作品修订，评价只能消费精确盲案", () => {
    const mediaDrift = structuredClone(v4FlagshipContractBundleFixture());
    mediaDrift.blindAssessmentInput.artifactRevisions[0]!.contentHash =
      "0".repeat(64);
    expect(() => V4FlagshipContractBundleSchema.parse(mediaDrift)).toThrow();

    const blindDrift = structuredClone(v4FlagshipContractBundleFixture());
    blindDrift.assessmentDecision.blindInputHash = "0".repeat(64);
    expect(() => V4FlagshipContractBundleSchema.parse(blindDrift)).toThrow();
  });

  it("拒绝把澄清/拒绝伪装成成功链或用非最终评价开第二场", () => {
    const refused = structuredClone(v4FlagshipContractBundleFixture());
    refused.semanticActionDecision = refusedSemanticActionDecisionV4Fixture();
    expect(() => V4FlagshipContractBundleSchema.parse(refused)).toThrow();

    const provisional = structuredClone(v4FlagshipContractBundleFixture());
    provisional.assessmentDecision.status = "provisional";
    expect(() => V4FlagshipContractBundleSchema.parse(provisional)).toThrow();
  });

  it("第二场必须是真实的新授权会话", () => {
    const renamedFirstSession = structuredClone(
      v4FlagshipContractBundleFixture(),
    );
    if (renamedFirstSession.secondSessionHandoff.provision === null) {
      throw new Error("fixture drift");
    }
    renamedFirstSession.secondSessionHandoff.provision.sessionRef =
      renamedFirstSession.semanticActionRequest.sessionId;
    expect(() => V4FlagshipContractBundleSchema.parse(renamedFirstSession))
      .toThrow();
  });

  it("严格拒绝 Bundle 额外字段和普通端技术载荷", () => {
    expect(() => V4FlagshipContractBundleSchema.parse({
      ...v4FlagshipContractBundleFixture(),
      actorId: "student-forged",
      providerSecret: "secret",
      prompt: "private prompt",
    })).toThrow();
  });

  it("新增 V4 导出不破坏 V2 课程和 V3 闭环只读兼容", () => {
    expect(CourseReleaseSchema.parse(courseReleaseFixture()).schemaVersion)
      .toBe("course-release/2.0.0");
    expect(V3SimulationContractBundleSchema.parse(
      v3SimulationContractBundleFixture(),
    ).simulationRelease.schemaVersion).toBe(
      "world-simulation-release/3.0.0",
    );
  });
});
