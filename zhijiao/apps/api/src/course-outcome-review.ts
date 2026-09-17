import { createHash } from "node:crypto";
import {
  CourseReviewResultSchema,
  courseReleaseReferenceOf,
  type CourseRelease,
  type CourseReviewResult,
  type CourseReviewSubmission,
  type StudentPortfolioEvidence,
  type StudentPortfolioItem,
} from "@ronggang/contracts";

export const DeterministicProcessReviewAlgorithmVersion =
  "course-process-review/1.0.0" as const;

export interface DeterministicProcessReviewInput {
  release: CourseRelease;
  submission: CourseReviewSubmission;
  portfolioItems: StudentPortfolioItem[];
  evidence: StudentPortfolioEvidence[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function canonicalHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function uniqueSorted(values: readonly string[]): string[] | null {
  const sorted = [...values].sort();
  return new Set(sorted).size === sorted.length ? sorted : null;
}

function sameUniqueSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = uniqueSorted(left);
  const sortedRight = uniqueSorted(right);
  return Boolean(
    sortedLeft
    && sortedRight
    && sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]),
  );
}

function rubricSnapshotOf(release: CourseRelease): CourseReviewSubmission["rubric"] {
  return release.chapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    title: chapter.title,
    criteria: structuredClone(chapter.rubricCriteria),
  }));
}

function scoreAllocations(input: Array<{
  dimensionId: string;
  weight: number;
}>): Map<string, number> {
  const raw = input.map((item) => {
    const basisPoints = item.weight;
    return {
      ...item,
      floor: Math.floor(basisPoints),
      remainder: basisPoints - Math.floor(basisPoints),
    };
  });
  let remaining = 10_000 - raw.reduce((total, item) => total + item.floor, 0);
  const ranked = [...raw].sort((left, right) => (
    right.remainder - left.remainder
    || left.dimensionId.localeCompare(right.dimensionId)
  ));
  const allocations = new Map(raw.map((item) => [item.dimensionId, item.floor]));
  for (const item of ranked) {
    if (remaining <= 0) break;
    allocations.set(item.dimensionId, allocations.get(item.dimensionId)! + 1);
    remaining -= 1;
  }
  return allocations;
}

/**
 * Produces a deterministic process-evidence review after the student
 * submission has been frozen. It is intentionally not a World assessment or
 * a human/expert content-quality judgement. The browser supplies none of the
 * score, feedback, actor, rubric, artifact, or evidence fields.
 */
export function buildDeterministicProcessReview(
  input: DeterministicProcessReviewInput,
): CourseReviewResult | null {
  const expectedRubric = rubricSnapshotOf(input.release);
  const releaseRef = courseReleaseReferenceOf(input.release);
  const referencedEvidenceIds = new Set(
    input.portfolioItems.flatMap((item) => item.evidenceIds),
  );
  if (
    canonicalHash(input.submission.courseReleaseRef) !== canonicalHash(releaseRef)
    || canonicalHash(input.submission.rubric) !== canonicalHash(expectedRubric)
    || !sameUniqueSet(
      input.submission.deliverableIds,
      input.release.chapters.flatMap((chapter) => chapter.deliverableIds),
    )
    || !sameUniqueSet(
      input.submission.portfolioItemIds,
      input.portfolioItems.map((item) => item.portfolioItemId),
    )
    || !sameUniqueSet(
      input.submission.evidenceIds,
      input.evidence.map((item) => item.evidenceId),
    )
    || input.portfolioItems.some((item) => (
      canonicalHash(item.courseReleaseRef) !== canonicalHash(releaseRef)
      || item.enrollmentId !== input.submission.enrollmentId
      || item.sessionId !== input.submission.sessionId
    ))
    || input.evidence.some((item) => (
      canonicalHash(item.courseReleaseRef) !== canonicalHash(releaseRef)
      || item.enrollmentId !== input.submission.enrollmentId
      || item.sessionId !== input.submission.sessionId
      || !referencedEvidenceIds.has(item.evidenceId)
    ))
  ) {
    return null;
  }

  const submittedEvidenceIds = new Set(input.submission.evidenceIds);
  const dimensionsDraft = input.release.chapters.flatMap((chapter) => {
    const chapterItems = input.portfolioItems.filter((item) => (
      item.chapterId === chapter.chapterId
    ));
    const coveredDeliverableIds = chapterItems.flatMap((item) => (
      item.deliverableIds
    ));
    const chapterEvidenceIds = [
      ...new Set(chapterItems.flatMap((item) => item.evidenceIds)),
    ].sort();
    if (
      chapterItems.length === 0
      || chapterEvidenceIds.length === 0
      || !chapterEvidenceIds.every((id) => submittedEvidenceIds.has(id))
      || chapterItems.some((item) => item.deliverableIds.some((id) => (
        !chapter.deliverableIds.includes(id)
      )))
      || !chapter.deliverableIds.every((id) => coveredDeliverableIds.includes(id))
    ) {
      return [];
    }
    return chapter.rubricCriteria.map((criterion) => {
      const digest = canonicalHash({
        chapterId: chapter.chapterId,
        criterionId: criterion.criterionId,
      });
      return {
        dimensionId: `process-dimension:${digest.slice(0, 24)}`,
        label: `${chapter.order}.${criterion.title}`.slice(0, 160),
        chapterEvidenceIds,
        weightBasisPoints: (criterion.weight * 100) / input.release.chapters.length,
      };
    });
  });
  const expectedDimensionCount = input.release.chapters.reduce(
    (total, chapter) => total + chapter.rubricCriteria.length,
    0,
  );
  if (
    dimensionsDraft.length !== expectedDimensionCount
    || dimensionsDraft.length > 64
    || new Set(dimensionsDraft.map((item) => item.dimensionId)).size
      !== dimensionsDraft.length
  ) {
    return null;
  }

  const allocations = scoreAllocations(dimensionsDraft.map((item) => ({
    dimensionId: item.dimensionId,
    weight: item.weightBasisPoints,
  })));
  const dimensions = dimensionsDraft.map((item) => {
    const maxScore = allocations.get(item.dimensionId)! / 100;
    return {
      dimensionId: item.dimensionId,
      label: item.label,
      score: maxScore,
      maxScore,
      feedback:
        "服务端仅机械核验本章成果、发布版量规与冻结过程证据的覆盖关系；本项不评价内容专业质量，仍待教师或行业专家开展人工复核。",
      evidenceRefs: item.chapterEvidenceIds,
    };
  });
  const reviewHash = canonicalHash({
    algorithmVersion: DeterministicProcessReviewAlgorithmVersion,
    courseReleaseRef: releaseRef,
    submission: {
      submissionId: input.submission.submissionId,
      reviewTaskId: input.submission.reviewTaskId,
      submittedAt: input.submission.submittedAt,
      deliverableIds: [...input.submission.deliverableIds].sort(),
      portfolioItemIds: [...input.submission.portfolioItemIds].sort(),
      evidenceIds: [...input.submission.evidenceIds].sort(),
      rubric: input.submission.rubric,
    },
    portfolioItems: [...input.portfolioItems]
      .sort((left, right) => left.portfolioItemId.localeCompare(right.portfolioItemId))
      .map((item) => ({
        portfolioItemId: item.portfolioItemId,
        chapterId: item.chapterId,
        revisionId: item.revisionId,
        contentHash: item.contentHash,
        deliverableIds: [...item.deliverableIds].sort(),
        evidenceIds: [...item.evidenceIds].sort(),
      })),
    evidence: [...input.evidence]
      .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
      .map((item) => ({
        evidenceId: item.evidenceId,
        basis: item.basis,
        artifactRevisionRefs: [...item.artifactRevisionRefs].sort(),
        createdAt: item.createdAt,
      })),
    dimensions,
  });
  const parsed = CourseReviewResultSchema.safeParse({
    reviewId: `course-process-review:${reviewHash.slice(0, 32)}`,
    finalScore: Math.round(
      dimensions.reduce((total, item) => total + item.score, 0) * 100,
    ) / 100,
    dimensions,
    publicSummary:
      "本结果是系统依据不可变课程量规、冻结作品与过程证据生成的确定性达成评估。它只表示流程和证据覆盖完整，不是教师或专家对内容专业质量的评分；人工专业复核状态仍为待复核。",
    finalizedAt: input.submission.submittedAt,
  });
  return parsed.success ? parsed.data : null;
}
