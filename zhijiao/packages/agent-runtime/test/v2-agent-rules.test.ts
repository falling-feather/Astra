import { describe, expect, it } from "vitest";
import {
  aiCopyrightContractCourseRelease,
  hashCanonical,
  rainEmergencyContractCourseRelease,
  villageSuperContractCourseRelease,
  villagePostpublicationContractCourseRelease,
  xunpuContractCourseRelease,
} from "@ronggang/course-content";
import {
  CrossCourseAgentRuleManifestSchema,
  type CrossCourseAgentRuleManifest,
} from "@ronggang/contracts";
import { buildAgentTopologyManifest } from "../src/v2-topology.js";
import {
  buildCrossCourseAgentRuleManifest,
  verifyCrossCourseAgentRuleManifestIntegrity,
} from "../src/v2-agent-rules.js";

function withCourseReleaseHash<T extends { contentHash: string }>(release: T): T {
  const { contentHash: _contentHash, ...hashInput } = release;
  return {
    ...release,
    contentHash: hashCanonical(hashInput),
  };
}

function contentOnlyManifest(
  generatedAt = "2026-08-09T12:00:00.000Z",
): CrossCourseAgentRuleManifest {
  return buildCrossCourseAgentRuleManifest({
    topology: buildAgentTopologyManifest("2026-08-09T12:00:00.000Z"),
    courseReleases: [
      xunpuContractCourseRelease,
      villageSuperContractCourseRelease,
      villagePostpublicationContractCourseRelease,
      aiCopyrightContractCourseRelease,
      rainEmergencyContractCourseRelease,
    ],
    publishedScenarioRefs: [],
    generatedAt,
  });
}

describe("V2 跨课程智能体规则编译", () => {
  it("编译五课程三十章节并保留原始 affected/max 约束", () => {
    const manifest = contentOnlyManifest();
    expect(manifest.courses).toHaveLength(5);
    expect(manifest.courses.flatMap((course) => course.chapters)).toHaveLength(30);
    expect(manifest.courses.every((course) => (
      course.runtimeEligibility.status === "content_only"
    ))).toBe(true);
    expect(CrossCourseAgentRuleManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("显式把泉州五个辅助引用登记为 supporting capability 且不扩充十四节点", () => {
    const manifest = contentOnlyManifest();
    const xunpu = manifest.courses.find((course) => (
      course.courseReleaseRef.courseId === "course-xunpu-intangible-media"
    ))!;
    const supportIds = new Set(
      xunpu.chapters.flatMap((chapter) => (
        chapter.agentResolutions
          .filter((item) => item.targetKind === "supporting_capability")
          .map((item) => item.sourceAgentId)
      )),
    );
    expect(supportIds).toEqual(new Set([
      "agent-task-planning",
      "agent-evidence-coach",
      "agent-material-understanding",
      "agent-interview-structuring",
      "agent-content-adaptation",
    ]));
    expect(xunpu.chapters.flatMap((chapter) => (
      chapter.resolvedCandidateAgentIds
    ))).not.toEqual(expect.arrayContaining([...supportIds]));
    expect(buildAgentTopologyManifest().agents).toHaveLength(14);
  });

  it("规则清单哈希只绑定冻结规则内容而不绑定生成时间", () => {
    const first = contentOnlyManifest();
    const second = contentOnlyManifest("2026-08-09T12:00:01.000Z");
    expect(second.generatedAt).not.toBe(first.generatedAt);
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(second.topologyHash).toBe(first.topologyHash);
    expect(second.courses[0]!.chapters[0]!.ruleHash)
      .toBe(first.courses[0]!.chapters[0]!.ruleHash);
  });

  it("活动课程引用未在情境目录精确注册时保持 runtime_unavailable", () => {
    const runtimeXunpu = withCourseReleaseHash({
      ...xunpuContractCourseRelease,
      releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime-test",
      version: 2,
      scenarioReleaseRef: {
        scenarioId: "scenario-xunpu-media",
        version: "2.0.0",
        contentHash: "f".repeat(64),
      },
    });
    const manifest = buildCrossCourseAgentRuleManifest({
      topology: buildAgentTopologyManifest("2026-08-09T12:00:00.000Z"),
      courseReleases: [
        runtimeXunpu,
        villageSuperContractCourseRelease,
        aiCopyrightContractCourseRelease,
        rainEmergencyContractCourseRelease,
      ],
      publishedScenarioRefs: [],
      generatedAt: "2026-08-09T12:00:00.000Z",
    });
    expect(manifest.courses[0]!.runtimeEligibility.status)
      .toBe("runtime_unavailable");
  });

  it("拒绝伪造课程哈希、候选超集和动作顺序漂移", () => {
    const runtimeXunpu = withCourseReleaseHash({
      ...xunpuContractCourseRelease,
      releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime-test",
      version: 2,
      scenarioReleaseRef: {
        scenarioId: "scenario-xunpu-media",
        version: "2.0.0",
        contentHash: "e".repeat(64),
      },
    });
    const publishedScenarioRefs = [runtimeXunpu.scenarioReleaseRef];
    const buildStatus = (release: typeof runtimeXunpu) => (
      buildCrossCourseAgentRuleManifest({
        topology: buildAgentTopologyManifest("2026-08-09T12:00:00.000Z"),
        courseReleases: [
          release,
          villageSuperContractCourseRelease,
          aiCopyrightContractCourseRelease,
          rainEmergencyContractCourseRelease,
        ],
        publishedScenarioRefs,
        generatedAt: "2026-08-09T12:00:00.000Z",
      }).courses[0]!.runtimeEligibility.status
    );

    expect(buildStatus({ ...runtimeXunpu, contentHash: "f".repeat(64) }))
      .toBe("version_hash_drift");

    const forgedCandidates = structuredClone(runtimeXunpu);
    forgedCandidates.chapters[0]!.candidateAgentIds.push("agent-extra-forged");
    expect(buildStatus(withCourseReleaseHash(forgedCandidates)))
      .toBe("version_hash_drift");

    const reorderedActions = structuredClone(runtimeXunpu);
    reorderedActions.chapters[0]!.availableActionIds.reverse();
    expect(buildStatus(withCourseReleaseHash(reorderedActions)))
      .toBe("version_hash_drift");
  });

  it("服务读取前重新校验清单规范哈希", () => {
    const manifest = structuredClone(contentOnlyManifest());
    manifest.manifestHash = "f".repeat(64);
    expect(() => verifyCrossCourseAgentRuleManifestIntegrity(manifest)).toThrow(
      /哈希漂移/u,
    );
  });
});
