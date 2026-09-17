import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GoldBlindReviewWorkflowSchemaVersion,
  GoldBlindReviewWorkflowViewSchema,
  GoldBlindReviewConditionKeyEntrySchema,
  GoldBlindReviewPacketSchema,
  GoldCompetitionGoldenDemoEvidenceSchema,
  GoldCompetitionOfficialArtifactSchema,
  GoldCompetitionOfficialRequirementMatrixSchema,
  GoldCompetitionOfficialSourceRegistrySchema,
  GoldCompetitionReadinessSnapshotSchema,
  GoldCompetitionScorecardArtifactSchema,
  GoldCompetitionScorecardSchema,
  GoldCompetitionSourceArtifactSchema,
  GoldControlledAblationBundleSchema,
  GoldPilotReadinessSchemaVersion,
  GoldPilotReadinessWorkflowViewSchema,
  GoldPilotStudySchemaVersion,
  GoldPilotWorkflowViewSchema,
  GoldTechnicalEvidenceManifestSchema,
  GoldTransferConfigurationProofSchema,
  type GoldCompetitionSourceArtifact,
  type GoldCompetitionOfficialArtifact,
  type GoldCompetitionScorecardArtifact,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  createGoldCompetitionReadinessSnapshot,
  createGoldPilotProtocol,
} from "../src/index.js";

const generatedAt = "2026-07-30T12:00:00.000Z";
const evidenceRoot = fileURLToPath(
  new URL("../../../artifacts/gold-readiness/", import.meta.url),
);

async function readEvidenceJson(relativePath: string): Promise<unknown> {
  return JSON.parse(
    await readFile(`${evidenceRoot}/${relativePath}`, "utf8"),
  );
}

function sourceArtifact(input: {
  sourceId: GoldCompetitionSourceArtifact["sourceId"];
  relativePath: string;
  integrity: GoldCompetitionSourceArtifact["integrity"];
  contentHash: string | null;
}): GoldCompetitionSourceArtifact {
  return GoldCompetitionSourceArtifactSchema.parse({
    sourceId: input.sourceId,
    label: input.sourceId,
    relativePath: input.relativePath,
    integrity: input.integrity,
    fileSha256: input.contentHash,
    contentHash: input.contentHash,
    bytes: input.contentHash ? 100 : null,
    rationale: `fixture ${input.sourceId} ${input.integrity}`,
  });
}

function officialArtifact(input: {
  artifactId: GoldCompetitionOfficialArtifact["artifactId"];
  relativePath: string;
  contentHash: string;
}): GoldCompetitionOfficialArtifact {
  return GoldCompetitionOfficialArtifactSchema.parse({
    artifactId: input.artifactId,
    label: input.artifactId,
    relativePath: input.relativePath,
    integrity: "verified",
    fileSha256: input.contentHash,
    contentHash: input.contentHash,
    bytes: 100,
    rationale: `fixture ${input.artifactId} verified`,
  });
}

function scorecardArtifact(input: {
  relativePath: string;
  contentHash: string;
}): GoldCompetitionScorecardArtifact {
  return GoldCompetitionScorecardArtifactSchema.parse({
    artifactId: "official_scorecard",
    label: "official scorecard",
    relativePath: input.relativePath,
    integrity: "verified",
    fileSha256: input.contentHash,
    contentHash: input.contentHash,
    bytes: 100,
    rationale: "fixture official scorecard verified",
  });
}

function emptyWorkflows() {
  const blindReview = GoldBlindReviewWorkflowViewSchema.parse({
    schemaVersion: GoldBlindReviewWorkflowSchemaVersion,
    generatedAt,
    activeBatch: null,
    batches: [],
    claimBoundary: "尚无独立盲评收据。",
  });
  const pilotReadiness = GoldPilotReadinessWorkflowViewSchema.parse({
    schemaVersion: GoldPilotReadinessSchemaVersion,
    generatedAt,
    activePlan: null,
    plans: [],
    claimBoundary: "尚无采集前冻结收据。",
  });
  const pilotStudy = GoldPilotWorkflowViewSchema.parse({
    schemaVersion: GoldPilotStudySchemaVersion,
    generatedAt,
    protocol: createGoldPilotProtocol(),
    activeStudy: null,
    studies: [],
    currentRun: null,
    claimBoundary: "尚无真实试点与分析报告。",
  });
  return { blindReview, pilotReadiness, pilotStudy };
}

describe("gold competition readiness snapshot", () => {
  it("keeps implementation, empirical evidence, six deliverables, and external boundaries separate", async () => {
    const [
      manifestRaw,
      ablationRaw,
      blindPacketRaw,
      conditionKeyRaw,
      transferRaw,
      officialRegistryRaw,
      officialMatrixRaw,
      scorecardRaw,
    ] = await Promise.all([
      readEvidenceJson("manifest.json"),
      readEvidenceJson("ablation/controlled-live-report.json"),
      readEvidenceJson("ablation/blind-review-packet.json"),
      readEvidenceJson("ablation/condition-key.json"),
      readEvidenceJson("transfer/configuration-proof.json"),
      readEvidenceJson("official/source-registry.json"),
      readEvidenceJson("official/requirement-matrix.json"),
      readEvidenceJson("official/scorecard.json"),
    ]);
    const technicalManifest =
      GoldTechnicalEvidenceManifestSchema.parse(manifestRaw);
    const controlledAblation =
      GoldControlledAblationBundleSchema.parse({
        ...(ablationRaw as Record<string, unknown>),
        blindReviewPacket: GoldBlindReviewPacketSchema.parse(blindPacketRaw),
        conditionKey: GoldBlindReviewConditionKeyEntrySchema.array().parse(
          (conditionKeyRaw as { conditionKey?: unknown }).conditionKey,
        ),
      });
    const transferProof =
      GoldTransferConfigurationProofSchema.parse(transferRaw);
    const officialRegistry =
      GoldCompetitionOfficialSourceRegistrySchema.parse(officialRegistryRaw);
    const officialMatrix =
      GoldCompetitionOfficialRequirementMatrixSchema.parse(officialMatrixRaw);
    const scorecard =
      GoldCompetitionScorecardSchema.parse(scorecardRaw);
    const goldenDemo = GoldCompetitionGoldenDemoEvidenceSchema.parse({
      status: "passed",
      scenarioVersion: "1.1.1",
      durationMs: 520_805,
      minimumMs: 480_000,
      maximumMs: 720_000,
      withinTargetWindow: true,
      worldEventCount: 355,
      evidenceCount: 18,
      taskCount: 82,
      runCount: 82,
      failureCount: 0,
      degradedCount: 0,
      pendingCount: 0,
      abnormalCount: 0,
      finalScore: 92.2,
      learningReplay: {
        status: "passed",
        passedCaseCount: 4,
        testCaseCount: 4,
        privacyViolationCount: 0,
      },
      browserConsoleLogCount: 0,
      providerBoundary: {
        iflytekMode: "mock",
        semanticModelMode: "deterministic_mock",
        machineOutputsRemain: "unverified_observation",
      },
      screenshotCount: 10,
      screenshotsVerified: true,
      limitations: [
        "该快照不替代真实模型、真实学生成效或官方赛事证明。",
      ],
    });
    const sources = [
      sourceArtifact({
        sourceId: "technical_manifest",
        relativePath: "manifest.json",
        integrity: "verified",
        contentHash: technicalManifest.manifestHash,
      }),
      sourceArtifact({
        sourceId: "golden_demo_run",
        relativePath: "demo/formal/run.json",
        integrity: "validated",
        contentHash: "a".repeat(64),
      }),
      sourceArtifact({
        sourceId: "golden_demo_screenshots",
        relativePath: "demo/formal/screenshot-manifest.json",
        integrity: "verified",
        contentHash: "b".repeat(64),
      }),
      sourceArtifact({
        sourceId: "controlled_ablation",
        relativePath: "ablation/controlled-live-report.json",
        integrity: "verified",
        contentHash: controlledAblation.bundleHash,
      }),
      sourceArtifact({
        sourceId: "transfer_proof",
        relativePath: "transfer/configuration-proof.json",
        integrity: "verified",
        contentHash: transferProof.proofHash,
      }),
    ];
    const snapshotInput = {
      generatedAt,
      productVersion: "1.0.0",
      evidence: {
        sourceArtifacts: sources,
        technicalManifest,
        goldenDemo,
        controlledAblation,
        transferProof,
      },
      ...emptyWorkflows(),
      iflytekHealth: {
        provider: "iflytek",
        mode: "mock",
        capabilities: [{
          capability: "asr",
          available: true,
          configured: false,
          endpoint: null,
        }],
      },
      officialEvidence: {
        artifacts: [
          officialArtifact({
            artifactId: "source_registry",
            relativePath: "official/source-registry.json",
            contentHash: officialRegistry.registryHash,
          }),
          officialArtifact({
            artifactId: "requirement_matrix",
            relativePath: "official/requirement-matrix.json",
            contentHash: officialMatrix.matrixHash,
          }),
        ],
        registry: officialRegistry,
        matrix: officialMatrix,
      },
      scorecardEvidence: {
        artifact: scorecardArtifact({
          relativePath: "official/scorecard.json",
          contentHash: scorecard.scorecardHash,
        }),
        scorecard,
      },
    } satisfies Parameters<
      typeof createGoldCompetitionReadinessSnapshot
    >[0];
    const snapshot = createGoldCompetitionReadinessSnapshot(snapshotInput);
    GoldCompetitionReadinessSnapshotSchema.parse(snapshot);

    expect(snapshot.coreClaims.map((claim) => ({
      claimId: claim.claimId,
      implementation: claim.implementationStatus,
      empirical: claim.empiricalStatus,
    }))).toEqual([
      {
        claimId: "dual_dimension_professional_world",
        implementation: "passed",
        empirical: "insufficient",
      },
      {
        claimId: "private_view_event_driven_agents",
        implementation: "passed",
        empirical: "insufficient",
      },
      {
        claimId: "evidence_based_teacher_review",
        implementation: "passed",
        empirical: "insufficient",
      },
    ]);
    expect(snapshot.deliverables.map((deliverable) => ({
      deliverableId: deliverable.deliverableId,
      status: deliverable.status,
      adverseFinding: deliverable.adverseFinding,
    }))).toEqual([
      {
        deliverableId: "golden_demo",
        status: "passed",
        adverseFinding: false,
      },
      {
        deliverableId: "controlled_ablation",
        status: "insufficient",
        adverseFinding: true,
      },
      {
        deliverableId: "evaluation_validity",
        status: "insufficient",
        adverseFinding: false,
      },
      {
        deliverableId: "teaching_pilot",
        status: "insufficient",
        adverseFinding: false,
      },
      {
        deliverableId: "transferability",
        status: "passed",
        adverseFinding: false,
      },
      {
        deliverableId: "competition_package",
        status: "insufficient",
        adverseFinding: false,
      },
    ]);
    expect(snapshot.summary).toMatchObject({
      overallStatus: "insufficient",
      passedDeliverableCount: 2,
      failedDeliverableCount: 0,
      insufficientDeliverableCount: 4,
      unverifiedDeliverableCount: 0,
      readyForCompetitionClaim: false,
    });
    expect(snapshot.officialAlignment).toMatchObject({
      status: "insufficient",
      sourceCount: 2,
      requirementCount: 17,
      mappedRequirementCount: 17,
      passedRequirementCount: 6,
      insufficientRequirementCount: 8,
      unverifiedRequirementCount: 3,
    });
    expect(snapshot.officialScorecard).toMatchObject({
      status: "insufficient",
      dimensionCount: 3,
      itemCount: 6,
      evidencePassedItemCount: 1,
      evidenceInsufficientItemCount: 5,
      evidenceReadyMaxScore: 10,
      scoredItemCount: 0,
      independentMockScoreTotal: null,
      verifiedMaterialBindingCount: 0,
    });
    expect(snapshot.officialScorecard.blockingItemIds).toHaveLength(6);
    expect(snapshot.iflytekFit.status).toBe("unverified");

    const serialized = JSON.stringify(snapshot);
    for (const sensitiveField of [
      "sessionId",
      "participantAlias",
      "reviewerAlias",
      "actorId",
      "runId",
      "evaluationCaseId",
    ]) {
      expect(serialized).not.toContain(sensitiveField);
    }
    const { snapshotHash, ...unsigned } = snapshot;
    expect(snapshotHash).toBe(hashValue(unsigned));

    const partiallyLocatedScorecard = GoldCompetitionScorecardSchema.parse({
      ...scorecard,
      items: scorecard.items.map((item) => (
        item.scoreItemId === "extensibility"
          ? {
              ...item,
              assessment: {
                status: "frozen",
                score: 8,
                reviewerCount: 2,
                reviewedAt: generatedAt,
                receiptHash: "f".repeat(64),
                rationale: "两名独立评审已冻结本项内部模拟评分。",
              },
              materialBindings: item.materialBindings.map(
                (binding, index) => index === 0
                  ? {
                      ...binding,
                      status: "verified",
                      relativePath: "pitch/competition-deck.pdf",
                      locator: "第12页",
                      fileSha256: "e".repeat(64),
                      rationale: "PPT迁移证明页已登记并复核。",
                    }
                  : binding,
              ),
            }
          : item
      )),
    });
    const partiallyLocatedSnapshot =
      createGoldCompetitionReadinessSnapshot({
        ...snapshotInput,
        scorecardEvidence: {
          artifact: scorecardArtifact({
            relativePath: "official/scorecard.json",
            contentHash: partiallyLocatedScorecard.scorecardHash,
          }),
          scorecard: partiallyLocatedScorecard,
        },
      });
    expect(
      partiallyLocatedSnapshot.officialScorecard.blockingItemIds,
    ).toContain("extensibility");
  });

  it("fails closed when frozen technical, demo, or ablation sources are invalid", () => {
    const invalidHash = "c".repeat(64);
    const sources = [
      sourceArtifact({
        sourceId: "technical_manifest",
        relativePath: "manifest.json",
        integrity: "invalid",
        contentHash: invalidHash,
      }),
      sourceArtifact({
        sourceId: "golden_demo_run",
        relativePath: "demo/formal/run.json",
        integrity: "validated",
        contentHash: invalidHash,
      }),
      sourceArtifact({
        sourceId: "golden_demo_screenshots",
        relativePath: "demo/formal/screenshot-manifest.json",
        integrity: "invalid",
        contentHash: invalidHash,
      }),
      sourceArtifact({
        sourceId: "controlled_ablation",
        relativePath: "ablation/controlled-live-report.json",
        integrity: "invalid",
        contentHash: invalidHash,
      }),
      sourceArtifact({
        sourceId: "transfer_proof",
        relativePath: "transfer/configuration-proof.json",
        integrity: "missing",
        contentHash: null,
      }),
    ];
    const snapshot = createGoldCompetitionReadinessSnapshot({
      generatedAt,
      productVersion: "1.0.0",
      evidence: {
        sourceArtifacts: sources,
        technicalManifest: null,
        goldenDemo: null,
        controlledAblation: null,
        transferProof: null,
      },
      ...emptyWorkflows(),
      iflytekHealth: {
        provider: "iflytek",
        mode: "mock",
        capabilities: [],
      },
    });

    expect(snapshot.summary.overallStatus).toBe("failed");
    expect(snapshot.summary.readyForCompetitionClaim).toBe(false);
    expect(snapshot.coreClaims.every(
      (claim) => claim.implementationStatus === "failed",
    )).toBe(true);
    expect(snapshot.deliverables.find(
      (deliverable) => deliverable.deliverableId === "golden_demo",
    )?.status).toBe("failed");
    expect(snapshot.deliverables.find(
      (deliverable) => deliverable.deliverableId === "controlled_ablation",
    )?.status).toBe("failed");
    expect(snapshot.deliverables.find(
      (deliverable) => deliverable.deliverableId === "transferability",
    )?.status).toBe("unverified");
  });
});
