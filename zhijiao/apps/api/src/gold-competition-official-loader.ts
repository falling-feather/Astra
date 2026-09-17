import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  GoldCompetitionOfficialArtifactSchema,
  GoldCompetitionOfficialRequirementMatrixSchema,
  GoldCompetitionOfficialSourceRegistrySchema,
  type GoldCompetitionOfficialArtifact,
  type GoldCompetitionOfficialRequirementMatrix,
  type GoldCompetitionOfficialSourceRegistry,
} from "@ronggang/contracts";
import type {
  GoldCompetitionLoadedOfficialEvidence,
} from "@ronggang/agent-runtime";
import { hashValue } from "@ronggang/context-engine";
import type { ZodType } from "zod";

const sourceRegistryPath = "official/source-registry.json";
const requirementMatrixPath = "official/requirement-matrix.json";

interface LoadedJson<T> {
  data: T;
  bytes: Buffer;
  fileSha256: string;
}

interface LoadAttempt<T> {
  value: LoadedJson<T> | null;
  missing: boolean;
  rationale: string | null;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveOfficialPath(
  evidenceDir: string,
  relativePath: string,
): string {
  if (
    isAbsolute(relativePath)
    || relativePath.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("官方对齐来源路径不是安全的包内相对路径");
  }
  const base = resolve(evidenceDir);
  const target = resolve(base, relativePath);
  const relation = relative(base, target);
  if (
    relation.startsWith("..")
    || isAbsolute(relation)
    || relation.length === 0
  ) {
    throw new Error("官方对齐来源路径越出冻结工件目录");
  }
  return target;
}

async function readJson<T>(
  evidenceDir: string,
  relativePath: string,
  schema: ZodType<T>,
): Promise<LoadedJson<T>> {
  const bytes = await readFile(
    resolveOfficialPath(evidenceDir, relativePath),
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const raw: unknown = JSON.parse(text);
  return {
    data: schema.parse(raw),
    bytes,
    fileSha256: sha256(bytes),
  };
}

async function attemptJson<T>(
  evidenceDir: string,
  relativePath: string,
  schema: ZodType<T>,
): Promise<LoadAttempt<T>> {
  try {
    return {
      value: await readJson(evidenceDir, relativePath, schema),
      missing: false,
      rationale: null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        value: null,
        missing: true,
        rationale: `未找到官方对齐工件 ${relativePath}。`,
      };
    }
    return {
      value: null,
      missing: false,
      rationale:
        `${relativePath} 的格式、编码或严格契约校验失败，已按失败关闭处理。`,
    };
  }
}

function verifyRegistry(
  registry: GoldCompetitionOfficialSourceRegistry,
): void {
  const { registryHash, ...unsigned } = registry;
  if (hashValue(unsigned) !== registryHash) {
    throw new Error("官方来源 registryHash 与规范化内容不一致");
  }
}

function verifyMatrix(
  matrix: GoldCompetitionOfficialRequirementMatrix,
  registry: GoldCompetitionOfficialSourceRegistry,
): void {
  const { matrixHash, ...unsigned } = matrix;
  if (hashValue(unsigned) !== matrixHash) {
    throw new Error("官方条款 matrixHash 与规范化内容不一致");
  }
  if (matrix.sourceRegistryHash !== registry.registryHash) {
    throw new Error("官方条款矩阵没有绑定当前来源登记");
  }
  const sourceIds = new Set(
    registry.sources.map((source) => source.sourceId),
  );
  if (
    matrix.requirements.some((requirement) => (
      requirement.sourceIds.some((sourceId) => !sourceIds.has(sourceId))
    ))
  ) {
    throw new Error("官方条款矩阵引用了来源登记之外的来源");
  }
}

function officialArtifact(input: {
  artifactId: GoldCompetitionOfficialArtifact["artifactId"];
  label: string;
  relativePath: string;
  integrity: GoldCompetitionOfficialArtifact["integrity"];
  loaded?: LoadedJson<unknown> | null;
  contentHash?: string | null;
  rationale: string;
}): GoldCompetitionOfficialArtifact {
  return GoldCompetitionOfficialArtifactSchema.parse({
    artifactId: input.artifactId,
    label: input.label,
    relativePath: input.relativePath,
    integrity: input.integrity,
    fileSha256: input.loaded?.fileSha256 ?? null,
    contentHash: input.contentHash ?? null,
    bytes: input.loaded?.bytes.byteLength ?? null,
    rationale: input.rationale,
  });
}

export async function loadGoldCompetitionOfficialEvidence(
  evidenceDir: string,
): Promise<GoldCompetitionLoadedOfficialEvidence> {
  const [registryAttempt, matrixAttempt] = await Promise.all([
    attemptJson(
      evidenceDir,
      sourceRegistryPath,
      GoldCompetitionOfficialSourceRegistrySchema,
    ),
    attemptJson(
      evidenceDir,
      requirementMatrixPath,
      GoldCompetitionOfficialRequirementMatrixSchema,
    ),
  ]);

  let registry: GoldCompetitionOfficialSourceRegistry | null =
    registryAttempt.value?.data ?? null;
  let registryIntegrity: GoldCompetitionOfficialArtifact["integrity"] =
    registryAttempt.missing ? "missing" : "invalid";
  let registryRationale = registryAttempt.rationale
    ?? "来源登记已通过严格契约、双来源覆盖与规范化 registryHash 校验；外部内容哈希保留为取回收据。";
  if (registryAttempt.value) {
    try {
      verifyRegistry(registryAttempt.value.data);
      registryIntegrity = "verified";
    } catch {
      registry = null;
      registryIntegrity = "invalid";
      registryRationale =
        "来源登记与冻结 registryHash 不一致，已按失败关闭处理。";
    }
  }

  let matrix: GoldCompetitionOfficialRequirementMatrix | null =
    matrixAttempt.value?.data ?? null;
  let matrixIntegrity: GoldCompetitionOfficialArtifact["integrity"] =
    matrixAttempt.missing ? "missing" : "invalid";
  let matrixRationale = matrixAttempt.rationale
    ?? "条款矩阵已通过严格契约、固定要求全集、来源引用与规范化 matrixHash 校验。";
  if (matrixAttempt.value && registry) {
    try {
      verifyMatrix(matrixAttempt.value.data, registry);
      matrixIntegrity = "verified";
    } catch {
      matrix = null;
      matrixIntegrity = "invalid";
      matrixRationale =
        "条款矩阵哈希、来源绑定或来源引用不一致，已按失败关闭处理。";
    }
  } else if (matrixAttempt.value) {
    matrix = null;
    matrixIntegrity = "invalid";
    matrixRationale =
      "条款矩阵存在，但来源登记缺失或无效，无法复核来源绑定。";
  }

  return {
    artifacts: [
      officialArtifact({
        artifactId: "source_registry",
        label: "当届官方来源登记",
        relativePath: sourceRegistryPath,
        integrity: registryIntegrity,
        loaded: registryAttempt.value,
        contentHash: registry?.registryHash ?? null,
        rationale: registryRationale,
      }),
      officialArtifact({
        artifactId: "requirement_matrix",
        label: "XA-202603 官方条款矩阵",
        relativePath: requirementMatrixPath,
        integrity: matrixIntegrity,
        loaded: matrixAttempt.value,
        contentHash: matrix?.matrixHash ?? null,
        rationale: matrixRationale,
      }),
    ],
    registry,
    matrix,
  };
}

export type GoldCompetitionOfficialEvidenceLoader =
  () => Promise<GoldCompetitionLoadedOfficialEvidence>;

export function createGoldCompetitionOfficialEvidenceLoader(
  evidenceDir: string,
): GoldCompetitionOfficialEvidenceLoader {
  return () => loadGoldCompetitionOfficialEvidence(evidenceDir);
}
