import {
  appendFile,
  cp,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadGoldCompetitionOfficialEvidence,
} from "../src/gold-competition-official-loader.js";

const evidenceRoot = fileURLToPath(
  new URL("../../../artifacts/gold-readiness/", import.meta.url),
);
const temporaryDirectories: string[] = [];

async function copiedEvidenceRoot(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "ronggang-gold-official-"),
  );
  temporaryDirectories.push(directory);
  const target = join(directory, "gold-readiness");
  await cp(evidenceRoot, target, { recursive: true });
  return target;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(
      (directory) => rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("gold competition official evidence loader", () => {
  it("verifies the official source registry and complete requirement matrix", async () => {
    const evidence = await loadGoldCompetitionOfficialEvidence(evidenceRoot);

    expect(evidence.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      integrity: artifact.integrity,
    }))).toEqual([
      { artifactId: "source_registry", integrity: "verified" },
      { artifactId: "requirement_matrix", integrity: "verified" },
    ]);
    expect(evidence.registry?.sources.map((source) => source.sourceType))
      .toEqual(["competition_rules", "iflytek_requirements"]);
    expect(evidence.matrix?.requirements).toHaveLength(17);
    expect(evidence.matrix?.requirements.filter(
      (requirement) => requirement.mappingStatus === "mapped",
    )).toHaveLength(17);
    expect(evidence.matrix?.requirements.filter(
      (requirement) => requirement.evidenceStatus === "passed",
    )).toHaveLength(6);
    expect(evidence.matrix?.requirements.filter(
      (requirement) => requirement.evidenceStatus === "insufficient",
    )).toHaveLength(8);
    expect(evidence.matrix?.requirements.filter(
      (requirement) => requirement.evidenceStatus === "unverified",
    )).toHaveLength(3);
  });

  it("fails closed when the registry or matrix is no longer valid", async () => {
    const target = await copiedEvidenceRoot();
    await appendFile(
      join(target, "official", "source-registry.json"),
      "\n{",
      "utf8",
    );
    await appendFile(
      join(target, "official", "requirement-matrix.json"),
      "\n{",
      "utf8",
    );

    const evidence = await loadGoldCompetitionOfficialEvidence(target);

    expect(evidence.registry).toBeNull();
    expect(evidence.matrix).toBeNull();
    expect(evidence.artifacts.map((artifact) => artifact.integrity))
      .toEqual(["invalid", "invalid"]);
  });

  it("returns two missing artifacts instead of inventing official alignment", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ronggang-gold-official-missing-"),
    );
    temporaryDirectories.push(directory);

    const evidence = await loadGoldCompetitionOfficialEvidence(
      join(directory, "missing"),
    );

    expect(evidence.artifacts).toHaveLength(2);
    expect(evidence.artifacts.every(
      (artifact) => artifact.integrity === "missing",
    )).toBe(true);
    expect(evidence.registry).toBeNull();
    expect(evidence.matrix).toBeNull();
  });
});
