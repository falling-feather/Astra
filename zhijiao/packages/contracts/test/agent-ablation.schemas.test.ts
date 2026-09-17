import { describe, expect, it } from "vitest";
import {
  ActorKindSchema,
  AgentAblationEvidenceSchema,
  CrossCourseAgentRuleManifestSchema,
} from "../src/index.js";
import {
  crossCourseAgentRuleManifestFixture,
  insufficientAgentAblationEvidenceFixture,
} from "./agent-ablation.fixture.js";

describe("V2 跨课程规则与消融安全契约", () => {
  it("接受五课程三十章节和零样本不足证据快照", () => {
    const manifest = crossCourseAgentRuleManifestFixture();
    expect(manifest.courses).toHaveLength(5);
    expect(manifest.courses.flatMap((course) => course.chapters)).toHaveLength(30);
    expect(AgentAblationEvidenceSchema.parse(
      insufficientAgentAblationEvidenceFixture(),
    ).conclusion).toBe("insufficient_evidence");
    const evidence = insufficientAgentAblationEvidenceFixture();
    expect(evidence.controls.conditionLabelsHidden).toBe(false);
    expect(evidence.blindReviewStatus).toBe("not_configured");
    expect(evidence.groups.map((group) => group.conditionCode)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("拒绝版本漂移、缺课和额外私密字段", () => {
    const manifest = structuredClone(crossCourseAgentRuleManifestFixture());
    expect(() => CrossCourseAgentRuleManifestSchema.parse({
      ...manifest,
      schemaVersion: "cross-course-agent-rule-manifest/2.0.1",
    })).toThrow();
    expect(() => CrossCourseAgentRuleManifestSchema.parse({
      ...manifest,
      courses: manifest.courses.slice(0, 3),
    })).toThrow();
    expect(() => AgentAblationEvidenceSchema.parse({
      ...insufficientAgentAblationEvidenceFixture(),
      rawTrace: "private",
    })).toThrow();
  });

  it("拒绝把辅助能力静默计入十四节点或伪标已解析", () => {
    const manifest = structuredClone(crossCourseAgentRuleManifestFixture());
    const chapter = manifest.courses[0]!.chapters[0]!;
    chapter.sourceCandidateAgentIds = ["agent-evidence-coach"];
    chapter.sourceAffectedAgentIds = ["agent-evidence-coach"];
    chapter.agentResolutions = [{
      sourceAgentId: "agent-evidence-coach",
      targetKind: "supporting_capability",
      targetAgentId: "agent-evidence-coach",
      status: "exact",
      enabled: true,
    }];
    chapter.resolvedCandidateAgentIds = ["agent-evidence-coach"];
    chapter.resolvedAffectedAgentIds = ["agent-evidence-coach"];
    expect(() => CrossCourseAgentRuleManifestSchema.parse(manifest)).toThrow();

    chapter.resolvedCandidateAgentIds = [];
    chapter.resolvedAffectedAgentIds = [];
    chapter.agentResolutions[0] = {
      ...chapter.agentResolutions[0]!,
      status: "unresolved",
      targetAgentId: "agent-evidence-coach",
    };
    expect(() => CrossCourseAgentRuleManifestSchema.parse(manifest)).toThrow();
  });

  it("拒绝零样本伪造通过、结论或指标", () => {
    const evidence = structuredClone(insufficientAgentAblationEvidenceFixture());
    evidence.runStatus = "completed";
    evidence.conclusion = "hypothesis_supported";
    evidence.gates = evidence.gates.map((gate) => ({ ...gate, status: "passed" }));
    expect(() => AgentAblationEvidenceSchema.parse(evidence)).toThrow();

    const metrics = structuredClone(insufficientAgentAblationEvidenceFixture());
    metrics.groups[0]!.metrics.taskCompletionRate = 1;
    expect(() => AgentAblationEvidenceSchema.parse(metrics)).toThrow();

    const fakeBlind = structuredClone(
      insufficientAgentAblationEvidenceFixture(),
    );
    Reflect.set(fakeBlind.controls, "conditionLabelsHidden", true);
    expect(() => AgentAblationEvidenceSchema.parse(fakeBlind)).toThrow();
  });

  it("管理员仍是能力主体而不是世界 ActorKind", () => {
    expect(() => ActorKindSchema.parse("admin")).toThrow();
  });
});
