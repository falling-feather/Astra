import { describe, expect, it } from "vitest";
import {
  professionalTrainingKnowledgeRecords,
  professionalTrainingPackage,
  professionalTrainingTasks,
  validateProfessionalTrainingPackage,
} from "../src/professional-training.js";
import { xunpuFlagshipCourseProjection } from "../src/flagship-course-projection.js";
import { xunpuCourseRelease } from "../src/xunpu-course.js";
import {
  xunpuFlagshipContentV4,
  xunpuV4Artifacts,
  xunpuV4AssessmentCriteria,
} from "../src/xunpu-flagship-v4/index.js";

describe("professional training package", () => {
  it("contains a distinct 10-task reporter workflow and 24 pending knowledge records", () => {
    expect(professionalTrainingTasks).toHaveLength(10);
    expect(professionalTrainingKnowledgeRecords).toHaveLength(24);
    expect(new Set(professionalTrainingTasks.map((task) => task.taskId)).size).toBe(10);
    expect(new Set(professionalTrainingKnowledgeRecords.map((record) => record.knowledgeId)).size).toBe(24);
    expect(professionalTrainingKnowledgeRecords.every((record) => record.reviewStatus === "pending_expert_review")).toBe(true);
  });

  it("validates task-to-knowledge mappings and keeps training rules distinct from source facts", () => {
    const report = validateProfessionalTrainingPackage(professionalTrainingPackage);
    expect(report).toEqual({ valid: true, issues: [] });
    expect(professionalTrainingTasks.every((task) => (
      task.knowledgeIds.length > 0
      && task.courseSectionRefs.length > 0
      && task.artifacts.length > 0
      && task.rubricDimensions.length > 0
      && task.trainingRules.every((rule) => rule.ruleType === "course_training_design")
    ))).toBe(true);
  });

  it("keeps blocked official PDFs registered without fabricating source byte hashes", () => {
    const blocked = professionalTrainingKnowledgeRecords.filter((record) => record.source.accessStatus === "blocked_on_check_date");
    expect(blocked.length).toBeGreaterThanOrEqual(2);
    expect(blocked.every((record) => record.source.sourceByteHash === null)).toBe(true);
    expect(blocked.every((record) => record.source.locator.includes("页码以摄入原件复核为准"))).toBe(true);
  });

  it("maps every task to the real release, projection, manifest, and v4 rubric IDs", () => {
    const releaseSectionIds = new Set(xunpuCourseRelease.sections.map((section) => section.sectionId));
    const projectionSectionIds = new Set(xunpuFlagshipCourseProjection.chapters.map((chapter) => chapter.chapterId));
    const projectionArtifactIds = new Set(xunpuFlagshipCourseProjection.artifacts.map((artifact) => artifact.artifactId));
    const artifactIds = new Set(xunpuV4Artifacts.map((artifact) => artifact.artifactId));
    const manifestArtifactIds = new Set(xunpuFlagshipContentV4.artifacts.map((artifact) => artifact.artifactId));
    const criterionIds = new Set(xunpuV4AssessmentCriteria.map((criterion) => criterion.criterionId));
    const manifestCriterionIds = new Set(xunpuFlagshipContentV4.assessmentCriteria.map((criterion) => criterion.criterionId));

    for (const task of professionalTrainingTasks) {
      expect(task.courseSectionRefs.every((sectionId) => releaseSectionIds.has(sectionId))).toBe(true);
      expect(task.courseSectionRefs.every((sectionId) => projectionSectionIds.has(sectionId))).toBe(true);
      expect(task.artifacts.every((artifactId) => artifactIds.has(artifactId))).toBe(true);
      expect(task.artifacts.every((artifactId) => projectionArtifactIds.has(artifactId))).toBe(true);
      expect(task.artifacts.every((artifactId) => manifestArtifactIds.has(artifactId))).toBe(true);
      expect(task.rubricDimensions.every((criterionId) => criterionIds.has(criterionId))).toBe(true);
      expect(task.rubricDimensions.every((criterionId) => manifestCriterionIds.has(criterionId))).toBe(true);
    }
  });

  it("keeps collaboration roles as workflow labels rather than agent identifiers", () => {
    const roleLabels = new Set(["reporter", "editor", "fact_checker", "rights_reviewer", "platform_operator"]);
    expect(professionalTrainingTasks.every((task) => task.collaborationRoles.every((role) => roleLabels.has(role)))).toBe(true);
  });
});
