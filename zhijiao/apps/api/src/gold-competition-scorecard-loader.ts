import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  GoldCompetitionScorecardArtifactSchema,
  GoldCompetitionScorecardSchema,
  type GoldCompetitionScorecard,
  type GoldCompetitionScorecardArtifact,
} from "@ronggang/contracts";
import type {
  GoldCompetitionLoadedScorecardEvidence,
} from "@ronggang/agent-runtime";
import { hashValue } from "@ronggang/context-engine";

const scorecardPath = "official/scorecard.json";

interface LoadedScorecard {
  data: GoldCompetitionScorecard;
  bytes: Buffer;
  fileSha256: string;
}

interface ScorecardAttempt {
  value: LoadedScorecard | null;
  missing: boolean;
  rationale: string | null;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveScorecardPath(
  evidenceDir: string,
  relativePath: string,
): string {
  if (
    isAbsolute(relativePath)
    || relativePath.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("官方得分卡路径不是安全的包内相对路径");
  }
  const base = resolve(evidenceDir);
  const target = resolve(base, relativePath);
  const relation = relative(base, target);
  if (
    relation.startsWith("..")
    || isAbsolute(relation)
    || relation.length === 0
  ) {
    throw new Error("官方得分卡路径越出冻结工件目录");
  }
  return target;
}

async function attemptScorecard(
  evidenceDir: string,
): Promise<ScorecardAttempt> {
  try {
    const bytes = await readFile(
      resolveScorecardPath(evidenceDir, scorecardPath),
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const raw: unknown = JSON.parse(text);
    return {
      value: {
        data: GoldCompetitionScorecardSchema.parse(raw),
        bytes,
        fileSha256: sha256(bytes),
      },
      missing: false,
      rationale: null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        value: null,
        missing: true,
        rationale: `未找到官方得分卡工件 ${scorecardPath}。`,
      };
    }
    return {
      value: null,
      missing: false,
      rationale:
        `${scorecardPath} 的格式、编码或严格契约校验失败，已按失败关闭处理。`,
    };
  }
}

function verifyScorecard(scorecard: GoldCompetitionScorecard): void {
  const { scorecardHash, ...unsigned } = scorecard;
  if (hashValue(unsigned) !== scorecardHash) {
    throw new Error("官方得分卡 scorecardHash 与规范化内容不一致");
  }
}

function scorecardArtifact(input: {
  integrity: GoldCompetitionScorecardArtifact["integrity"];
  loaded?: LoadedScorecard | null;
  contentHash?: string | null;
  rationale: string;
}): GoldCompetitionScorecardArtifact {
  return GoldCompetitionScorecardArtifactSchema.parse({
    artifactId: "official_scorecard",
    label: "XA-202603 官方30/50/20得分卡",
    relativePath: scorecardPath,
    integrity: input.integrity,
    fileSha256: input.loaded?.fileSha256 ?? null,
    contentHash: input.contentHash ?? null,
    bytes: input.loaded?.bytes.byteLength ?? null,
    rationale: input.rationale,
  });
}

export async function loadGoldCompetitionScorecardEvidence(
  evidenceDir: string,
): Promise<GoldCompetitionLoadedScorecardEvidence> {
  const attempt = await attemptScorecard(evidenceDir);
  let scorecard = attempt.value?.data ?? null;
  let integrity: GoldCompetitionScorecardArtifact["integrity"] =
    attempt.missing ? "missing" : "invalid";
  let rationale = attempt.rationale
    ?? "得分卡已通过严格契约、固定30/50/20权重、六项全集、材料定位门与规范化 scorecardHash 校验。";

  if (attempt.value) {
    try {
      verifyScorecard(attempt.value.data);
      integrity = "verified";
    } catch {
      scorecard = null;
      integrity = "invalid";
      rationale =
        "官方得分卡与冻结 scorecardHash 不一致，已按失败关闭处理。";
    }
  }

  return {
    artifact: scorecardArtifact({
      integrity,
      loaded: attempt.value,
      contentHash: scorecard?.scorecardHash ?? null,
      rationale,
    }),
    scorecard,
  };
}

export type GoldCompetitionScorecardEvidenceLoader =
  () => Promise<GoldCompetitionLoadedScorecardEvidence>;

export function createGoldCompetitionScorecardEvidenceLoader(
  evidenceDir: string,
): GoldCompetitionScorecardEvidenceLoader {
  return () => loadGoldCompetitionScorecardEvidence(evidenceDir);
}
