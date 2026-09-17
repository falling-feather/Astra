import { createHash } from "node:crypto";
import type { CourseRelease, CourseReleaseReference, CourseReviewResult } from "@ronggang/contracts";
import type { ExplorationLesson, FlagshipCourseProjectionDefinition, XunpuFlagshipContentManifestV3 } from "@ronggang/course-content";
import type { SimulationSessionRecord } from "@ronggang/world-core";
import type { FlagshipStudentWorkRecordV3 } from "./flagship-student-work-v3.js";
import type { FlagshipMediaWorkspaceV4 } from "./flagship-media-v4.js";
import { CourseLearningError, type CourseOutcomeArtifactSnapshot, type CourseOutcomeEvidenceSnapshot, type CourseOutcomeRuntimeSnapshot } from "./course-learning.js";
import { resolveFieldEvidence } from "./field-evidence.js";

export interface FlagshipWorldOutcomeSource {
  sessionId: string;
  courseReleaseRef: CourseReleaseReference;
  stateVersion: number;
  ended: boolean;
  paused: boolean;
  occurredAt: string;
  fieldEvidence?: Array<{ evidenceRef: string; label: string; detail: string }>;
  interviews: Array<{
    actionId: string;
    eventId: string;
    utterance: string;
    publicOutcome: string;
    occurredAt: string;
  }>;
}

export function collectFlagshipWorldOutcomeSource(
  record: SimulationSessionRecord,
  actorId: string,
  definition: FlagshipCourseProjectionDefinition,
  fieldLessons?: readonly ExplorationLesson[],
): FlagshipWorldOutcomeSource {
  const committed = new Map(record.queue
    .filter((event) => event.sourceKind === "student_action" && event.status === "committed")
    .map((event) => [event.sourceRef, event]));
  const interviews = record.studentActions.flatMap((action) => {
    const event = committed.get(action.workActionId);
    const detail = action.action;
    if (!event || action.actorId !== actorId
      || !(detail.verb === "ask" || detail.verb === "probe" || detail.verb === "negotiate")
      || !definition.fieldInterview.targetEntityIds.includes(detail.targetRef.objectId)) return [];
    const consequence = record.consequences.find((item) => item.sourceWorldEventId === event.eventId);
    return consequence ? [{
      actionId: action.workActionId,
      eventId: event.eventId,
      utterance: detail.utterance,
      publicOutcome: consequence.publicSummary,
      occurredAt: consequence.occurredAt,
    }] : [];
  });
  const fieldSources = record.fieldInterview?.actorId === actorId
    ? resolveFieldEvidence(record, { actorId, bindingId: record.fieldInterview.bindingId }, fieldLessons) : [];
  interviews.push(...fieldSources.flatMap(({ turn, event, option }) => turn && option.eventType !== "field_boundary_request" ? [{
    actionId: turn.id, eventId: event.id, utterance: turn.studentText,
    publicOutcome: turn.npcText, occurredAt: event.committedAt,
  }] : []));
  return {
    sessionId: record.sessionId,
    courseReleaseRef: record.release.courseReleaseRef,
    stateVersion: record.currentSnapshot.stateVersion,
    ended: record.currentSnapshot.endingState.status !== "active",
    paused: record.currentSnapshot.virtualTime.paused,
    occurredAt: record.updatedAt,
    interviews: interviews.toSorted((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    fieldEvidence: fieldSources.map(source => source.option),
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function projectFlagshipCourseOutcome(input: {
  principalId: string;
  actorId: string;
  bindingId: string;
  sessionId: string;
  release: CourseRelease;
  definition: FlagshipCourseProjectionDefinition;
  manifest: XunpuFlagshipContentManifestV3;
  world: FlagshipWorldOutcomeSource;
  work: FlagshipStudentWorkRecordV3 | null;
  media?: FlagshipMediaWorkspaceV4;
  review: CourseReviewResult | null;
}): CourseOutcomeRuntimeSnapshot {
  const { world, work, release, definition } = input;
  if (world.sessionId !== input.sessionId
    || world.courseReleaseRef.courseId !== release.courseId
    || world.courseReleaseRef.releaseId !== release.releaseId
    || world.courseReleaseRef.version !== release.version
    || world.courseReleaseRef.contentHash !== release.contentHash
    || definition.courseId !== release.courseId) {
    throw new CourseLearningError("version_hash_drift", "旗舰成果与课程发布引用不一致");
  }
  if (work && (work.sessionId !== input.sessionId || work.actorId !== input.actorId
    || work.ownerPrincipalId !== input.principalId)) {
    throw new CourseLearningError("access_denied", "不能聚合其他学生的旗舰作品");
  }
  if (work && work.manifestContentHash !== input.manifest.contentHash) {
    throw new CourseLearningError("version_hash_drift", "旗舰作品清单版本不一致");
  }
  if (input.media && (input.media.sessionId !== input.sessionId || input.media.bindingId !== input.bindingId)) {
    throw new CourseLearningError("access_denied", "不能聚合其他学生的媒体作品");
  }
  const chapters = new Map(release.chapters.map((chapter) => [chapter.chapterId, chapter]));
  if (definition.chapters.length !== chapters.size
    || new Set(definition.chapters.map((rule) => rule.chapterId)).size !== chapters.size
    || definition.chapters.some((rule) => !chapters.has(rule.chapterId))) {
    throw new CourseLearningError("version_hash_drift", "课程成果映射未覆盖冻结章节");
  }
  const rules = new Map(definition.artifacts.map((rule) => [rule.artifactId, rule]));
  const revisions = new Map(work?.revisions.map((revision) => [revision.revisionId, revision]) ?? []);
  const completedArtifacts = new Set<string>();
  const portfolioItems: CourseOutcomeArtifactSnapshot[] = [];
  const evidenceMap = new Map<string, CourseOutcomeEvidenceSnapshot>();
  const addEvidence = (id: string, revisionId: string, title: string, basis: string, createdAt: string) => {
    const existing = evidenceMap.get(id);
    if (existing) {
      if (!existing.artifactRevisionRefs.includes(revisionId)) existing.artifactRevisionRefs.push(revisionId);
      return;
    }
    evidenceMap.set(id, { evidenceId: id, title: title.slice(0, 240), basis: basis.slice(0, 2_000), artifactRevisionRefs: [revisionId], createdAt });
  };
  for (const artifact of work?.artifacts ?? []) {
    if (!artifact.latestRevisionId) continue;
    const revision = revisions.get(artifact.latestRevisionId);
    const rule = rules.get(artifact.artifactId);
    const artifactDefinition = input.manifest.artifacts.find((candidate) => candidate.artifactId === artifact.artifactId);
    if (!revision || !rule || !artifactDefinition || !chapters.has(rule.chapterId)) {
      throw new CourseLearningError("version_hash_drift", "作品版本或课程成果映射缺失");
    }
    const submitted = artifact.status === "submitted" && artifact.submittedRevisionId === revision.revisionId;
    if (submitted) completedArtifacts.add(artifact.artifactId);
    portfolioItems.push({
      artifactId: artifact.artifactId,
      revisionId: revision.revisionId,
      chapterId: rule.chapterId,
      deliverableIds: [...chapters.get(rule.chapterId)!.deliverableIds],
      origin: "student_artifact",
      title: artifactDefinition.title,
      kind: rule.kind,
      status: submitted ? "submitted" : "draft",
      revisionNumber: revision.revisionNumber,
      summary: revision.fields.map((field) => field.content.trim()).filter(Boolean).join("\n").slice(0, 1_200) || "该草稿版本尚无正文。",
      contentHash: revision.contentHash,
      evidenceIds: [...revision.evidenceRefs],
      updatedAt: artifact.updatedAt,
    });
    for (const reference of revision.evidenceRefs) {
      const fieldSource = world.fieldEvidence?.find(candidate => candidate.evidenceRef === reference);
      if (fieldSource) {
        addEvidence(reference, revision.revisionId, fieldSource.label, fieldSource.detail, revision.createdAt);
        continue;
      }
      const source = release.sources.find((candidate) => reference === candidate.sourceId || reference.endsWith(`:${candidate.sourceId}`));
      const knowledge = input.manifest.sourceKnowledgeRefs.find((candidate) => candidate.knowledgeId === reference);
      addEvidence(reference, revision.revisionId, source?.title ?? "作品登记证据", source
        ? `${source.publisher}｜${source.title}｜${source.locator}｜${source.url}`
        : knowledge ? `${knowledge.knowledgeId}｜${knowledge.locator}｜${knowledge.url}｜复核状态：${knowledge.reviewStatus}`
          : `该证据引用已在作品版本 ${revision.revisionId} 中登记：${reference}`, revision.createdAt);
    }
  }
  const latestMedia = [...new Map((input.media?.revisions ?? [])
    .toSorted((left, right) => left.revisionNumber - right.revisionNumber)
    .map((revision) => [revision.artifactRef, revision])).values()];
  for (const revision of latestMedia) {
    if (revision.sessionId !== input.sessionId || revision.bindingId !== input.bindingId) {
      throw new CourseLearningError("access_denied", "媒体作品版本归属不一致");
    }
    const rule = rules.get(revision.artifactRef);
    if (!rule) throw new CourseLearningError("version_hash_drift", "媒体成果缺少冻结课程映射");
    const chapter = chapters.get(rule.chapterId)!;
    const evidenceIds = [...new Set([...revision.supportingEvidenceRefs, ...revision.rightsLedgerRefs])];
    portfolioItems.push({
      artifactId: `media:${input.sessionId}:${revision.artifactRef}`,
      revisionId: revision.mediaRevisionId,
      chapterId: rule.chapterId,
      deliverableIds: [...chapter.deliverableIds],
      origin: "student_artifact",
      title: "多平台媒体作品",
      kind: "channel_variant",
      status: revision.status === "submitted" ? "submitted" : "draft",
      revisionNumber: revision.revisionNumber,
      summary: revision.studentEditorialRationale.slice(0, 1_200),
      contentHash: revision.contentHash,
      evidenceIds,
      updatedAt: revision.createdAt,
    });
    for (const reference of evidenceIds) {
      addEvidence(reference, revision.mediaRevisionId, "媒体依据与权利登记", `媒体版本 ${revision.mediaRevisionId} 登记引用 ${reference}；原件与派生文件按内容哈希关联。`, revision.createdAt);
    }
  }
  if (world.interviews.length > 0) {
    const contentHash = digest(world.interviews);
    const revisionId = `field-record-${contentHash.slice(0, 32)}`;
    const chapterId = definition.fieldInterview.chapterId;
    const chapter = chapters.get(chapterId);
    if (!chapter) throw new CourseLearningError("version_hash_drift", "现场记录缺少对应课程章节");
    const evidenceIds = world.interviews.map((interview) => interview.actionId);
    portfolioItems.push({
      artifactId: `field-record:${input.sessionId}`,
      revisionId,
      chapterId,
      deliverableIds: [...chapter.deliverableIds],
      origin: "server_process_record",
      title: "现场采访过程记录",
      kind: "interview_record",
      status: "submitted",
      revisionNumber: world.interviews.length,
      summary: world.interviews.map((interview) => interview.utterance).join("\n").slice(0, 1_200),
      contentHash,
      evidenceIds,
      updatedAt: world.interviews.at(-1)!.occurredAt,
    });
    for (const interview of world.interviews) {
      addEvidence(interview.actionId, revisionId, "实际采访行动与后果", `${interview.utterance}\n${interview.publicOutcome}`, interview.occurredAt);
    }
  }
  const completedChapterIds = definition.chapters.filter((rule) => (
    rule.requiredArtifactIds.every((id) => completedArtifacts.has(id))
    && (!rule.requiresFieldInterview || world.interviews.length > 0)
    && (!rule.requiresWorldEnding || world.ended)
  )).map((rule) => rule.chapterId);
  const complete = completedChapterIds.length === release.chapters.length;
  const currentChapterId = release.chapters.find((chapter) => !completedChapterIds.includes(chapter.chapterId))?.chapterId ?? null;
  const review = complete ? input.review : null;
  if (review) {
    const revisionId = review.reviewId;
    const chapter = release.chapters.at(-1)!;
    const evidenceIds = [...new Set(review.dimensions.flatMap((dimension) => dimension.evidenceRefs))];
    portfolioItems.push({
      artifactId: `teacher-review:${input.sessionId}`,
      revisionId,
      chapterId: chapter.chapterId,
      deliverableIds: [...chapter.deliverableIds],
      origin: "server_process_record",
      title: "教师终裁记录",
      kind: "task_outcome",
      status: "submitted",
      revisionNumber: 1,
      summary: review.publicSummary.slice(0, 1_200),
      contentHash: digest(review),
      evidenceIds,
      updatedAt: review.finalizedAt,
    });
    for (const dimension of review.dimensions) {
      for (const ref of dimension.evidenceRefs) {
        addEvidence(ref, revisionId, `教师评价｜${dimension.label}`, `终裁 ${review.reviewId}｜${dimension.feedback}`, review.finalizedAt);
      }
    }
  }
  const submittedAt = complete ? [world.occurredAt, ...(work?.artifacts.map((artifact) => artifact.updatedAt) ?? [])].sort().at(-1)! : null;
  const updatedAt = [world.occurredAt, work?.updatedAt, review?.finalizedAt, ...latestMedia.map((revision) => revision.createdAt)].filter((value): value is string => Boolean(value)).sort().at(-1)!;
  return {
    stateVersion: world.stateVersion + (work?.recordRevision ?? 0) + (input.media?.revisions.length ?? 0) + (review ? 1 : 0),
    updatedAt,
    submittedAt,
    scenarioStatus: world.ended ? "completed" : world.paused ? "paused" : "running",
    currentChapterId,
    completedChapterIds,
    submittedDeliverableIds: [...new Set(completedChapterIds.flatMap((id) => chapters.get(id)!.deliverableIds))],
    portfolioItems,
    evidence: [...evidenceMap.values()],
    review,
    authoritativeCourseStatus: complete ? review ? "completed" : "awaiting_review" : "in_progress",
  };
}
