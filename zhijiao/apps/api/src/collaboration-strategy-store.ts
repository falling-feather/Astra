import { createHash } from "node:crypto";
import {
  CollaborationStrategyContentSchema,
  CollaborationStrategyDraftInputSchema,
  CollaborationStrategyGovernanceInputSchema,
  CollaborationStrategyQuerySchema,
  CollaborationStrategySchema,
  CollaborationStrategySchemaVersion,
  CollaborationStrategyTeacherReviewSchema,
  type CollaborationStrategy,
  type CollaborationStrategyContent,
  type CollaborationStrategyDraftInput,
  type CollaborationStrategyGovernanceAction,
  type CollaborationStrategyGovernanceInput,
  type CollaborationStrategyQuery,
  type CollaborationStrategyStatus,
} from "@ronggang/contracts";
import { z } from "zod";

export type CollaborationStrategyErrorCode =
  | "permission_denied"
  | "strategy_not_found"
  | "version_not_found"
  | "version_conflict"
  | "version_drift"
  | "unresolved_draft"
  | "content_hash_conflict"
  | "immutable_version"
  | "governance_conflict"
  | "invalid_governance_transition"
  | "approved_version_conflict"
  | "corrupted_log";

export class CollaborationStrategyError extends Error {
  constructor(
    readonly code: CollaborationStrategyErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "CollaborationStrategyError";
  }
}

export interface CollaborationStrategyActor {
  actorId: string;
  actorKind: "teacher" | "student";
}

export const CollaborationStrategyTransitionSchema =
  CollaborationStrategyGovernanceInputSchema.extend({
    strategyId: CollaborationStrategyDraftInputSchema.shape.strategyId,
    version: CollaborationStrategyDraftInputSchema.shape.version,
    teacherActorId:
      CollaborationStrategyTeacherReviewSchema.shape.teacherActorId,
    reviewedAt: CollaborationStrategyTeacherReviewSchema.shape.reviewedAt,
  }).strict();
export type CollaborationStrategyTransition = z.infer<
  typeof CollaborationStrategyTransitionSchema
>;

export interface CollaborationStrategyStore {
  createDraft(record: CollaborationStrategy): Promise<CollaborationStrategy>;
  get(
    strategyId: string,
    version: number,
  ): Promise<CollaborationStrategy | null>;
  list(
    query?: CollaborationStrategyQuery,
  ): Promise<CollaborationStrategy[]>;
  transitionGovernance(
    input: CollaborationStrategyTransition,
  ): Promise<CollaborationStrategy>;
}

type JsonPrimitive = string | number | boolean | null;
type CanonicalJson =
  | JsonPrimitive
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value: unknown): CanonicalJson {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value !== "object") {
    throw new TypeError("协作策略哈希只接受 JSON 可表示值");
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/**
 * Normalizes only set-like fields. Narrative and chronological arrays preserve
 * their authored order, while agent, permission and reference sets hash
 * identically regardless of input order.
 */
export function normalizeCollaborationStrategyContent(
  input: CollaborationStrategyContent,
): CollaborationStrategyContent {
  const content = CollaborationStrategyContentSchema.parse(input);
  return CollaborationStrategyContentSchema.parse({
    ...content,
    eventConditions: {
      ...content.eventConditions,
      requiredEventRefs: sortedUnique(
        content.eventConditions.requiredEventRefs,
      ),
    },
    agentSet: sortedUnique(content.agentSet),
    permissions: content.permissions
      .map((permission) => ({
        ...permission,
        visibleScopes: sortedUnique(permission.visibleScopes),
        capabilities: sortedUnique(permission.capabilities),
      }))
      .sort((left, right) => compareText(left.agentId, right.agentId)),
    basisRefs: [...content.basisRefs].sort((left, right) => (
      compareText(left.refType, right.refType)
      || compareText(left.refId, right.refId)
      || compareText(left.version ?? "", right.version ?? "")
    )),
    studentChoice: {
      ...content.studentChoice,
      selectedAgentIds: sortedUnique(
        content.studentChoice.selectedAgentIds,
      ),
    },
    consequenceRefs: sortedUnique(content.consequenceRefs),
    evidenceRefs: sortedUnique(content.evidenceRefs),
  });
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function computeCollaborationStrategyContentHash(
  input: CollaborationStrategyContent,
): string {
  return sha256Canonical(normalizeCollaborationStrategyContent(input));
}

export function assertCollaborationStrategyIntegrity(
  input: CollaborationStrategy,
): CollaborationStrategy {
  const record = CollaborationStrategySchema.parse(input);
  const expected = computeCollaborationStrategyContentHash(record.content);
  if (record.contentHash !== expected) {
    throw new CollaborationStrategyError(
      "corrupted_log",
      "协作策略内容哈希与不可变内容不一致",
      {
        strategyId: record.strategyId,
        version: record.version,
        expectedContentHash: expected,
        actualContentHash: record.contentHash,
      },
    );
  }
  return record;
}

function cloneStrategy(
  strategy: CollaborationStrategy,
): CollaborationStrategy {
  return structuredClone(strategy);
}

const allowedActions: Readonly<
  Record<CollaborationStrategyStatus, readonly CollaborationStrategyGovernanceAction[]>
> = {
  draft: ["approve", "retire"],
  approved: ["disable", "retire"],
  disabled: ["approve", "retire"],
  retired: [],
};

const targetStatus: Readonly<
  Record<CollaborationStrategyGovernanceAction, Exclude<CollaborationStrategyStatus, "draft">>
> = {
  approve: "approved",
  disable: "disabled",
  retire: "retired",
};

export class InMemoryCollaborationStrategyStore
implements CollaborationStrategyStore {
  readonly #records = new Map<string, Map<number, CollaborationStrategy>>();

  async createDraft(
    input: CollaborationStrategy,
  ): Promise<CollaborationStrategy> {
    const record = assertCollaborationStrategyIntegrity(input);
    if (record.governance.status !== "draft") {
      throw new CollaborationStrategyError(
        "version_conflict",
        "新建协作策略版本必须从 draft 状态开始",
      );
    }
    const versions = this.#records.get(record.strategyId) ?? new Map();
    const existing = versions.get(record.version);
    if (existing) {
      throw new CollaborationStrategyError(
        existing.governance.status === "approved"
          ? "immutable_version"
          : "version_conflict",
        existing.governance.status === "approved"
          ? "已批准协作策略版本不可原地修改"
          : "协作策略版本已经存在",
        { strategyId: record.strategyId, version: record.version },
      );
    }
    const sortedVersions = [...versions.keys()].sort((left, right) => left - right);
    const latestVersion = sortedVersions.at(-1) ?? 0;
    if (record.version !== latestVersion + 1) {
      throw new CollaborationStrategyError(
        "version_drift",
        "协作策略版本必须从 1 开始并严格连续递增",
        {
          strategyId: record.strategyId,
          expectedVersion: latestVersion + 1,
          actualVersion: record.version,
        },
      );
    }
    const latest = latestVersion === 0 ? null : versions.get(latestVersion)!;
    if (latest?.governance.status === "draft") {
      throw new CollaborationStrategyError(
        "unresolved_draft",
        "前一 draft 版本必须先批准或淘汰，不能并行建立下一版本",
        { strategyId: record.strategyId, version: latest.version },
      );
    }
    const stored = CollaborationStrategySchema.parse({
      ...record,
      content: normalizeCollaborationStrategyContent(record.content),
    });
    versions.set(stored.version, cloneStrategy(stored));
    this.#records.set(stored.strategyId, versions);
    return cloneStrategy(stored);
  }

  async get(
    strategyId: string,
    version: number,
  ): Promise<CollaborationStrategy | null> {
    const record = this.#records.get(strategyId)?.get(version);
    return record ? cloneStrategy(assertCollaborationStrategyIntegrity(record)) : null;
  }

  async list(
    input: CollaborationStrategyQuery = {},
  ): Promise<CollaborationStrategy[]> {
    const query = CollaborationStrategyQuerySchema.parse(input);
    return [...this.#records.values()]
      .flatMap((versions) => [...versions.values()])
      .filter((record) => (
        (!query.status || record.governance.status === query.status)
        && (
          !query.triggerEventId
          || record.content.eventConditions.triggerEventId === query.triggerEventId
        )
      ))
      .sort((left, right) => (
        compareText(left.strategyId, right.strategyId)
        || left.version - right.version
      ))
      .map((record) => cloneStrategy(assertCollaborationStrategyIntegrity(record)));
  }

  async transitionGovernance(
    rawInput: CollaborationStrategyTransition,
  ): Promise<CollaborationStrategy> {
    const input = CollaborationStrategyTransitionSchema.parse(rawInput);
    const versions = this.#records.get(input.strategyId);
    if (!versions) {
      throw new CollaborationStrategyError(
        "strategy_not_found",
        "协作策略不存在",
        { strategyId: input.strategyId },
      );
    }
    const current = versions.get(input.version);
    if (!current) {
      throw new CollaborationStrategyError(
        "version_not_found",
        "协作策略版本不存在",
        { strategyId: input.strategyId, version: input.version },
      );
    }
    assertCollaborationStrategyIntegrity(current);
    if (current.contentHash !== input.expectedContentHash) {
      throw new CollaborationStrategyError(
        "content_hash_conflict",
        "协作策略内容哈希已漂移，治理操作失败关闭",
        {
          strategyId: input.strategyId,
          version: input.version,
          expectedContentHash: input.expectedContentHash,
          actualContentHash: current.contentHash,
        },
      );
    }
    if (
      current.governance.status !== input.expectedStatus
      || current.governance.revision !== input.expectedGovernanceRevision
    ) {
      throw new CollaborationStrategyError(
        "governance_conflict",
        "协作策略治理状态或修订已变化",
        {
          strategyId: input.strategyId,
          version: input.version,
          expectedStatus: input.expectedStatus,
          actualStatus: current.governance.status,
          expectedGovernanceRevision: input.expectedGovernanceRevision,
          actualGovernanceRevision: current.governance.revision,
        },
      );
    }
    if (!allowedActions[current.governance.status].includes(input.action)) {
      throw new CollaborationStrategyError(
        "invalid_governance_transition",
        "协作策略治理状态不能执行该动作",
        {
          strategyId: input.strategyId,
          version: input.version,
          status: current.governance.status,
          action: input.action,
        },
      );
    }
    if (
      input.action === "approve"
      && [...this.#records.values()]
        .flatMap((candidateVersions) => [...candidateVersions.values()])
        .some((candidate) => (
          (
            candidate.strategyId !== current.strategyId
            || candidate.version !== current.version
          )
          && candidate.governance.status === "approved"
          && candidate.content.eventConditions.triggerEventId
            === current.content.eventConditions.triggerEventId
        ))
    ) {
      throw new CollaborationStrategyError(
        "approved_version_conflict",
        "同一触发事件只能有一个 approved 策略版本；请先禁用或淘汰旧版本",
        {
          strategyId: input.strategyId,
          triggerEventId: current.content.eventConditions.triggerEventId,
        },
      );
    }
    const next = CollaborationStrategySchema.parse({
      ...current,
      governance: {
        status: targetStatus[input.action],
        revision: current.governance.revision + 1,
        latestReview: {
          action: input.action,
          teacherActorId: input.teacherActorId,
          reason: input.reason,
          reviewedAt: input.reviewedAt,
        },
      },
    });
    assertCollaborationStrategyIntegrity(next);
    versions.set(next.version, cloneStrategy(next));
    return cloneStrategy(next);
  }
}

export class CollaborationStrategyService {
  readonly #store: CollaborationStrategyStore;
  readonly #now: () => string;

  constructor(
    store: CollaborationStrategyStore,
    options: { now?: () => string } = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async createDraft(
    rawInput: CollaborationStrategyDraftInput,
    actor: CollaborationStrategyActor,
  ): Promise<CollaborationStrategy> {
    this.#assertTeacher(actor);
    const input = CollaborationStrategyDraftInputSchema.parse(rawInput);
    const content = normalizeCollaborationStrategyContent(input.content);
    return this.#store.createDraft(CollaborationStrategySchema.parse({
      kind: "CollaborationStrategy",
      schemaVersion: CollaborationStrategySchemaVersion,
      strategyId: input.strategyId,
      version: input.version,
      contentHash: computeCollaborationStrategyContentHash(content),
      content,
      governance: {
        status: "draft",
        revision: 0,
        latestReview: null,
      },
      createdBy: actor.actorId,
      createdAt: this.#now(),
    }));
  }

  get(
    strategyId: string,
    version: number,
  ): Promise<CollaborationStrategy | null> {
    return this.#store.get(strategyId, version);
  }

  list(
    query?: CollaborationStrategyQuery,
  ): Promise<CollaborationStrategy[]> {
    return this.#store.list(query);
  }

  async transitionGovernance(
    strategyId: string,
    version: number,
    rawInput: CollaborationStrategyGovernanceInput,
    actor: CollaborationStrategyActor,
  ): Promise<CollaborationStrategy> {
    this.#assertTeacher(actor);
    const input = CollaborationStrategyGovernanceInputSchema.parse(rawInput);
    return this.#store.transitionGovernance({
      strategyId,
      version,
      ...input,
      teacherActorId: actor.actorId,
      reviewedAt: this.#now(),
    });
  }

  #assertTeacher(actor: CollaborationStrategyActor): void {
    if (actor.actorKind !== "teacher") {
      throw new CollaborationStrategyError(
        "permission_denied",
        "只有教师岗位可以创建或治理协作策略",
        { actorId: actor.actorId, actorKind: actor.actorKind },
      );
    }
  }
}
