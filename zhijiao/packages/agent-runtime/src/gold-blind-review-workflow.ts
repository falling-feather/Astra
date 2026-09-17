import { randomBytes } from "node:crypto";
import {
  GoldBlindReviewBatchCreationResultSchema,
  GoldBlindReviewBatchViewSchema,
  GoldBlindReviewConditionKeyEntrySchema,
  GoldBlindReviewFreezeReceiptSchema,
  GoldBlindReviewInvitationSchema,
  GoldBlindReviewRecordSchema,
  GoldBlindReviewReviewerViewSchema,
  GoldBlindReviewSubmissionInputSchema,
  GoldBlindReviewUnblindingReceiptSchema,
  GoldBlindReviewUnblindingResultSchema,
  GoldBlindReviewWorkflowSchemaVersion,
  GoldBlindReviewWorkflowViewSchema,
  GoldControlledAblationPreregistrationSchema,
  GoldBlindReviewPacketSchema,
  type GoldAblationCondition,
  type GoldBlindReviewBatchCreationResult,
  type GoldBlindReviewBatchView,
  type GoldBlindReviewConditionKeyEntry,
  type GoldBlindReviewFreezeReceipt,
  type GoldBlindReviewInvitation,
  type GoldBlindReviewPacket,
  type GoldBlindReviewRecord,
  type GoldBlindReviewReviewerView,
  type GoldBlindReviewSubmissionInput,
  type GoldBlindReviewUnblindingReceipt,
  type GoldBlindReviewUnblindingResult,
  type GoldBlindReviewWorkflowView,
  type GoldCandidateDisposition,
  type GoldControlledAblationPreregistration,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const GoldBlindReviewReviewerCredentialSchema = z.object({
  reviewerAlias: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/u),
  accessCodeHash: Sha256Schema,
}).strict();

export const GoldBlindReviewBatchStateSchema = z.object({
  schemaVersion: z.literal(GoldBlindReviewWorkflowSchemaVersion),
  batchId: z.string().regex(/^gbr_[a-f0-9]{24}$/u),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  status: z.enum(["collecting", "frozen", "unblinded"]),
  createdByActorId: z.string().min(1).max(160),
  packet: GoldBlindReviewPacketSchema,
  conditionKey: z.array(GoldBlindReviewConditionKeyEntrySchema).min(1),
  preregistration: GoldControlledAblationPreregistrationSchema,
  reviewProtocolHash: Sha256Schema,
  conditionKeyHash: Sha256Schema,
  reviewers: z.array(GoldBlindReviewReviewerCredentialSchema).min(2).max(10),
  reviews: z.array(GoldBlindReviewRecordSchema),
  freezeReceipt: GoldBlindReviewFreezeReceiptSchema.nullable(),
  unblindingReceipt: GoldBlindReviewUnblindingReceiptSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
}).strict().superRefine((state, context) => {
  const {
    packetHash: _packetHash,
    ...unsignedPacket
  } = state.packet;
  if (hashValue(unsignedPacket) !== state.packet.packetHash) {
    context.addIssue({
      code: "custom",
      path: ["packet", "packetHash"],
      message: "盲评工作流中的评审包哈希不匹配",
    });
  }
  const {
    preregistrationHash: _preregistrationHash,
    ...unsignedPreregistration
  } = state.preregistration;
  if (
    hashValue(unsignedPreregistration)
    !== state.preregistration.preregistrationHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["preregistration", "preregistrationHash"],
      message: "盲评工作流中的预登记哈希不匹配",
    });
  }
  if (
    !state.packet.reviewProtocol
    || hashValue(state.packet.reviewProtocol) !== state.reviewProtocolHash
    || hashValue(state.preregistration.reviewProtocol)
      !== state.reviewProtocolHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["reviewProtocolHash"],
      message: "盲评工作流中的评审协议绑定不一致",
    });
  }
  if (hashValue(state.conditionKey) !== state.conditionKeyHash) {
    context.addIssue({
      code: "custom",
      path: ["conditionKeyHash"],
      message: "盲评工作流中的条件键哈希不匹配",
    });
  }
  const caseIds = new Set(
    state.packet.cases.map((reviewCase) => reviewCase.blindCaseId),
  );
  const mappedCaseIds = state.conditionKey.map((entry) => entry.blindCaseId);
  if (
    mappedCaseIds.length !== caseIds.size
    || new Set(mappedCaseIds).size !== mappedCaseIds.length
    || mappedCaseIds.some((caseId) => !caseIds.has(caseId))
  ) {
    context.addIssue({
      code: "custom",
      path: ["conditionKey"],
      message: "盲评工作流中的条件键没有逐项唯一覆盖评审包",
    });
  }
  const aliases = state.reviewers.map((reviewer) => reviewer.reviewerAlias);
  if (new Set(aliases).size !== aliases.length) {
    context.addIssue({
      code: "custom",
      path: ["reviewers"],
      message: "盲评人别名不得重复",
    });
  }
  const accessCodeHashes = state.reviewers.map(
    (reviewer) => reviewer.accessCodeHash,
  );
  if (new Set(accessCodeHashes).size !== accessCodeHashes.length) {
    context.addIssue({
      code: "custom",
      path: ["reviewers"],
      message: "盲评访问码不得重复",
    });
  }
  const reviewSlots = new Set<string>();
  const reviewIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const review of state.reviews) {
    const slot = `${review.reviewerAlias}:${review.blindCaseId}`;
    const idempotencySlot =
      `${review.reviewerAlias}:${review.idempotencyKey}`;
    const {
      reviewHash: _reviewHash,
      ...unsignedReview
    } = review;
    if (
      review.batchId !== state.batchId
      || !aliases.includes(review.reviewerAlias)
      || !caseIds.has(review.blindCaseId)
      || reviewSlots.has(slot)
      || reviewIds.has(review.reviewId)
      || idempotencyKeys.has(idempotencySlot)
      || hashValue(unsignedReview) !== review.reviewHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviews", review.reviewId],
        message: "盲评记录的批次、槽位、幂等键或内容哈希不一致",
      });
    }
    reviewSlots.add(slot);
    reviewIds.add(review.reviewId);
    idempotencyKeys.add(idempotencySlot);
  }
  if (
    (state.status === "collecting"
      && (state.freezeReceipt !== null || state.unblindingReceipt !== null))
    || (state.status === "frozen"
      && (state.freezeReceipt === null || state.unblindingReceipt !== null))
    || (state.status === "unblinded"
      && (state.freezeReceipt === null || state.unblindingReceipt === null))
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "盲评批次状态与冻结、解盲收据不一致",
    });
  }
  if (state.freezeReceipt) {
    const {
      receiptHash: _freezeReceiptHash,
      ...unsignedFreezeReceipt
    } = state.freezeReceipt;
    if (
      state.freezeReceipt.batchId !== state.batchId
      || hashValue(unsignedFreezeReceipt) !== state.freezeReceipt.receiptHash
      || reviewSnapshotHash(state.reviews)
        !== state.freezeReceipt.reviewSnapshotHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["freezeReceipt"],
        message: "盲评冻结收据与当前评分快照不一致",
      });
    }
  }
  if (state.unblindingReceipt) {
    const {
      receiptHash: _unblindingReceiptHash,
      ...unsignedUnblindingReceipt
    } = state.unblindingReceipt;
    if (
      state.unblindingReceipt.batchId !== state.batchId
      || state.unblindingReceipt.conditionKeyHash !== state.conditionKeyHash
      || state.unblindingReceipt.freezeReceiptHash
        !== state.freezeReceipt?.receiptHash
      || hashValue(unsignedUnblindingReceipt)
        !== state.unblindingReceipt.receiptHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["unblindingReceipt"],
        message: "盲评解盲收据与冻结快照或条件键不一致",
      });
    }
  }
});
export type GoldBlindReviewBatchState = z.infer<
  typeof GoldBlindReviewBatchStateSchema
>;

export type GoldBlindReviewWorkflowErrorCode =
  | "batch_exists"
  | "batch_not_found"
  | "idempotency_conflict"
  | "incomplete_review_collection"
  | "invalid_batch_input"
  | "invalid_review"
  | "reviewer_access_denied"
  | "revision_conflict"
  | "status_conflict";

export class GoldBlindReviewWorkflowError extends Error {
  readonly code: GoldBlindReviewWorkflowErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: GoldBlindReviewWorkflowErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GoldBlindReviewWorkflowError";
    this.code = code;
    this.details = details;
  }
}

export interface GoldBlindReviewBatchStore {
  create(state: GoldBlindReviewBatchState): Promise<GoldBlindReviewBatchState>;
  get(batchId: string): Promise<GoldBlindReviewBatchState | null>;
  list(sessionId: string): Promise<GoldBlindReviewBatchState[]>;
  appendReview(input: {
    batchId: string;
    expectedRevision: number;
    review: GoldBlindReviewRecord;
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState>;
  freeze(input: {
    batchId: string;
    expectedRevision: number;
    receipt: GoldBlindReviewFreezeReceipt;
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState>;
  unblind(input: {
    batchId: string;
    expectedRevision: number;
    receipt: GoldBlindReviewUnblindingReceipt;
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState>;
}

function cloneState(state: GoldBlindReviewBatchState): GoldBlindReviewBatchState {
  return GoldBlindReviewBatchStateSchema.parse(structuredClone(state));
}

function requireState(
  states: Map<string, GoldBlindReviewBatchState>,
  batchId: string,
): GoldBlindReviewBatchState {
  const state = states.get(batchId);
  if (!state) {
    throw new GoldBlindReviewWorkflowError(
      "batch_not_found",
      "盲评批次不存在",
      { batchId },
    );
  }
  return state;
}

function assertRevision(
  state: GoldBlindReviewBatchState,
  expectedRevision: number,
): void {
  if (state.revision !== expectedRevision) {
    throw new GoldBlindReviewWorkflowError(
      "revision_conflict",
      "盲评批次已被其他请求更新，请刷新后重试",
      {
        batchId: state.batchId,
        expectedRevision,
        actualRevision: state.revision,
      },
    );
  }
}

export class InMemoryGoldBlindReviewBatchStore
implements GoldBlindReviewBatchStore {
  readonly #states = new Map<string, GoldBlindReviewBatchState>();

  async create(
    state: GoldBlindReviewBatchState,
  ): Promise<GoldBlindReviewBatchState> {
    const parsed = GoldBlindReviewBatchStateSchema.parse(state);
    if (this.#states.has(parsed.batchId)) {
      throw new GoldBlindReviewWorkflowError(
        "batch_exists",
        "同一盲评包已建立批次",
        { batchId: parsed.batchId },
      );
    }
    this.#states.set(parsed.batchId, cloneState(parsed));
    return cloneState(parsed);
  }

  async get(batchId: string): Promise<GoldBlindReviewBatchState | null> {
    const state = this.#states.get(batchId);
    return state ? cloneState(state) : null;
  }

  async list(sessionId: string): Promise<GoldBlindReviewBatchState[]> {
    return [...this.#states.values()]
      .filter((state) => state.sessionId === sessionId)
      .sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt)
        || right.batchId.localeCompare(left.batchId)
      ))
      .map(cloneState);
  }

  async appendReview(input: {
    batchId: string;
    expectedRevision: number;
    review: GoldBlindReviewRecord;
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState> {
    const state = requireState(this.#states, input.batchId);
    assertRevision(state, input.expectedRevision);
    if (state.status !== "collecting") {
      throw new GoldBlindReviewWorkflowError(
        "status_conflict",
        "盲评批次已冻结，不能继续提交评分",
        { batchId: state.batchId, status: state.status },
      );
    }
    const next = GoldBlindReviewBatchStateSchema.parse({
      ...state,
      reviews: [...state.reviews, GoldBlindReviewRecordSchema.parse(input.review)],
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.batchId, cloneState(next));
    return cloneState(next);
  }

  async freeze(input: {
    batchId: string;
    expectedRevision: number;
    receipt: GoldBlindReviewFreezeReceipt;
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState> {
    const state = requireState(this.#states, input.batchId);
    assertRevision(state, input.expectedRevision);
    if (state.status !== "collecting") {
      throw new GoldBlindReviewWorkflowError(
        "status_conflict",
        "只有收集中的盲评批次可以冻结",
        { batchId: state.batchId, status: state.status },
      );
    }
    const next = GoldBlindReviewBatchStateSchema.parse({
      ...state,
      status: "frozen",
      freezeReceipt: input.receipt,
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.batchId, cloneState(next));
    return cloneState(next);
  }

  async unblind(input: {
    batchId: string;
    expectedRevision: number;
    receipt: GoldBlindReviewUnblindingReceipt;
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState> {
    const state = requireState(this.#states, input.batchId);
    assertRevision(state, input.expectedRevision);
    if (state.status !== "frozen") {
      throw new GoldBlindReviewWorkflowError(
        "status_conflict",
        "只有已冻结的盲评批次可以解盲",
        { batchId: state.batchId, status: state.status },
      );
    }
    const next = GoldBlindReviewBatchStateSchema.parse({
      ...state,
      status: "unblinded",
      unblindingReceipt: input.receipt,
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.batchId, cloneState(next));
    return cloneState(next);
  }
}

export interface CreateGoldBlindReviewBatchInput {
  sessionId: string;
  createdByActorId: string;
  packet: GoldBlindReviewPacket;
  conditionKey: readonly GoldBlindReviewConditionKeyEntry[];
  preregistration: GoldControlledAblationPreregistration;
  reviewerAliases: readonly string[];
}

export interface GoldBlindReviewCoordinatorOptions {
  now?: () => string;
  createAccessCode?: () => string;
}

function withoutHash<T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const { [key]: _ignored, ...unsigned } = value;
  return unsigned;
}

function invalidBatch(
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new GoldBlindReviewWorkflowError(
    "invalid_batch_input",
    message,
    details,
  );
}

function sortedReviews(
  reviews: readonly GoldBlindReviewRecord[],
): GoldBlindReviewRecord[] {
  return [...reviews].sort((left, right) => (
    left.blindCaseId.localeCompare(right.blindCaseId)
    || left.reviewerAlias.localeCompare(right.reviewerAlias)
    || left.reviewId.localeCompare(right.reviewId)
  ));
}

function reviewSnapshotHash(
  reviews: readonly GoldBlindReviewRecord[],
): string {
  return hashValue(sortedReviews(reviews).map((review) => ({
    reviewId: review.reviewId,
    reviewHash: review.reviewHash,
  })));
}

function accessCodeHash(batchId: string, accessCode: string): string {
  return hashValue({
    namespace: "gold-blind-review-access/1.0.0",
    batchId,
    accessCode,
  });
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricStatus(
  value: number | null,
  thresholdMin: number,
  reason: string,
): {
  value: number | null;
  thresholdMin: number;
  status: "passed" | "failed" | "insufficient";
  reason: string | null;
} {
  if (value === null) {
    return {
      value: null,
      thresholdMin,
      status: "insufficient",
      reason,
    };
  }
  return {
    value: roundMetric(value),
    thresholdMin,
    status: value >= thresholdMin ? "passed" : "failed",
    reason: null,
  };
}

function fleissKappa(
  rows: readonly (readonly GoldCandidateDisposition[])[],
): number | null {
  if (rows.length < 2 || (rows[0]?.length ?? 0) < 2) return null;
  const raterCount = rows[0]!.length;
  if (rows.some((row) => row.length !== raterCount)) return null;
  const categories: readonly GoldCandidateDisposition[] = [
    "accept_candidate",
    "reject_candidate",
    "request_more_evidence",
  ];
  const rowAgreement = rows.map((row) => {
    const counts = categories.map(
      (category) => row.filter((value) => value === category).length,
    );
    return (
      counts.reduce((sum, count) => sum + count * count, 0) - raterCount
    ) / (raterCount * (raterCount - 1));
  });
  const observed = mean(rowAgreement);
  if (observed === null) return null;
  const totalRatings = rows.length * raterCount;
  const proportions = categories.map((category) => (
    rows.reduce(
      (sum, row) => sum + row.filter((value) => value === category).length,
      0,
    ) / totalRatings
  ));
  const expected = proportions.reduce(
    (sum, proportion) => sum + proportion * proportion,
    0,
  );
  const denominator = 1 - expected;
  if (Math.abs(denominator) < Number.EPSILON) return null;
  return (observed - expected) / denominator;
}

function iccTwoWayRandomAbsolute(
  rows: readonly (readonly number[])[],
): number | null {
  const targetCount = rows.length;
  const raterCount = rows[0]?.length ?? 0;
  if (
    targetCount < 2
    || raterCount < 2
    || rows.some((row) => row.length !== raterCount)
  ) {
    return null;
  }
  const flattened = rows.flat();
  const grandMean = mean(flattened);
  if (grandMean === null) return null;
  const rowMeans = rows.map((row) => mean(row) ?? 0);
  const columnMeans = Array.from({ length: raterCount }, (_, index) => (
    mean(rows.map((row) => row[index]!)) ?? 0
  ));
  const meanSquareRows = (
    raterCount
    * rowMeans.reduce(
      (sum, value) => sum + (value - grandMean) ** 2,
      0,
    )
  ) / (targetCount - 1);
  const meanSquareColumns = (
    targetCount
    * columnMeans.reduce(
      (sum, value) => sum + (value - grandMean) ** 2,
      0,
    )
  ) / (raterCount - 1);
  let residualSum = 0;
  for (let rowIndex = 0; rowIndex < targetCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < raterCount; columnIndex += 1) {
      residualSum += (
        rows[rowIndex]![columnIndex]!
        - rowMeans[rowIndex]!
        - columnMeans[columnIndex]!
        + grandMean
      ) ** 2;
    }
  }
  const meanSquareError = residualSum
    / ((targetCount - 1) * (raterCount - 1));
  const denominator = (
    meanSquareRows
    + (raterCount - 1) * meanSquareError
    + (raterCount * (meanSquareColumns - meanSquareError)) / targetCount
  );
  if (Math.abs(denominator) < Number.EPSILON) return null;
  return (meanSquareRows - meanSquareError) / denominator;
}

function dispositionCounts(
  values: readonly GoldCandidateDisposition[],
): {
  acceptCandidate: number;
  rejectCandidate: number;
  requestMoreEvidence: number;
} {
  return {
    acceptCandidate: values.filter(
      (value) => value === "accept_candidate",
    ).length,
    rejectCandidate: values.filter(
      (value) => value === "reject_candidate",
    ).length,
    requestMoreEvidence: values.filter(
      (value) => value === "request_more_evidence",
    ).length,
  };
}

function uniqueConsensus(
  values: readonly GoldCandidateDisposition[],
): GoldCandidateDisposition | null {
  const counts = dispositionCounts(values);
  const candidates: Array<[GoldCandidateDisposition, number]> = [
    ["accept_candidate", counts.acceptCandidate],
    ["reject_candidate", counts.rejectCandidate],
    ["request_more_evidence", counts.requestMoreEvidence],
  ];
  const maximum = Math.max(...candidates.map(([, count]) => count));
  const leaders = candidates.filter(([, count]) => count === maximum);
  return leaders.length === 1 ? leaders[0]![0] : null;
}

function conditionSummaries(state: GoldBlindReviewBatchState) {
  const conditionByCase = new Map(
    state.conditionKey.map((entry) => [entry.blindCaseId, entry.conditionCode]),
  );
  const caseById = new Map(
    state.packet.cases.map((reviewCase) => [
      reviewCase.blindCaseId,
      reviewCase,
    ]),
  );
  return (["A", "B", "C"] as const).map((conditionCode) => {
    const caseIds = state.conditionKey
      .filter((entry) => entry.conditionCode === conditionCode)
      .map((entry) => entry.blindCaseId);
    const idSet = new Set(caseIds);
    const cases = caseIds.map((caseId) => caseById.get(caseId)!)
      .filter(Boolean);
    const reviews = state.reviews.filter(
      (review) => idSet.has(review.blindCaseId),
    );
    return {
      conditionCode,
      blindCaseCount: cases.length,
      reviewCount: reviews.length,
      meanModelSuggestedScore: mean(
        cases.map((reviewCase) => reviewCase.response.suggestedScore),
      ),
      meanExpertCandidateAdoptionScore: mean(
        reviews.map((review) => review.candidateAdoptionScore),
      ),
      meanResponseQualityScore: mean(
        reviews.map((review) => review.totalQualityScore),
      ),
      modelDispositionCounts: dispositionCounts(
        cases.map((reviewCase) => reviewCase.response.candidateDisposition),
      ),
      expertDispositionCounts: dispositionCounts(
        reviews.map((review) => review.candidateDisposition),
      ),
    };
  });
}

function createUnblindingReceipt(
  state: GoldBlindReviewBatchState,
  unblindedAt: string,
): GoldBlindReviewUnblindingReceipt {
  const freezeReceipt = state.freezeReceipt;
  if (!freezeReceipt) {
    throw new GoldBlindReviewWorkflowError(
      "status_conflict",
      "冻结收据缺失，拒绝解盲",
      { batchId: state.batchId },
    );
  }
  const currentSnapshotHash = reviewSnapshotHash(state.reviews);
  if (currentSnapshotHash !== freezeReceipt.reviewSnapshotHash) {
    throw new GoldBlindReviewWorkflowError(
      "status_conflict",
      "冻结后的盲评快照哈希不匹配，拒绝解盲",
      { batchId: state.batchId },
    );
  }
  const reviewers = state.reviewers.map((reviewer) => reviewer.reviewerAlias);
  const reviewsByCase = new Map(
    state.packet.cases.map((reviewCase) => [
      reviewCase.blindCaseId,
      reviewers.map((reviewerAlias) => {
        const review = state.reviews.find((candidate) => (
          candidate.blindCaseId === reviewCase.blindCaseId
          && candidate.reviewerAlias === reviewerAlias
        ));
        if (!review) {
          throw new GoldBlindReviewWorkflowError(
            "incomplete_review_collection",
            "冻结快照缺少评审槽位，拒绝解盲",
            {
              batchId: state.batchId,
              blindCaseId: reviewCase.blindCaseId,
              reviewerAlias,
            },
          );
        }
        return review;
      }),
    ]),
  );
  const dispositionRows = [...reviewsByCase.values()].map(
    (reviews) => reviews.map((review) => review.candidateDisposition),
  );
  const adoptionRows = [...reviewsByCase.values()].map(
    (reviews) => reviews.map((review) => review.candidateAdoptionScore),
  );
  const qualityRows = [...reviewsByCase.values()].map(
    (reviews) => reviews.map((review) => review.totalQualityScore),
  );
  const threshold = 0.75;
  const dispositionAgreement = metricStatus(
    fleissKappa(dispositionRows),
    threshold,
    "处置类别缺少可计算方差或至少两个完整案件",
  );
  const adoptionAgreement = metricStatus(
    iccTwoWayRandomAbsolute(adoptionRows),
    threshold,
    "候选可采纳度分数缺少可计算方差或至少两个完整案件",
  );
  const qualityAgreement = metricStatus(
    iccTwoWayRandomAbsolute(qualityRows),
    threshold,
    "回答质量总分缺少可计算方差或至少两个完整案件",
  );
  const expertMeans = state.packet.cases.map((reviewCase) => {
    const reviews = reviewsByCase.get(reviewCase.blindCaseId) ?? [];
    return {
      reviewCase,
      reviews,
      meanAdoptionScore: mean(
        reviews.map((review) => review.candidateAdoptionScore),
      ),
      consensus: uniqueConsensus(
        reviews.map((review) => review.candidateDisposition),
      ),
    };
  });
  const absoluteErrors = expertMeans.flatMap((item) => (
    item.meanAdoptionScore === null
      ? []
      : [Math.abs(
          item.reviewCase.response.suggestedScore - item.meanAdoptionScore,
        )]
  ));
  const meanAbsoluteError = mean(absoluteErrors);
  const highRiskRefs = new Set(
    state.preregistration.caseSuite
      .filter((item) => item.candidateConflictsWithAuthority)
      .map((item) => item.caseRef),
  );
  const highRiskCases = expertMeans.filter((item) => (
    item.reviewCase.reviewContext
    && highRiskRefs.has(item.reviewCase.reviewContext.caseRef)
  ));
  const highRiskAssessable = highRiskCases.filter(
    (item) => item.consensus === "reject_candidate",
  );
  const highRiskFalseNegativeCount = highRiskAssessable.filter(
    (item) => item.reviewCase.response.candidateDisposition
      !== "reject_candidate",
  ).length;
  const meanAbsoluteErrorStatus = meanAbsoluteError === null
    ? "insufficient"
    : meanAbsoluteError <= 10
      ? "passed"
      : "failed";
  const highRiskFalseNegativeStatus = highRiskCases.length === 0
    || highRiskAssessable.length !== highRiskCases.length
    ? "insufficient"
    : highRiskFalseNegativeCount === 0
      ? "passed"
      : "failed";
  const unsigned = {
    schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
    batchId: state.batchId,
    unblindedAt,
    freezeReceiptHash: freezeReceipt.receiptHash,
    conditionKeyHash: state.conditionKeyHash,
    mappingCount: state.conditionKey.length,
    agreement: {
      candidateDisposition: {
        method: "fleiss_kappa" as const,
        ...dispositionAgreement,
      },
      candidateAdoptionScore: {
        method: "icc_2_1" as const,
        ...adoptionAgreement,
      },
      responseQualityScore: {
        method: "icc_2_1" as const,
        ...qualityAgreement,
      },
    },
    modelExpertAssessment: {
      assessedCaseCount: absoluteErrors.length,
      meanAbsoluteErrorPct: meanAbsoluteError === null
        ? null
        : roundMetric(meanAbsoluteError),
      meanAbsoluteErrorThresholdMax: 10,
      meanAbsoluteErrorStatus,
      highRiskCaseCount: highRiskCases.length,
      highRiskAssessableCount: highRiskAssessable.length,
      highRiskFalseNegativeCount,
      highRiskFalseNegativeThresholdMax: 0 as const,
      highRiskFalseNegativeStatus,
    },
    conditionSummaries: conditionSummaries(state),
  };
  return GoldBlindReviewUnblindingReceiptSchema.parse({
    ...unsigned,
    receiptHash: hashValue(unsigned),
  });
}

function batchView(state: GoldBlindReviewBatchState): GoldBlindReviewBatchView {
  const expectedCaseCount = state.packet.cases.length;
  const reviewerProgress = state.reviewers.map((reviewer) => {
    const submittedCaseCount = state.reviews.filter(
      (review) => review.reviewerAlias === reviewer.reviewerAlias,
    ).length;
    return {
      reviewerAlias: reviewer.reviewerAlias,
      submittedCaseCount,
      expectedCaseCount,
      complete: submittedCaseCount === expectedCaseCount,
    };
  });
  const expectedReviewCount = expectedCaseCount * state.reviewers.length;
  return GoldBlindReviewBatchViewSchema.parse({
    schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
    batchId: state.batchId,
    sessionId: state.sessionId,
    status: state.status,
    packetVersion: state.packet.packetVersion,
    packetHash: state.packet.packetHash,
    preregistrationHash: state.preregistration.preregistrationHash,
    reviewProtocolHash: state.reviewProtocolHash,
    rubricRef: state.packet.reviewProtocol!.rubricRef,
    caseCount: expectedCaseCount,
    reviewerCount: state.reviewers.length,
    submittedReviewCount: state.reviews.length,
    expectedReviewCount,
    readyToFreeze: (
      state.status === "collecting"
      && state.reviews.length === expectedReviewCount
      && reviewerProgress.every((progress) => progress.complete)
    ),
    conditionLabelsVisible: state.status === "unblinded",
    reviewerProgress,
    freezeReceipt: state.freezeReceipt,
    unblindingReceipt: state.unblindingReceipt,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    revision: state.revision,
    claimBoundary:
      "独立访问码只建立分离的去标识评分槽位；真实评审人身份、样本代表性、Kappa/ICC 与教学成效必须由实际采集证据另行证明。",
  });
}

export class GoldBlindReviewCoordinator {
  readonly #store: GoldBlindReviewBatchStore;
  readonly #now: () => string;
  readonly #createAccessCode: () => string;

  constructor(
    store: GoldBlindReviewBatchStore,
    options: GoldBlindReviewCoordinatorOptions = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createAccessCode = options.createAccessCode
      ?? (() => randomBytes(24).toString("base64url"));
  }

  async createBatch(
    rawInput: CreateGoldBlindReviewBatchInput,
  ): Promise<GoldBlindReviewBatchCreationResult> {
    const packet = GoldBlindReviewPacketSchema.parse(rawInput.packet);
    const preregistration = GoldControlledAblationPreregistrationSchema.parse(
      rawInput.preregistration,
    );
    const conditionKey = rawInput.conditionKey.map((entry) => (
      GoldBlindReviewConditionKeyEntrySchema.parse(entry)
    ));
    if (packet.cases.length === 0) {
      invalidBatch("盲评包没有可评审成功输出");
    }
    if (!packet.reviewProtocol) {
      invalidBatch("盲评包缺少冻结前固定的评审协议");
    }
    if (
      hashValue(withoutHash(packet, "packetHash"))
      !== packet.packetHash
    ) {
      invalidBatch("盲评包哈希不匹配");
    }
    if (
      hashValue(withoutHash(preregistration, "preregistrationHash"))
      !== preregistration.preregistrationHash
    ) {
      invalidBatch("受控消融预登记哈希不匹配");
    }
    const reviewProtocolHash = hashValue(packet.reviewProtocol);
    if (
      reviewProtocolHash !== hashValue(preregistration.reviewProtocol)
      || packet.reviewProtocol.rubricRef
        !== preregistration.reviewProtocol.rubricRef
    ) {
      invalidBatch("盲评包与预登记评审协议不一致");
    }
    const caseIds = packet.cases.map((reviewCase) => reviewCase.blindCaseId);
    if (new Set(caseIds).size !== caseIds.length) {
      invalidBatch("盲评案件标识不得重复");
    }
    const preregisteredByRef = new Map(
      preregistration.caseSuite.map((item) => [item.caseRef, item]),
    );
    for (const reviewCase of packet.cases) {
      if (hashValue(reviewCase.response) !== reviewCase.responseHash) {
        invalidBatch("盲评案件响应哈希不匹配", {
          blindCaseId: reviewCase.blindCaseId,
        });
      }
      if (
        reviewCase.rubricRef !== packet.reviewProtocol.rubricRef
        || !reviewCase.reviewContext
      ) {
        invalidBatch("盲评案件缺少固定上下文或量规绑定", {
          blindCaseId: reviewCase.blindCaseId,
        });
      }
      const preregistered = preregisteredByRef.get(
        reviewCase.reviewContext.caseRef,
      );
      if (!preregistered || preregistered.domain !== reviewCase.domain) {
        invalidBatch("盲评案件不属于当前预登记案例集", {
          blindCaseId: reviewCase.blindCaseId,
          caseRef: reviewCase.reviewContext.caseRef,
        });
      }
    }
    const mappedIds = conditionKey.map((entry) => entry.blindCaseId);
    if (
      conditionKey.length !== packet.cases.length
      || new Set(mappedIds).size !== mappedIds.length
      || caseIds.some((caseId) => !mappedIds.includes(caseId))
      || new Set(conditionKey.map((entry) => entry.conditionCode)).size !== 3
    ) {
      invalidBatch("条件键必须逐项且唯一覆盖盲评包，并包含A/B/C三组");
    }
    const aliases = rawInput.reviewerAliases.map((alias) => (
      z.string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/u)
        .parse(alias)
    ));
    if (
      aliases.length < 2
      || aliases.length > 10
      || new Set(aliases).size !== aliases.length
    ) {
      invalidBatch("盲评批次必须预先登记2至10个互异评审别名");
    }
    const batchId = `gbr_${hashValue({
      namespace: GoldBlindReviewWorkflowSchemaVersion,
      sessionId: rawInput.sessionId,
      packetHash: packet.packetHash,
      preregistrationHash: preregistration.preregistrationHash,
    }).slice(0, 24)}`;
    const invitations: GoldBlindReviewInvitation[] = aliases.map(
      (reviewerAlias) => GoldBlindReviewInvitationSchema.parse({
        reviewerAlias,
        accessCode: this.#createAccessCode(),
      }),
    );
    const createdAt = this.#now();
    const state = GoldBlindReviewBatchStateSchema.parse({
      schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
      batchId,
      sessionId: rawInput.sessionId,
      status: "collecting",
      createdByActorId: rawInput.createdByActorId,
      packet,
      conditionKey,
      preregistration,
      reviewProtocolHash,
      conditionKeyHash: hashValue(conditionKey),
      reviewers: invitations.map((invitation) => ({
        reviewerAlias: invitation.reviewerAlias,
        accessCodeHash: accessCodeHash(batchId, invitation.accessCode),
      })),
      reviews: [],
      freezeReceipt: null,
      unblindingReceipt: null,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    });
    const created = await this.#store.create(state);
    return GoldBlindReviewBatchCreationResultSchema.parse({
      batch: batchView(created),
      invitations,
    });
  }

  async getWorkflowView(
    sessionId: string,
  ): Promise<GoldBlindReviewWorkflowView> {
    const states = await this.#store.list(sessionId);
    const batches = states.map(batchView);
    return GoldBlindReviewWorkflowViewSchema.parse({
      schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
      generatedAt: this.#now(),
      activeBatch: batches[0] ?? null,
      batches,
      claimBoundary:
        "没有导入新的Live盲评包时，工作流保持待采集；不会沿用历史评分，也不会自动生成教师、专家或学生样本。",
    });
  }

  async getReviewerView(
    batchId: string,
    accessCode: string,
  ): Promise<GoldBlindReviewReviewerView> {
    const state = await this.#requireBatch(batchId);
    const reviewerAlias = this.#authorizeReviewer(state, accessCode);
    const submittedBlindCaseIds = state.reviews
      .filter((review) => review.reviewerAlias === reviewerAlias)
      .map((review) => review.blindCaseId)
      .sort();
    return GoldBlindReviewReviewerViewSchema.parse({
      schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
      batchId,
      status: state.status,
      reviewerAlias,
      packet: state.packet,
      progress: {
        reviewerAlias,
        submittedCaseCount: submittedBlindCaseIds.length,
        expectedCaseCount: state.packet.cases.length,
        complete: submittedBlindCaseIds.length === state.packet.cases.length,
      },
      submittedBlindCaseIds,
      claimBoundary:
        "本视图只含固定案例、模型响应与评分协议，不返回A/B/C条件键、其他评审人的评分或真实身份。",
    });
  }

  async submitReview(
    batchId: string,
    accessCode: string,
    rawInput: GoldBlindReviewSubmissionInput,
  ): Promise<{
    review: GoldBlindReviewRecord;
    batch: GoldBlindReviewBatchView;
  }> {
    const input = GoldBlindReviewSubmissionInputSchema.parse(rawInput);
    const state = await this.#requireBatch(batchId);
    if (state.status !== "collecting") {
      throw new GoldBlindReviewWorkflowError(
        "status_conflict",
        "盲评批次已冻结，不能继续提交评分",
        { batchId, status: state.status },
      );
    }
    const reviewerAlias = this.#authorizeReviewer(state, accessCode);
    const reviewCase = state.packet.cases.find(
      (candidate) => candidate.blindCaseId === input.blindCaseId,
    );
    if (!reviewCase || reviewCase.responseHash !== input.responseHash) {
      throw new GoldBlindReviewWorkflowError(
        "invalid_review",
        "评分案件或响应哈希与冻结盲评包不一致",
        { batchId, blindCaseId: input.blindCaseId },
      );
    }
    const protocol = state.packet.reviewProtocol!;
    const scoreByDimension = new Map(
      input.qualityDimensionScores.map((item) => [
        item.dimensionId,
        item.score,
      ]),
    );
    if (
      scoreByDimension.size !== input.qualityDimensionScores.length
      || scoreByDimension.size !== protocol.qualityDimensions.length
    ) {
      throw new GoldBlindReviewWorkflowError(
        "invalid_review",
        "回答质量评分必须逐项且唯一覆盖预登记维度",
        { batchId, blindCaseId: input.blindCaseId },
      );
    }
    for (const dimension of protocol.qualityDimensions) {
      const score = scoreByDimension.get(dimension.dimensionId);
      if (score === undefined || score > dimension.maxScore) {
        throw new GoldBlindReviewWorkflowError(
          "invalid_review",
          "回答质量维度分数超出预登记范围",
          {
            batchId,
            blindCaseId: input.blindCaseId,
            dimensionId: dimension.dimensionId,
            maxScore: dimension.maxScore,
          },
        );
      }
    }
    const scoreBand = protocol.scoreBands.find(
      (band) => band.disposition === input.candidateDisposition,
    );
    if (
      !scoreBand
      || input.candidateAdoptionScore < scoreBand.minInclusive
      || input.candidateAdoptionScore > scoreBand.maxInclusive
    ) {
      throw new GoldBlindReviewWorkflowError(
        "invalid_review",
        "候选处置与可采纳度分数区间不一致",
        { batchId, blindCaseId: input.blindCaseId },
      );
    }
    const existingBySlot = state.reviews.find((review) => (
      review.reviewerAlias === reviewerAlias
      && review.blindCaseId === input.blindCaseId
    ));
    const existingByKey = state.reviews.find((review) => (
      review.reviewerAlias === reviewerAlias
      && review.idempotencyKey === input.idempotencyKey
    ));
    if (existingBySlot || existingByKey) {
      const existing = existingBySlot ?? existingByKey!;
      const sameSubmission = (
        existing.reviewerAlias === reviewerAlias
        && existing.blindCaseId === input.blindCaseId
        && existing.responseHash === input.responseHash
        && existing.candidateAdoptionScore === input.candidateAdoptionScore
        && existing.candidateDisposition === input.candidateDisposition
        && existing.rationale === input.rationale
        && hashValue(existing.qualityDimensionScores)
          === hashValue(input.qualityDimensionScores)
        && existing.idempotencyKey === input.idempotencyKey
      );
      if (sameSubmission) {
        return { review: existing, batch: batchView(state) };
      }
      throw new GoldBlindReviewWorkflowError(
        "idempotency_conflict",
        "同一评审槽位或幂等键已绑定不同评分",
        {
          batchId,
          blindCaseId: input.blindCaseId,
          reviewerAlias,
        },
      );
    }
    const submittedAt = this.#now();
    const totalQualityScore = input.qualityDimensionScores.reduce(
      (sum, dimension) => sum + dimension.score,
      0,
    );
    const unsigned = {
      schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
      reviewId: `gbrv_${hashValue({
        batchId,
        reviewerAlias,
        blindCaseId: input.blindCaseId,
      }).slice(0, 24)}`,
      batchId,
      reviewerAlias,
      blindCaseId: input.blindCaseId,
      responseHash: input.responseHash,
      candidateAdoptionScore: input.candidateAdoptionScore,
      candidateDisposition: input.candidateDisposition,
      qualityDimensionScores: input.qualityDimensionScores,
      totalQualityScore,
      rationale: input.rationale,
      idempotencyKey: input.idempotencyKey,
      submittedAt,
    };
    const review = GoldBlindReviewRecordSchema.parse({
      ...unsigned,
      reviewHash: hashValue(unsigned),
    });
    const updated = await this.#store.appendReview({
      batchId,
      expectedRevision: state.revision,
      review,
      updatedAt: submittedAt,
    });
    return { review, batch: batchView(updated) };
  }

  async freezeBatch(batchId: string): Promise<GoldBlindReviewBatchView> {
    const state = await this.#requireBatch(batchId);
    if (state.status !== "collecting") {
      throw new GoldBlindReviewWorkflowError(
        "status_conflict",
        "只有收集中的盲评批次可以冻结",
        { batchId, status: state.status },
      );
    }
    const expectedReviewCount = (
      state.packet.cases.length * state.reviewers.length
    );
    const slots = new Set(
      state.reviews.map(
        (review) => `${review.reviewerAlias}:${review.blindCaseId}`,
      ),
    );
    if (
      state.reviews.length !== expectedReviewCount
      || slots.size !== expectedReviewCount
    ) {
      throw new GoldBlindReviewWorkflowError(
        "incomplete_review_collection",
        "必须收齐每位预登记评审人对全部案件的评分后才能冻结",
        {
          batchId,
          expectedReviewCount,
          actualReviewCount: state.reviews.length,
        },
      );
    }
    const frozenAt = this.#now();
    const unsigned = {
      schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
      batchId,
      frozenAt,
      reviewerCount: state.reviewers.length,
      caseCount: state.packet.cases.length,
      reviewCount: state.reviews.length,
      reviewSnapshotHash: reviewSnapshotHash(state.reviews),
    };
    const receipt = GoldBlindReviewFreezeReceiptSchema.parse({
      ...unsigned,
      receiptHash: hashValue(unsigned),
    });
    const updated = await this.#store.freeze({
      batchId,
      expectedRevision: state.revision,
      receipt,
      updatedAt: frozenAt,
    });
    return batchView(updated);
  }

  async unblindBatch(
    batchId: string,
  ): Promise<GoldBlindReviewUnblindingResult> {
    const state = await this.#requireBatch(batchId);
    if (state.status !== "frozen") {
      throw new GoldBlindReviewWorkflowError(
        "status_conflict",
        "必须先冻结完整评审快照，才能解盲条件键",
        { batchId, status: state.status },
      );
    }
    const unblindedAt = this.#now();
    const receipt = createUnblindingReceipt(state, unblindedAt);
    const updated = await this.#store.unblind({
      batchId,
      expectedRevision: state.revision,
      receipt,
      updatedAt: unblindedAt,
    });
    return GoldBlindReviewUnblindingResultSchema.parse({
      batch: batchView(updated),
      mappings: updated.conditionKey.map((entry) => ({
        blindCaseId: entry.blindCaseId,
        conditionCode: entry.conditionCode,
      })),
    });
  }

  async #requireBatch(batchId: string): Promise<GoldBlindReviewBatchState> {
    const state = await this.#store.get(batchId);
    if (!state) {
      throw new GoldBlindReviewWorkflowError(
        "batch_not_found",
        "盲评批次不存在",
        { batchId },
      );
    }
    return state;
  }

  #authorizeReviewer(
    state: GoldBlindReviewBatchState,
    accessCode: string,
  ): string {
    const candidateHash = accessCodeHash(state.batchId, accessCode);
    const reviewer = state.reviewers.find(
      (item) => item.accessCodeHash === candidateHash,
    );
    if (!reviewer) {
      throw new GoldBlindReviewWorkflowError(
        "reviewer_access_denied",
        "评审访问码无效",
        { batchId: state.batchId },
      );
    }
    return reviewer.reviewerAlias;
  }
}

export function goldBlindReviewConditionForCase(
  conditionKey: readonly GoldBlindReviewConditionKeyEntry[],
  blindCaseId: string,
): GoldAblationCondition | null {
  return conditionKey.find(
    (entry) => entry.blindCaseId === blindCaseId,
  )?.conditionCode ?? null;
}
