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
  loadGoldCompetitionScorecardEvidence,
} from "../src/gold-competition-scorecard-loader.js";

const evidenceRoot = fileURLToPath(
  new URL("../../../artifacts/gold-readiness/", import.meta.url),
);
const temporaryDirectories: string[] = [];

async function copiedEvidenceRoot(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "ronggang-gold-scorecard-"),
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

describe("gold competition scorecard evidence loader", () => {
  it("verifies the fixed 30/50/20 dimensions and six scoring items", async () => {
    const evidence = await loadGoldCompetitionScorecardEvidence(evidenceRoot);

    expect(evidence.artifact).toMatchObject({
      artifactId: "official_scorecard",
      integrity: "verified",
    });
    expect(evidence.scorecard?.dimensions.map((dimension) => ({
      dimensionId: dimension.dimensionId,
      maxScore: dimension.maxScore,
    }))).toEqual([
      {
        dimensionId: "functional_completeness_and_practicality",
        maxScore: 30,
      },
      {
        dimensionId: "technical_implementation_and_content_quality",
        maxScore: 50,
      },
      {
        dimensionId: "application_potential_and_completion_quality",
        maxScore: 20,
      },
    ]);
    expect(evidence.scorecard?.items.map((item) => item.maxScore))
      .toEqual([10, 20, 25, 25, 10, 10]);
    expect(evidence.scorecard?.items.filter(
      (item) => item.evidenceStatus === "passed",
    )).toHaveLength(1);
    expect(evidence.scorecard?.items.filter(
      (item) => item.evidenceStatus === "insufficient",
    )).toHaveLength(5);
    expect(evidence.scorecard?.items.every(
      (item) => (
        item.assessment.status === "not_reviewed"
        && item.assessment.score === null
      ),
    )).toBe(true);
  });

  it("fails closed when the scorecard JSON is no longer valid", async () => {
    const target = await copiedEvidenceRoot();
    await appendFile(
      join(target, "official", "scorecard.json"),
      "\n{",
      "utf8",
    );

    const evidence = await loadGoldCompetitionScorecardEvidence(target);

    expect(evidence.scorecard).toBeNull();
    expect(evidence.artifact.integrity).toBe("invalid");
  });

  it("returns a missing artifact without inventing a score", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ronggang-gold-scorecard-missing-"),
    );
    temporaryDirectories.push(directory);

    const evidence = await loadGoldCompetitionScorecardEvidence(
      join(directory, "missing"),
    );

    expect(evidence.scorecard).toBeNull();
    expect(evidence.artifact.integrity).toBe("missing");
    expect(evidence.artifact.contentHash).toBeNull();
  });
});
