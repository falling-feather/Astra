import { describe, expect, it } from "vitest";
import { hashCanonical } from "../src/canonical.js";
import { mediaTeachingContent, mediaTeachingTaskTemplates, teachingTaskKnowledgeIds, teachingWorkContrasts } from "../src/media-teaching-tasks.js";
import { professionalTrainingKnowledgeRecords, professionalTrainingTasks } from "../src/professional-training.js";
import { xunpuExplorationLesson, validateExplorationLesson } from "../src/xunpu-exploration-lesson.js";
import { xunpuFlagshipContentManifestV3 } from "../src/xunpu-flagship-content-v3.js";
import { xunpuV4AssessmentCriteria } from "../src/xunpu-flagship-v4/work-samples.js";

describe("job-to-teaching content", () => {
  it("provides two meaningfully different paths using only current world, task and knowledge references", () => {
    const materials = new Set(xunpuExplorationLesson.materials.map(item => item.id));
    const people = new Set(xunpuExplorationLesson.people.map(item => item.id));
    const strategies = new Set(xunpuExplorationLesson.strategies.map(item => item.id));
    const knowledge = new Set(professionalTrainingKnowledgeRecords.map(item => item.knowledgeId));
    expect(mediaTeachingTaskTemplates).toHaveLength(2);
    for (const template of mediaTeachingTaskTemplates) {
      for (const stage of template.stages) expect(professionalTrainingTasks.some(task => task.taskId === stage.taskRef), stage.taskRef).toBe(true);
      expect(template.stages.map(stage => stage.taskRef)).toContain("pt-task-10-publish-correct");
      expect(template.stages.map(stage => stage.taskRef)).toContain("pt-task-09-metrics-review");
      expect(teachingTaskKnowledgeIds(template).every(id => knowledge.has(id))).toBe(true);
      expect(template.recommendedStrategies.every(id => strategies.has(id))).toBe(true);
      for (const source of template.sourcePlan) {
        expect(people.has(source.personId)).toBe(true);
        expect(source.materialIds.every(id => materials.has(id))).toBe(true);
      }
    }
    const resident = mediaTeachingTaskTemplates.find(item => item.templateId === "community-story")!;
    const service = mediaTeachingTaskTemplates.find(item => item.templateId === "public-service")!;
    expect(resident.defaultMinutes).not.toBe(service.defaultMinutes);
    expect(resident.focusCriteria).not.toEqual(service.focusCriteria);
    expect(service.sourcePlan.some(source => source.personId === "entity-community-source")).toBe(false);
    expect(service.recommendedStrategies).not.toEqual(resident.recommendedStrategies);
    expect(validateExplorationLesson(xunpuExplorationLesson)).toEqual([]);
  });

  it("grounds concrete contrasting excerpts in editable fields and all six criteria, without treating them as real work", () => {
    const criteria = new Set(xunpuV4AssessmentCriteria.map(item => item.criterionId));
    expect(new Set(teachingWorkContrasts.map(item => item.criterionId))).toEqual(criteria);
    for (const example of teachingWorkContrasts) {
      const artifact = xunpuFlagshipContentManifestV3.artifacts.find(item => item.artifactId === example.artifactId);
      expect(artifact?.editableFields.some(field => field.fieldId === example.fieldId), example.exampleId).toBe(true);
      expect(example.materialIds.every(id => xunpuExplorationLesson.materials.some(item => item.id === id))).toBe(true);
      expect(example.knowledgeIds.every(id => professionalTrainingKnowledgeRecords.some(item => item.knowledgeId === id))).toBe(true);
      expect(example.problematicExcerpt).not.toBe(example.boundedExcerpt);
      expect(example.evidenceCondition.length).toBeGreaterThan(0);
    }
    expect(mediaTeachingContent.reviewStatus).toBe("pending_expert_review");
    expect(mediaTeachingContent.contentHash).toBe(hashCanonical({ templates: mediaTeachingTaskTemplates, contrasts: teachingWorkContrasts }));
    expect(mediaTeachingContent.boundary).toContain("不是现实委托");
  });
});
