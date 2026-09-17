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
import { loadGoldCompetitionEvidence } from "../src/gold-competition-evidence-loader.js";

const evidenceRoot = fileURLToPath(
  new URL("../../../artifacts/gold-readiness/", import.meta.url),
);
const temporaryDirectories: string[] = [];

async function copiedEvidenceRoot(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "ronggang-gold-competition-"),
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

describe("gold competition evidence loader", () => {
  it("verifies the checked-in evidence roots and returns only sanitized demo evidence", async () => {
    const evidence = await loadGoldCompetitionEvidence(evidenceRoot);

    expect(evidence.sourceArtifacts.map((source) => ({
      sourceId: source.sourceId,
      integrity: source.integrity,
    }))).toEqual([
      { sourceId: "technical_manifest", integrity: "verified" },
      { sourceId: "golden_demo_run", integrity: "validated" },
      { sourceId: "golden_demo_screenshots", integrity: "verified" },
      { sourceId: "controlled_ablation", integrity: "verified" },
      { sourceId: "transfer_proof", integrity: "verified" },
    ]);
    expect(evidence.goldenDemo).toMatchObject({
      status: "passed",
      screenshotCount: 10,
      screenshotsVerified: true,
      providerBoundary: {
        iflytekMode: "mock",
        semanticModelMode: "deterministic_mock",
        machineOutputsRemain: "unverified_observation",
      },
    });
    const serialized = JSON.stringify(evidence.goldenDemo);
    expect(serialized).not.toContain("sessionId");
    expect(serialized).not.toContain("artifactId");
    expect(serialized).not.toContain("evaluationCaseId");
    expect(evidence.controlledAblation?.report.conclusion)
      .toBe("insufficient_evidence");
    expect(evidence.transferProof?.overallStatus).toBe("passed");
  });

  it("fails closed when a frozen screenshot or manifest-listed artifact changes", async () => {
    const target = await copiedEvidenceRoot();
    await appendFile(
      join(
        target,
        "demo",
        "formal-v1.1.16-pass",
        "00-world-rain-consequence.png",
      ),
      new Uint8Array([0]),
    );
    await appendFile(
      join(target, "technical-plan.json"),
      new Uint8Array([0x20]),
    );

    const evidence = await loadGoldCompetitionEvidence(target);
    const source = (sourceId: string) => evidence.sourceArtifacts.find(
      (candidate) => candidate.sourceId === sourceId,
    );

    expect(source("golden_demo_screenshots")?.integrity).toBe("invalid");
    expect(source("technical_manifest")?.integrity).toBe("invalid");
    expect(evidence.goldenDemo).toBeNull();
    expect(evidence.technicalManifest).toBeNull();
    expect(source("controlled_ablation")?.integrity).toBe("verified");
    expect(source("transfer_proof")?.integrity).toBe("verified");
  });

  it("returns a complete missing-source snapshot instead of crashing", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ronggang-gold-competition-missing-"),
    );
    temporaryDirectories.push(directory);
    const target = join(directory, "missing");

    const evidence = await loadGoldCompetitionEvidence(target);

    expect(evidence.sourceArtifacts).toHaveLength(5);
    expect(evidence.sourceArtifacts.every(
      (source) => source.integrity === "missing",
    )).toBe(true);
    expect(evidence.technicalManifest).toBeNull();
    expect(evidence.goldenDemo).toBeNull();
    expect(evidence.controlledAblation).toBeNull();
    expect(evidence.transferProof).toBeNull();
  });
});
