import {
  FlagshipCollaborationScenarioReleaseId,
  PublishedScenarioPackageSchema,
  ScenarioCompilerVersion,
  ScenarioDraftSchema,
  ScenarioPackageRefSchema,
  ScenarioPackageSchema,
  ScenarioPreviewSchema,
  type CollaborationStrategy,
  type PublishedScenarioPackage,
  type ScenarioApprovalPolicy,
  type ScenarioCollaborationConfig,
  type ScenarioDirectorConfig,
  type ScenarioDraft,
  type ScenarioPackage,
  type ScenarioPackageRef,
  type ScenarioPreview,
  type ScenarioValidationReport,
} from "@ronggang/contracts";
import { hashCanonical, hashScenarioPackage } from "./canonical.js";
import { validateScenarioPackage } from "./validator.js";

export type ScenarioCatalogFrame =
  | { kind: "draft_snapshot"; draft: ScenarioDraft }
  | { kind: "release_published"; release: PublishedScenarioPackage };

export interface ScenarioCatalogStore {
  load(): Promise<ScenarioCatalogFrame[]>;
  append(frame: ScenarioCatalogFrame): Promise<void>;
}

export class InMemoryScenarioCatalogStore implements ScenarioCatalogStore {
  readonly #frames: ScenarioCatalogFrame[] = [];

  async load(): Promise<ScenarioCatalogFrame[]> {
    return structuredClone(this.#frames);
  }

  async append(frame: ScenarioCatalogFrame): Promise<void> {
    this.#frames.push(structuredClone(frame));
  }
}

export class ScenarioRevisionConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`情境草稿修订冲突：期望 ${expected}，实际 ${actual}`);
    this.name = "ScenarioRevisionConflictError";
  }
}

export class ScenarioCatalogNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioCatalogNotFoundError";
  }
}

export class ScenarioPublishConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioPublishConflictError";
  }
}

export interface ScenarioDraftPatch {
  version?: string;
  title?: string;
  description?: string;
  roles?: Array<{
    agentId: string;
    displayName: string;
    purpose: string;
  }>;
  approvalPolicies?: Array<Pick<
    ScenarioApprovalPolicy,
    "approvalPolicyId" | "label" | "allowReject" | "reasonRequired" | "minimumEvidenceCount"
  >>;
  directorConfig?: Pick<
    ScenarioDirectorConfig,
    "difficulty" | "cadence" | "cooldownEvents" | "allowedRouteIds"
  >;
  collaborationConfig?: ScenarioCollaborationConfig;
}

function nextMinorVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) return "0.1.0";
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function changedFields(source: ScenarioPackage | null, draft: ScenarioPackage): string[] {
  if (!source) return ["新情境"];
  const labels: Array<[keyof ScenarioPackage, string]> = [
    ["version", "版本"],
    ["title", "标题"],
    ["description", "说明"],
    ["roles", "岗位"],
    ["nodes", "节点"],
    ["materials", "材料"],
    ["roleInteractions", "岗位互动"],
    ["eventPolicies", "事件策略"],
    ["approvalPolicies", "审批策略"],
    ["directorConfig", "导演策略"],
    ["directorEventTemplates", "导演事件模板"],
    ["collaborationConfig", "协作配置"],
    ["rubric", "评价量规"],
    ["courseGuide", "课程内容指引"],
    ["experienceDesign", "双维度体验设计"],
    ["knowledgeChunks", "知识语料"],
  ];
  return labels
    .filter(([key]) => (
      hashCanonical(source[key] ?? null)
      !== hashCanonical(draft[key] ?? null)
    ))
    .map(([, label]) => label);
}

export class ScenarioCatalog {
  readonly #store: ScenarioCatalogStore;
  readonly #drafts = new Map<string, ScenarioDraft>();
  readonly #releases = new Map<string, PublishedScenarioPackage>();
  readonly #legacySessionRefs = new Map<string, ScenarioPackageRef>();
  #initialized = false;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(store: ScenarioCatalogStore = new InMemoryScenarioCatalogStore()) {
    this.#store = store;
  }

  async initialize(seeds: readonly PublishedScenarioPackage[] = []): Promise<void> {
    if (this.#initialized) return;
    for (const frame of await this.#store.load()) {
      if (frame.kind === "draft_snapshot") {
        const draft = ScenarioDraftSchema.parse(frame.draft);
        const current = this.#drafts.get(draft.draftId);
        if (!current || draft.revision >= current.revision) this.#drafts.set(draft.draftId, draft);
      } else {
        const release = PublishedScenarioPackageSchema.parse(frame.release);
        this.assertReleaseIntegrity(release);
        const sameVersion = [...this.#releases.values()].find((candidate) => (
          candidate.ref.scenarioId === release.ref.scenarioId
          && candidate.ref.version === release.ref.version
        ));
        if (sameVersion && sameVersion.ref.contentHash !== release.ref.contentHash) {
          throw new Error(`同一情境版本存在不同内容：${release.ref.scenarioId}@${release.ref.version}`);
        }
        const duplicate = this.#releases.get(release.ref.releaseId);
        if (duplicate && duplicate.ref.contentHash !== release.ref.contentHash) {
          throw new Error(`情境发布标识指向不同内容：${release.ref.releaseId}`);
        }
        this.#releases.set(release.ref.releaseId, release);
      }
    }
    for (const rawSeed of seeds) {
      const seed = PublishedScenarioPackageSchema.parse(rawSeed);
      this.assertReleaseIntegrity(seed);
      const sameVersion = [...this.#releases.values()].find((release) => (
        release.ref.scenarioId === seed.ref.scenarioId && release.ref.version === seed.ref.version
      ));
      if (sameVersion && sameVersion.ref.contentHash !== seed.ref.contentHash) {
        throw new Error(`种子情境与已发布版本内容冲突：${seed.ref.scenarioId}@${seed.ref.version}`);
      }
      if (!sameVersion) {
        await this.#store.append({ kind: "release_published", release: seed });
        this.#releases.set(seed.ref.releaseId, seed);
      }
    }
    this.#initialized = true;
  }

  list(): { drafts: ScenarioDraft[]; releases: PublishedScenarioPackage[] } {
    this.assertInitialized();
    return {
      drafts: [...this.#drafts.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((item) => structuredClone(item)),
      releases: [...this.#releases.values()]
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
        .map((item) => structuredClone(item)),
    };
  }

  getDraft(draftId: string): ScenarioDraft {
    this.assertInitialized();
    const draft = this.#drafts.get(draftId);
    if (!draft) throw new ScenarioCatalogNotFoundError(`情境草稿不存在：${draftId}`);
    return structuredClone(draft);
  }

  getRelease(releaseId: string): PublishedScenarioPackage {
    this.assertInitialized();
    const release = this.#releases.get(releaseId);
    if (!release) throw new ScenarioCatalogNotFoundError(`情境发布版不存在：${releaseId}`);
    this.assertReleaseIntegrity(release);
    return structuredClone(release);
  }

  resolve(ref: ScenarioPackageRef): PublishedScenarioPackage {
    const parsedRef = ScenarioPackageRefSchema.parse(ref);
    const release = this.getRelease(parsedRef.releaseId);
    if (
      release.ref.scenarioId !== parsedRef.scenarioId
      || release.ref.version !== parsedRef.version
      || release.ref.schemaVersion !== parsedRef.schemaVersion
      || release.ref.contentHash !== parsedRef.contentHash
    ) {
      throw new Error(`情境发布引用与目录快照不一致：${parsedRef.releaseId}`);
    }
    return release;
  }

  registerLegacySessionRelease(rawRef: ScenarioPackageRef): void {
    this.assertInitialized();
    const release = this.resolve(rawRef);
    const key = `${release.ref.scenarioId}@${release.ref.version}`;
    const current = this.#legacySessionRefs.get(key);
    if (current && (
      current.releaseId !== release.ref.releaseId
      || current.contentHash !== release.ref.contentHash
    )) {
      throw new Error(`旧会话情境映射冲突：${key}`);
    }
    this.#legacySessionRefs.set(key, structuredClone(release.ref));
  }

  resolveLegacySessionRelease(
    scenarioId: string,
    version: string,
  ): PublishedScenarioPackage | null {
    this.assertInitialized();
    const ref = this.#legacySessionRefs.get(`${scenarioId}@${version}`);
    return ref ? this.resolve(ref) : null;
  }

  async copyRelease(input: {
    releaseId: string;
    actorId: string;
    now?: string;
    draftId?: string;
  }): Promise<ScenarioDraft> {
    const releaseLock = await this.acquireWriteLock();
    try {
      const source = this.getRelease(input.releaseId);
      const now = input.now ?? new Date().toISOString();
      const nextVersion = nextMinorVersion(source.package.version);
      const nextPackage = structuredClone(source.package);
      nextPackage.version = nextVersion;
      if (nextPackage.courseGuide) {
        nextPackage.courseGuide.contentVersion = nextVersion;
      }
      if (nextPackage.experienceDesign) {
        nextPackage.experienceDesign.contentVersion = nextVersion;
      }
      const draft = ScenarioDraftSchema.parse({
      draftId: input.draftId ?? `draft-${crypto.randomUUID()}`,
      sourceRef: source.ref,
      revision: 1,
      status: "draft",
      package: nextPackage,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
      lastValidation: null,
      });
      if (this.#drafts.has(draft.draftId)) {
        throw new ScenarioPublishConflictError(`情境草稿标识已存在：${draft.draftId}`);
      }
      await this.#store.append({ kind: "draft_snapshot", draft });
      this.#drafts.set(draft.draftId, draft);
      return structuredClone(draft);
    } finally {
      releaseLock();
    }
  }

  async updateDraft(input: {
    draftId: string;
    expectedRevision: number;
    actorId: string;
    patch: ScenarioDraftPatch;
    now?: string;
  }): Promise<ScenarioDraft> {
    const releaseLock = await this.acquireWriteLock();
    try {
      const current = this.getDraft(input.draftId);
      if (current.revision !== input.expectedRevision) {
        throw new ScenarioRevisionConflictError(input.expectedRevision, current.revision);
      }
      const packagePatch: Partial<ScenarioPackage> = {};
      if (input.patch.version !== undefined) {
        packagePatch.version = input.patch.version;
        if (current.package.courseGuide) {
          packagePatch.courseGuide = {
            ...current.package.courseGuide,
            contentVersion: input.patch.version,
          };
        }
        if (current.package.experienceDesign) {
          packagePatch.experienceDesign = {
            ...current.package.experienceDesign,
            contentVersion: input.patch.version,
          };
        }
      }
      if (input.patch.title !== undefined) packagePatch.title = input.patch.title;
      if (input.patch.description !== undefined) packagePatch.description = input.patch.description;
      if (input.patch.roles !== undefined) {
        const safeRoles = new Map(input.patch.roles.map((role) => [role.agentId, role]));
        packagePatch.roles = current.package.roles.map((role) => {
          const editable = safeRoles.get(role.agentId);
          return editable ? {
            ...role,
            displayName: editable.displayName,
            purpose: editable.purpose,
          } : role;
        });
        for (const agentId of safeRoles.keys()) {
          if (!current.package.roles.some((role) => role.agentId === agentId)) {
            throw new Error(`岗位安全补丁引用未知角色：${agentId}`);
          }
        }
      }
      if (input.patch.approvalPolicies !== undefined) {
        const safePolicies = new Map(input.patch.approvalPolicies.map((policy) => [policy.approvalPolicyId, policy]));
        packagePatch.approvalPolicies = current.package.approvalPolicies.map((policy) => {
          const editable = safePolicies.get(policy.approvalPolicyId);
          return editable ? {
            ...policy,
            label: editable.label,
            allowReject: editable.allowReject,
            reasonRequired: editable.reasonRequired,
            minimumEvidenceCount: editable.minimumEvidenceCount,
          } : policy;
        });
        for (const approvalPolicyId of safePolicies.keys()) {
          if (!current.package.approvalPolicies.some((policy) => policy.approvalPolicyId === approvalPolicyId)) {
            throw new Error(`审批策略安全补丁引用未知策略：${approvalPolicyId}`);
          }
        }
      }
      if (input.patch.directorConfig !== undefined) {
        if (!current.package.directorConfig) {
          throw new Error("当前情境包未启用双导演策略");
        }
        packagePatch.directorConfig = {
          ...current.package.directorConfig,
          difficulty: input.patch.directorConfig.difficulty,
          cadence: input.patch.directorConfig.cadence,
          cooldownEvents: input.patch.directorConfig.cooldownEvents,
          allowedRouteIds: input.patch.directorConfig.allowedRouteIds,
          teacherApprovalRequired: true,
        };
      }
      if (input.patch.collaborationConfig !== undefined) {
        packagePatch.collaborationConfig = input.patch.collaborationConfig;
      }
      const next = ScenarioDraftSchema.parse({
        ...current,
        revision: current.revision + 1,
        package: ScenarioPackageSchema.parse({ ...current.package, ...packagePatch }),
        updatedBy: input.actorId,
        updatedAt: input.now ?? new Date().toISOString(),
        lastValidation: null,
      });
      await this.#store.append({ kind: "draft_snapshot", draft: next });
      this.#drafts.set(next.draftId, next);
      return structuredClone(next);
    } finally {
      releaseLock();
    }
  }

  async validateDraft(input: {
    draftId: string;
    expectedRevision: number;
    now?: string;
    collaborationStrategySnapshot?: readonly CollaborationStrategy[];
  }): Promise<ScenarioValidationReport> {
    const releaseLock = await this.acquireWriteLock();
    try {
      const current = this.getDraft(input.draftId);
      if (current.revision !== input.expectedRevision) {
        throw new ScenarioRevisionConflictError(input.expectedRevision, current.revision);
      }
      const report = validateScenarioPackage(current.package, {
        draftId: current.draftId,
        revision: current.revision,
        requireCollaborationConfig: this.requiresCollaborationConfig(current),
        ...(input.collaborationStrategySnapshot
          ? { collaborationStrategySnapshot: input.collaborationStrategySnapshot }
          : {}),
        ...(input.now ? { validatedAt: input.now } : {}),
      });
      const next = ScenarioDraftSchema.parse({ ...current, lastValidation: report });
      await this.#store.append({ kind: "draft_snapshot", draft: next });
      this.#drafts.set(next.draftId, next);
      return report;
    } finally {
      releaseLock();
    }
  }

  previewDraft(input: {
    draftId: string;
    expectedRevision: number;
    now?: string;
    collaborationStrategySnapshot?: readonly CollaborationStrategy[];
  }): ScenarioPreview {
    const current = this.getDraft(input.draftId);
    if (current.revision !== input.expectedRevision) {
      throw new ScenarioRevisionConflictError(input.expectedRevision, current.revision);
    }
    const report = validateScenarioPackage(current.package, {
      draftId: current.draftId,
      revision: current.revision,
      requireCollaborationConfig: this.requiresCollaborationConfig(current),
      ...(input.collaborationStrategySnapshot
        ? { collaborationStrategySnapshot: input.collaborationStrategySnapshot }
        : {}),
      ...(input.now ? { validatedAt: input.now } : {}),
    });
    const source = current.sourceRef ? this.resolve(current.sourceRef).package : null;
    return ScenarioPreviewSchema.parse({
      draftId: current.draftId,
      revision: current.revision,
      definitionHash: report.definitionHash,
      report,
      summary: {
        title: current.package.title,
        version: current.package.version,
        roleCount: current.package.roles.length,
        nodeCount: current.package.nodes.length,
        materialCount: current.package.materials.length,
        interactionCount: current.package.roleInteractions.length,
        knowledgeChunkCount: current.package.knowledgeChunks.length,
        approvalPolicyCount: current.package.approvalPolicies.length,
        changedFields: changedFields(source, current.package),
      },
    });
  }

  async publishDraft(input: {
    draftId: string;
    expectedRevision: number;
    validationStamp: string;
    actorId: string;
    now?: string;
    releaseId?: string;
    collaborationStrategySnapshot?: readonly CollaborationStrategy[];
  }): Promise<PublishedScenarioPackage> {
    const releaseLock = await this.acquireWriteLock();
    try {
      const current = this.getDraft(input.draftId);
      if (current.revision !== input.expectedRevision) {
        throw new ScenarioRevisionConflictError(input.expectedRevision, current.revision);
      }
      const report = validateScenarioPackage(current.package, {
        draftId: current.draftId,
        revision: current.revision,
        requireCollaborationConfig: this.requiresCollaborationConfig(current),
        ...(input.collaborationStrategySnapshot
          ? { collaborationStrategySnapshot: input.collaborationStrategySnapshot }
          : {}),
        ...(current.lastValidation?.validatedAt
          ? { validatedAt: current.lastValidation.validatedAt }
          : {}),
      });
      if (
        !report.valid
        || !current.lastValidation?.valid
        || current.lastValidation.definitionHash !== report.definitionHash
        || current.lastValidation.validationStamp !== input.validationStamp
      ) {
        throw new ScenarioPublishConflictError("发布所用校验戳已失效，请重新校验当前修订");
      }
      const duplicateVersion = [...this.#releases.values()].find((release) => (
        release.ref.scenarioId === current.package.scenarioId
        && release.ref.version === current.package.version
      ));
      if (duplicateVersion) {
        if (duplicateVersion.ref.contentHash === report.definitionHash) return structuredClone(duplicateVersion);
        throw new ScenarioPublishConflictError(`情境版本已存在且内容不同：${current.package.version}`);
      }
      const contentHash = hashScenarioPackage(current.package);
      const releaseId = input.releaseId
      ?? `release-${current.package.scenarioId}-${current.package.version}-${contentHash.slice(0, 12)}`;
      if (this.#releases.has(releaseId)) {
        throw new ScenarioPublishConflictError(`情境发布标识已存在：${releaseId}`);
      }
      const release = PublishedScenarioPackageSchema.parse({
        ref: {
          releaseId,
          scenarioId: current.package.scenarioId,
          version: current.package.version,
          schemaVersion: current.package.schemaVersion,
          contentHash,
        },
        compilerVersion: ScenarioCompilerVersion,
        package: current.package,
        publishedBy: input.actorId,
        publishedAt: input.now ?? new Date().toISOString(),
        sourceDraftId: current.draftId,
      });
      await this.#store.append({ kind: "release_published", release });
      this.#releases.set(release.ref.releaseId, release);
      return structuredClone(release);
    } finally {
      releaseLock();
    }
  }

  private async acquireWriteLock(): Promise<() => void> {
    const previous = this.#writeTail;
    let release!: () => void;
    this.#writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  private assertReleaseIntegrity(release: PublishedScenarioPackage): void {
    if (
      release.ref.scenarioId !== release.package.scenarioId
      || release.ref.version !== release.package.version
      || release.ref.schemaVersion !== release.package.schemaVersion
      || release.ref.contentHash !== hashScenarioPackage(release.package)
    ) {
      throw new Error(`情境发布快照哈希不匹配：${release.ref.releaseId}`);
    }
  }

  private requiresCollaborationConfig(draft: ScenarioDraft): boolean {
    return Boolean(
      draft.sourceRef
      && `${draft.sourceRef.scenarioId}@${draft.sourceRef.version}`
        === FlagshipCollaborationScenarioReleaseId,
    );
  }

  private assertInitialized(): void {
    if (!this.#initialized) throw new Error("情境目录尚未初始化");
  }
}

export function createSeedRelease(input: {
  releaseId: string;
  package: ScenarioPackage;
  publishedBy?: string;
  publishedAt?: string;
}): PublishedScenarioPackage {
  const scenario = ScenarioPackageSchema.parse(input.package);
  const contentHash = hashScenarioPackage(scenario);
  return PublishedScenarioPackageSchema.parse({
    ref: {
      releaseId: input.releaseId,
      scenarioId: scenario.scenarioId,
      version: scenario.version,
      schemaVersion: scenario.schemaVersion,
      contentHash,
    },
    compilerVersion: ScenarioCompilerVersion,
    package: scenario,
    publishedBy: input.publishedBy ?? "system-bootstrap",
    publishedAt: input.publishedAt ?? "2026-07-25T00:00:00.000Z",
    sourceDraftId: null,
  });
}
