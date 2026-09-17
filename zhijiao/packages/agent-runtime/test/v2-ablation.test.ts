import { describe, expect, it } from "vitest";
import {
  courseContentReleases,
  publishRuntimeContractCourseRelease,
} from "@ronggang/course-content";
import {
  AgentAblationEvidenceSchema,
} from "@ronggang/contracts";
import {
  buildInsufficientAgentAblationEvidence,
  InvalidV2AblationObservationSetError,
  validateV2AblationObservationSet,
  V2AblationExperimentId,
  V2AblationMinimumRepetitions,
  verifyAgentAblationEvidenceIntegrity,
  type V2AblationObservation,
} from "../src/v2-ablation.js";
import { buildCrossCourseAgentRuleManifest } from "../src/v2-agent-rules.js";
import { buildAgentTopologyManifest } from "../src/v2-topology.js";

function manifest() {
  const scenarioRefs = courseContentReleases.map((course, index) => ({
    releaseId: `release-scenario-test-${index + 1}`,
    scenarioId: `scenario-test-${course.releaseRef.courseId}`,
    version: "2.0.0",
    schemaVersion: "scenario-package/1.0.0" as const,
    contentHash: `${index + 1}`.repeat(64),
  }));
  const runtimeReleases = courseContentReleases.map((course, index) => (
    publishRuntimeContractCourseRelease(
      course,
      scenarioRefs[index]!,
      {
        releaseId: `release-${course.releaseRef.courseId}-runtime-test`,
        version: 2,
        publishedAt: "2026-08-09T12:00:00.000Z",
      },
    )
  ));
  return buildCrossCourseAgentRuleManifest({
    topology: buildAgentTopologyManifest("2026-08-09T12:00:00.000Z"),
    courseReleases: runtimeReleases,
    publishedScenarioRefs: scenarioRefs,
    generatedAt: "2026-08-09T12:00:00.000Z",
  });
}

describe("V2 三组消融证据", () => {
  it("零 observation 只形成不足证据且不补分", () => {
    const evidence = buildInsufficientAgentAblationEvidence({
      manifest: manifest(),
      generatedAt: "2026-08-09T12:00:00.000Z",
    });
    expect(AgentAblationEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.observationCount).toBe(0);
    expect(evidence.conclusion).toBe("insufficient_evidence");
    expect(evidence.groups.every((group) => group.runCount === 0)).toBe(true);
    expect(evidence.groups.map((group) => group.conditionCode)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(evidence.controls.conditionLabelsHidden).toBe(false);
    expect(evidence.blindReviewStatus).toBe("not_configured");
    expect(JSON.stringify(evidence)).not.toMatch(
      /rawTrace|prompt|privateMemory|conditionKey|providerRequestId/u,
    );
    const drifted = structuredClone(evidence);
    drifted.reportHash = "f".repeat(64);
    expect(() => verifyAgentAblationEvidenceIntegrity(drifted)).toThrow(
      /哈希漂移/u,
    );
  });

  it("拒绝把三条唯一 observation 重复成三十条", () => {
    const ready = manifest();
    const controlVariablesHash = "a".repeat(64);
    const architecturePolicyHashes = {
      A: "b".repeat(64),
      B: "c".repeat(64),
      C: "d".repeat(64),
    };
    const observations = (repetitionCount: number) => ready.courses.flatMap((course) => (
      course.chapters.flatMap((chapter) => (
        Array.from({ length: repetitionCount }, (_, repetitionIndex) => (
          (["A", "B", "C"] as const).map((conditionCode) => ({
            observationId: `observation-${course.courseReleaseRef.courseId}-${chapter.chapterId}-${conditionCode}-${repetitionIndex + 1}`,
            experimentId: V2AblationExperimentId,
            controlVariablesHash,
            architecturePolicyHash: architecturePolicyHashes[conditionCode],
            courseId: course.courseReleaseRef.courseId,
            chapterId: chapter.chapterId,
            eventId: chapter.eventRef.eventId,
            conditionCode,
            repetition: repetitionIndex + 1,
            status: "completed" as const,
          }))
        )).flat()
      ))
    )) satisfies V2AblationObservation[];
    const base = observations(V2AblationMinimumRepetitions);
    expect(() => validateV2AblationObservationSet({
      observations: base,
      manifest: ready,
      controlVariablesHash,
      architecturePolicyHashes,
    })).not.toThrow();
    expect(() => validateV2AblationObservationSet({
      observations: observations(V2AblationMinimumRepetitions - 1),
      manifest: ready,
      controlVariablesHash,
      architecturePolicyHashes,
    })).toThrow(InvalidV2AblationObservationSetError);
    expect(() => validateV2AblationObservationSet({
      observations: [...base, ...base],
      manifest: ready,
      controlVariablesHash,
      architecturePolicyHashes,
    })).toThrow(InvalidV2AblationObservationSetError);
  });

  it("拒绝控制哈希或策略哈希漂移与不齐套条件", () => {
    const ready = manifest();
    const firstCourse = ready.courses[0]!;
    const firstChapter = firstCourse.chapters[0]!;
    const input = {
      observationId: "observation-A",
      experimentId: V2AblationExperimentId,
      controlVariablesHash: "f".repeat(64),
      architecturePolicyHash: "b".repeat(64),
      courseId: firstCourse.courseReleaseRef.courseId,
      chapterId: firstChapter.chapterId,
      eventId: firstChapter.eventRef.eventId,
      conditionCode: "A" as const,
      repetition: 1,
      status: "completed" as const,
    };
    expect(() => validateV2AblationObservationSet({
      observations: [input],
      manifest: ready,
      controlVariablesHash: "a".repeat(64),
      architecturePolicyHashes: {
        A: "b".repeat(64),
        B: "c".repeat(64),
        C: "d".repeat(64),
      },
    })).toThrow(InvalidV2AblationObservationSetError);
  });

  it("拒绝以旧清单哈希伪造运行资格或生成报告", () => {
    const drifted = structuredClone(manifest());
    drifted.courses[0]!.runtimeEligibility = {
      status: "content_only",
      reasonCode: "runtime_scenario_not_published",
      explanation: "伪造为内容占位。",
    };
    expect(() => validateV2AblationObservationSet({
      observations: [],
      manifest: drifted,
      controlVariablesHash: "a".repeat(64),
      architecturePolicyHashes: {
        A: "b".repeat(64),
        B: "c".repeat(64),
        C: "d".repeat(64),
      },
    })).toThrow(/哈希漂移/u);
    expect(() => buildInsufficientAgentAblationEvidence({
      manifest: drifted,
    })).toThrow(/哈希漂移/u);
  });
});
