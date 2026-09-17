import type { CoursePortfolioItemKind } from "@ronggang/contracts";
import { deepFreeze } from "./canonical.js";

export interface FlagshipCourseProjectionDefinition {
  version: "flagship-course-projection/1.0.0";
  courseId: string;
  artifacts: readonly {
    artifactId: string;
    chapterId: string;
    kind: CoursePortfolioItemKind;
  }[];
  chapters: readonly {
    chapterId: string;
    requiredArtifactIds: readonly string[];
    requiresFieldInterview?: boolean;
    requiresWorldEnding?: boolean;
  }[];
  fieldInterview: {
    chapterId: string;
    targetEntityIds: readonly string[];
  };
}

/** Curriculum mapping; completion records participation, not professional quality. */
export const xunpuFlagshipCourseProjection: Readonly<FlagshipCourseProjectionDefinition> = deepFreeze({
  version: "flagship-course-projection/1.0.0",
  courseId: "course-xunpu-intangible-media",
  artifacts: [
    { artifactId: "artifact-topic-brief", chapterId: "xunpu-topic-brief", kind: "task_outcome" },
    { artifactId: "artifact-source-matrix", chapterId: "xunpu-source-map", kind: "task_outcome" },
    { artifactId: "artifact-interview-plan-log", chapterId: "xunpu-interview-plan", kind: "interview_record" },
    { artifactId: "artifact-fact-check-sheet", chapterId: "xunpu-fact-check", kind: "task_outcome" },
    { artifactId: "artifact-rights-ledger", chapterId: "xunpu-fact-check", kind: "task_outcome" },
    { artifactId: "artifact-feature-story", chapterId: "xunpu-story-revision", kind: "article" },
    { artifactId: "artifact-multiplatform-package", chapterId: "xunpu-story-revision", kind: "short_video_plan" },
    { artifactId: "artifact-publication-correction-decision", chapterId: "xunpu-publish-review", kind: "task_outcome" },
    { artifactId: "artifact-transfer-reflection", chapterId: "xunpu-publish-review", kind: "task_outcome" },
  ],
  chapters: [
    { chapterId: "xunpu-topic-brief", requiredArtifactIds: ["artifact-topic-brief"] },
    { chapterId: "xunpu-source-map", requiredArtifactIds: ["artifact-source-matrix"] },
    { chapterId: "xunpu-interview-plan", requiredArtifactIds: ["artifact-interview-plan-log"] },
    { chapterId: "xunpu-field-reporting", requiredArtifactIds: ["artifact-interview-plan-log"], requiresFieldInterview: true },
    { chapterId: "xunpu-fact-check", requiredArtifactIds: ["artifact-fact-check-sheet"] },
    { chapterId: "xunpu-story-revision", requiredArtifactIds: ["artifact-feature-story"] },
    { chapterId: "xunpu-publish-review", requiredArtifactIds: ["artifact-publication-correction-decision", "artifact-transfer-reflection"], requiresWorldEnding: true },
  ],
  fieldInterview: {
    chapterId: "xunpu-field-reporting",
    targetEntityIds: ["entity-inheritor", "entity-community-source", "entity-shopkeeper", "entity-researcher"],
  },
});
