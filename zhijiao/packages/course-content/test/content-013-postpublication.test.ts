import { describe, expect, it } from "vitest";
import {
  hashCourseContentRelease,
  validateCourseContentRelease,
  villagePostpublicationCourseRelease,
  villagePostpublicationKnowledgeRecords,
  hashXunpuFlagshipContentV4,
  xunpuFlagshipContentV4,
  xunpuV4PostPublicationCaseDossier,
} from "../src/index.js";

describe("CONTENT-013 村超发布后语境回应案例", () => {
  it("publishes an independent five-chapter content release with executable evidence lanes", () => {
    const report = validateCourseContentRelease(villagePostpublicationCourseRelease, {
      expectedCourseId: "course-village-super-postpublication-context",
      expectedSectionCount: 5,
      minimumKnowledgeRecordCount: 10,
    });
    expect(report).toEqual({
      valid: true,
      sectionCount: 5,
      knowledgeRecordCount: 10,
      qualifiedKnowledgeRecordCount: 10,
      referencedKnowledgeRecordCount: 10,
      dynamicEventCount: 5,
      issues: [],
    });
    expect(villagePostpublicationCourseRelease.releaseRef.courseId)
      .not.toBe("course-village-super-multiplatform");
    expect(villagePostpublicationCourseRelease.sections).toHaveLength(5);
    expect(villagePostpublicationCourseRelease.sections.every((section) => (
      section.actions.length === 3
      && section.evidenceRequirements.length === 3
      && section.rubric.length === 4
      && section.teacherGate.checks.length >= 3
      && section.artifact.completionCriteria.length >= 3
    ))).toBe(true);
    expect(villagePostpublicationCourseRelease.sections.at(-1)?.artifact.finalCourseArtifact)
      .toBe(true);
    expect(hashCourseContentRelease(villagePostpublicationCourseRelease))
      .toBe(villagePostpublicationCourseRelease.releaseRef.contentHash);
    expect(villagePostpublicationKnowledgeRecords.map((record) => record.knowledgeId))
      .toEqual(expect.arrayContaining([
        "village-postpublication-k001-context-triage",
        "village-postpublication-k010-transfer-hypothesis",
      ]));
  });

  it("keeps each chapter executable with separate source, decision and output lanes", () => {
    expect(villagePostpublicationCourseRelease.sections.every((section) => (
      section.actions.every((action) => action.requiredKnowledgeIds.length > 0)
      && section.actions.every((action) => action.producesEvidenceIds.length === 1)
      && section.dynamicEvents[0]?.trigger.kind === "on_action"
      && section.teacherGate.rejectReturnsToActionId.length > 0
    ))).toBe(true);
    expect(villagePostpublicationCourseRelease.sections.filter((section) => (
      section.dynamicEvents[0]?.teacherApprovalRequired
    ))).toHaveLength(3);
    expect(villagePostpublicationCourseRelease.sections.map((section) => section.sectionId))
      .not.toContain("village-super-platform-adaptation");
  });

  it("keeps three deep dossier scenarios and teacher-only notes outside student materials", () => {
    expect(hashXunpuFlagshipContentV4(xunpuFlagshipContentV4))
      .toBe(xunpuFlagshipContentV4.contentHash);
    expect(xunpuV4PostPublicationCaseDossier.scenarios).toHaveLength(3);
    expect(xunpuV4PostPublicationCaseDossier.studentMaterials.length).toBeGreaterThanOrEqual(8);
    expect(xunpuV4PostPublicationCaseDossier.scenarios.every((scenario) => (
      scenario.studentMaterialIds.length >= 3
      && scenario.sourceClaimComparisons.length >= 2
      && scenario.conflicts.length >= 2
      && scenario.legalAlternativeRoutes.length >= 3
      && scenario.workRequirements.length >= 3
      && scenario.teacherObservationPoints.length >= 3
    ))).toBe(true);
    expect(xunpuV4PostPublicationCaseDossier.studentMaterials.every((material) => (
      material.sourceRefs.length > 0
      && material.sourceRefs.every((source) => source.url.startsWith("https://"))
      && material.simulationBoundary.includes("教学仿真")
    ))).toBe(true);
    expect(JSON.stringify(xunpuV4PostPublicationCaseDossier.studentMaterials))
      .not.toContain("teacherOnlyNotes");
    expect(xunpuV4PostPublicationCaseDossier.teacherOnlyNotes).toHaveLength(3);
  });
});
