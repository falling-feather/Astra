import { deepFreeze, hashCanonical } from "./canonical.js";
import type { CourseContentRelease, CourseSection, KnowledgeRecord } from "./types.js";
import { aiCopyrightCourseRelease } from "./ai-copyright-course.js";
import { rainEmergencyCourseRelease } from "./rain-emergency-course.js";
import { villageSuperCourseRelease } from "./village-super-course.js";
import { villagePostpublicationCourseRelease } from "./village-postpublication-case.js";
import { xunpuCourseRelease } from "./xunpu-course.js";

export interface ContractCourseSourceRecord {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  accessedAt: string;
  locator: string;
  sourceVersion: string;
  reviewStatus: "verified" | "pending_expert_review" | "retired";
  copyrightNote: string;
  excerpt: string | null;
}

export interface ContractCourseRubricCriterion {
  criterionId: string;
  title: string;
  description: string;
  weight: number;
  evidenceTypes: string[];
}

export interface ContractCourseChapter {
  chapterId: string;
  order: number;
  title: string;
  objective: string;
  taskBrief: string;
  publicSourceRefs: string[];
  hiddenFactRefs: string[];
  availableActionIds: string[];
  dynamicEventIds: string[];
  candidateAgentIds: string[];
  teacherGateIds: string[];
  deliverableIds: string[];
  evidenceRequirements: string[];
  rubricCriteria: ContractCourseRubricCriterion[];
  transferReflection: string;
  finalChapter: boolean;
}

export interface ContractCourseRelease {
  schemaVersion: "course-release/2.0.0";
  releaseStatus: "released";
  courseId: string;
  releaseId: string;
  version: number;
  contentHash: string;
  title: string;
  summary: string;
  primaryJob: {
    jobId: "integrated_media_reporter";
    title: "融媒体采编岗";
    studentRoleId: "reporter";
  };
  scenarioReleaseRef: {
    scenarioId: string;
    version: string;
    contentHash: string;
  };
  sources: ContractCourseSourceRecord[];
  chapters: ContractCourseChapter[];
  studentDecisionOptions: ["accept", "request_evidence", "reject"];
  publishedAt: string;
}

export interface ContentOnlyScenarioReference {
  scenarioId: string;
  version: string;
}

const contentOnlyScenarioReferences: Readonly<
  Record<string, ContentOnlyScenarioReference>
> = deepFreeze({
  "course-xunpu-intangible-media": {
    scenarioId: "scenario-xunpu-media",
    version: "2.0.0-content.1",
  },
  "course-village-super-multiplatform": {
    scenarioId: "scenario-village-super-multiplatform",
    version: "2.0.0-content.1",
  },
  "course-village-super-postpublication-context": {
    scenarioId: "scenario-village-super-postpublication-context",
    version: "1.0.0-content.1",
  },
  "course-ai-tourism-copyright-governance": {
    scenarioId: "scenario-ai-tourism-copyright-governance",
    version: "2.0.0-content.1",
  },
  "course-scenic-rain-emergency-reporting": {
    scenarioId: "scenario-scenic-rain-emergency-reporting",
    version: "2.0.0-content.1",
  },
});

function publishedAtOf(record: KnowledgeRecord): string | null {
  return /^\d{4}-\d{2}-\d{2}$/u.test(record.source.publicationDate)
    ? record.source.publicationDate
    : null;
}

function sourceRecordOf(record: KnowledgeRecord): ContractCourseSourceRecord {
  return {
    sourceId: record.knowledgeId,
    title: `${record.source.title}｜${record.topic}`,
    publisher: record.source.publisher,
    url: record.source.url,
    publishedAt: publishedAtOf(record),
    accessedAt: record.source.accessedAt,
    locator: record.source.locator,
    sourceVersion: record.source.sourceVersion,
    reviewStatus: record.reviewStatus,
    copyrightNote: record.source.rightsNote,
    excerpt: null,
  };
}

function evidenceTypesOf(section: CourseSection): string[] {
  return [...new Set(section.evidenceRequirements.flatMap(
    (requirement) => requirement.acceptedSourceKinds,
  ))];
}

function chapterOf(section: CourseSection): ContractCourseChapter {
  const evidenceTypes = evidenceTypesOf(section);
  return {
    chapterId: section.sectionId,
    order: section.order,
    title: section.title,
    objective: section.objectives.map((objective) => objective.description).join("；"),
    taskBrief: section.taskBrief,
    publicSourceRefs: [...section.publicSourceKnowledgeIds],
    hiddenFactRefs: section.hiddenFacts.map((fact) => fact.factId),
    availableActionIds: section.actions.map((action) => action.actionId),
    dynamicEventIds: section.dynamicEvents.map((event) => event.eventId),
    candidateAgentIds: [...new Set(section.agentSelectionRules.flatMap(
      (rule) => rule.candidateAgentIds,
    ))],
    teacherGateIds: [section.teacherGate.gateId],
    deliverableIds: [section.artifact.artifactId],
    evidenceRequirements: section.evidenceRequirements.map((requirement) => (
      `${requirement.label}：${requirement.description}（至少 ${requirement.minimumCount} 项）`
    )),
    rubricCriteria: section.rubric.map((criterion) => ({
      criterionId: criterion.criterionId,
      title: criterion.label,
      description: `${criterion.observable}；失败关闭：${criterion.failClosedWhen}`,
      weight: criterion.weight,
      evidenceTypes: [...evidenceTypes],
    })),
    transferReflection: `${section.migrationReflection.prompt} 迁移场景：${section.migrationReflection.targetContext}；比较维度：${section.migrationReflection.requiredComparisonDimensions.join("、")}。`,
    finalChapter: section.artifact.finalCourseArtifact,
  };
}

export function toContractCourseRelease(
  content: CourseContentRelease,
  scenarioReference: ContentOnlyScenarioReference =
    contentOnlyScenarioReferences[content.releaseRef.courseId]
    ?? {
      scenarioId: `scenario-content-placeholder-${content.releaseRef.courseId}`,
      version: content.releaseRef.version,
    },
): Readonly<ContractCourseRelease> {
  const scenarioReleaseRef = {
    scenarioId: scenarioReference.scenarioId,
    version: scenarioReference.version,
    contentHash: hashCanonical({
      courseId: content.releaseRef.courseId,
      sections: content.sections.map((section) => ({
        sectionId: section.sectionId,
        hiddenFacts: section.hiddenFacts,
        dynamicEvents: section.dynamicEvents,
        agentSelectionRules: section.agentSelectionRules,
        teacherGate: section.teacherGate,
      })),
    }),
  };
  return deepFreeze({
    schemaVersion: "course-release/2.0.0",
    releaseStatus: "released",
    courseId: content.releaseRef.courseId,
    releaseId: content.releaseRef.releaseId,
    version: 1,
    contentHash: content.releaseRef.contentHash,
    title: content.title,
    summary: content.summary,
    primaryJob: {
      jobId: "integrated_media_reporter",
      title: "融媒体采编岗",
      studentRoleId: "reporter",
    },
    scenarioReleaseRef,
    sources: content.knowledgeRecords.map(sourceRecordOf),
    chapters: content.sections.map(chapterOf),
    studentDecisionOptions: ["accept", "request_evidence", "reject"],
    publishedAt: "2026-08-09T04:00:00.000Z",
  });
}

export const xunpuContractCourseRelease = toContractCourseRelease(
  xunpuCourseRelease,
);

/**
 * These three releases intentionally point at deterministic content-only
 * scenario placeholders. They satisfy the frozen CourseRelease contract but
 * must remain in the learner's `ready` state until BE publishes a real runtime
 * scenario release and creates a new immutable course release.
 */
export const villageSuperContractCourseRelease = toContractCourseRelease(
  villageSuperCourseRelease,
);
export const villagePostpublicationContractCourseRelease = toContractCourseRelease(
  villagePostpublicationCourseRelease,
);
export const aiCopyrightContractCourseRelease = toContractCourseRelease(
  aiCopyrightCourseRelease,
);
export const rainEmergencyContractCourseRelease = toContractCourseRelease(
  rainEmergencyCourseRelease,
);

export const migrationContractCourseReleases = deepFreeze([
  villageSuperContractCourseRelease,
  villagePostpublicationContractCourseRelease,
  aiCopyrightContractCourseRelease,
  rainEmergencyContractCourseRelease,
]);

export interface PublishedScenarioReference {
  scenarioId: string;
  version: string;
  contentHash: string;
}

export interface RuntimeCoursePublication {
  releaseId: string;
  version: number;
  publishedAt: string;
}

/**
 * Creates an immutable CourseRelease successor bound to a real runtime
 * ScenarioPackage. The content-only snapshot remains unchanged and continues
 * to document the authored source release.
 */
export function publishRuntimeContractCourseRelease(
  content: CourseContentRelease,
  scenarioReleaseRef: PublishedScenarioReference,
  publication: RuntimeCoursePublication,
): Readonly<ContractCourseRelease> {
  const publishable = {
    ...toContractCourseRelease(content),
    releaseId: publication.releaseId,
    version: publication.version,
    scenarioReleaseRef: {
      scenarioId: scenarioReleaseRef.scenarioId,
      version: scenarioReleaseRef.version,
      contentHash: scenarioReleaseRef.contentHash,
    },
    publishedAt: publication.publishedAt,
  };
  const { contentHash: _contentOnlyHash, ...hashInput } = publishable;
  return deepFreeze({
    ...publishable,
    contentHash: hashCanonical(hashInput),
  });
}

/**
 * Creates a new immutable course release bound to a real catalog scenario.
 * The CONTENT-006 release remains available as the historical content-only
 * snapshot and is never silently rewritten in place.
 */
export function publishXunpuContractCourseRelease(
  scenarioReleaseRef: PublishedScenarioReference,
): Readonly<ContractCourseRelease> {
  const publishable = {
    ...xunpuContractCourseRelease,
    releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime.1",
    version: 2,
    scenarioReleaseRef: {
      scenarioId: scenarioReleaseRef.scenarioId,
      version: scenarioReleaseRef.version,
      contentHash: scenarioReleaseRef.contentHash,
    },
    publishedAt: "2026-08-09T08:55:00.000Z",
  };
  const { contentHash: _contentOnlyHash, ...hashInput } = publishable;
  return deepFreeze({
    ...publishable,
    contentHash: hashCanonical(hashInput),
  });
}

/**
 * Publishes the immutable interactive successor used by new V2 student
 * journeys. Runtime.1 remains available for historical sessions and is never
 * rewritten when the experience design becomes executable.
 */
export function publishInteractiveXunpuContractCourseRelease(
  scenarioReleaseRef: PublishedScenarioReference,
): Readonly<ContractCourseRelease> {
  const publishable = {
    ...xunpuContractCourseRelease,
    releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime.2",
    version: 3,
    scenarioReleaseRef: {
      scenarioId: scenarioReleaseRef.scenarioId,
      version: scenarioReleaseRef.version,
      contentHash: scenarioReleaseRef.contentHash,
    },
    publishedAt: "2026-08-09T10:20:00.000Z",
  };
  const { contentHash: _contentOnlyHash, ...hashInput } = publishable;
  return deepFreeze({
    ...publishable,
    contentHash: hashCanonical(hashInput),
  });
}
