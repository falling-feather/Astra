import {
  PublishedScenarioPackageSchema,
  ScenarioCompilerVersion,
  ScenarioPackageRefSchema,
  ScenarioPackageSchema,
  type PublishedScenarioPackage,
  type ScenarioPackage,
  type ScenarioPackageRef,
  type WorldEvent,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";

export interface ScenarioReleaseResolver {
  resolve(ref: ScenarioPackageRef): PublishedScenarioPackage;
  resolveLegacySessionRelease(
    scenarioId: string,
    version: string,
  ): PublishedScenarioPackage | null;
}

function legacyScenarioKey(scenarioId: string, version: string): string {
  return `${scenarioId}@${version}`;
}

export function createStaticScenarioRelease(input: {
  releaseId: string;
  package: ScenarioPackage;
  publishedAt?: string;
}): PublishedScenarioPackage {
  const scenario = ScenarioPackageSchema.parse(input.package);
  return PublishedScenarioPackageSchema.parse({
    ref: {
      releaseId: input.releaseId,
      scenarioId: scenario.scenarioId,
      version: scenario.version,
      schemaVersion: scenario.schemaVersion,
      contentHash: hashValue(scenario),
    },
    compilerVersion: ScenarioCompilerVersion,
    package: scenario,
    publishedBy: "system-bootstrap",
    publishedAt: input.publishedAt ?? "2026-07-25T00:00:00.000Z",
    sourceDraftId: null,
  });
}

export class StaticScenarioReleaseResolver implements ScenarioReleaseResolver {
  readonly #releases = new Map<string, PublishedScenarioPackage>();
  readonly #legacySessionRefs = new Map<string, ScenarioPackageRef>();

  constructor(
    releases: readonly PublishedScenarioPackage[],
    legacySessionRefs: readonly ScenarioPackageRef[] = [],
  ) {
    for (const rawRelease of releases) {
      const release = PublishedScenarioPackageSchema.parse(rawRelease);
      if (release.ref.contentHash !== hashValue(release.package)) {
        throw new Error(`情境发布快照哈希不匹配：${release.ref.releaseId}`);
      }
      this.#releases.set(release.ref.releaseId, structuredClone(release));
    }
    for (const rawRef of legacySessionRefs) {
      const release = this.resolve(rawRef);
      const key = legacyScenarioKey(release.ref.scenarioId, release.ref.version);
      const current = this.#legacySessionRefs.get(key);
      if (current && current.contentHash !== release.ref.contentHash) {
        throw new Error(`旧会话情境映射冲突：${key}`);
      }
      this.#legacySessionRefs.set(key, structuredClone(release.ref));
    }
  }

  resolve(rawRef: ScenarioPackageRef): PublishedScenarioPackage {
    const ref = ScenarioPackageRefSchema.parse(rawRef);
    const release = this.#releases.get(ref.releaseId);
    if (!release) throw new Error(`情境发布版不存在：${ref.releaseId}`);
    if (
      release.ref.scenarioId !== ref.scenarioId
      || release.ref.version !== ref.version
      || release.ref.schemaVersion !== ref.schemaVersion
      || release.ref.contentHash !== ref.contentHash
    ) {
      throw new Error(`情境发布引用与快照不一致：${ref.releaseId}`);
    }
    return structuredClone(release);
  }

  resolveLegacySessionRelease(
    scenarioId: string,
    version: string,
  ): PublishedScenarioPackage | null {
    const ref = this.#legacySessionRefs.get(legacyScenarioKey(scenarioId, version));
    return ref ? this.resolve(ref) : null;
  }
}

export function scenarioRefFromSessionStarted(
  events: readonly WorldEvent[],
  resolver: ScenarioReleaseResolver,
): ScenarioPackageRef {
  const started = events.find((event) => event.eventType === "session_started");
  if (!started) throw new Error("实训会话缺少 session_started 事件");
  const parsedRef = ScenarioPackageRefSchema.safeParse(started.payload.scenarioRef);
  if (parsedRef.success) return parsedRef.data;
  const scenarioId = typeof started.payload.scenarioId === "string"
    ? started.payload.scenarioId
    : "";
  const scenarioVersion = typeof started.payload.scenarioVersion === "string"
    ? started.payload.scenarioVersion
    : "";
  const legacyRelease = resolver.resolveLegacySessionRelease(scenarioId, scenarioVersion);
  if (!legacyRelease) {
    throw new Error(`旧会话情境版本无法解析：${scenarioId}@${scenarioVersion}`);
  }
  return legacyRelease.ref;
}
