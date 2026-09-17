import { describe, expect, it } from "vitest";
import {
  GoldTechnicalEvidenceSchemaVersion,
  GoldTransferAuthoringRunSchema,
  GoldTransferAuthoringRunSchemaVersion,
  GoldTransferConfigurationProofSchema,
} from "../src/index.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function passedAuthoringRun() {
  return {
    schemaVersion: GoldTransferAuthoringRunSchemaVersion,
    runId: "qa-002-forward-transfer-v1",
    status: "passed" as const,
    targetScenarioId: "scenario-forward-transfer-v1",
    operator: {
      authorRole: "content_author_assisted" as const,
      witnessRole: "qa" as const,
    },
    baseline: {
      sourceGitCommit: "c".repeat(40),
      sourceTreeState: "clean" as const,
      collectorSha256: hashA,
      templateBinding: {
        scenarioId: "scenario-template-v1",
        version: "1.0.0",
        releaseRef: "release-scenario-template-v1-1.0.0-baseline",
        contentHash: hashA,
        schemaVersion: "scenario-package/1.0.0",
      },
      targetAbsence: {
        repositoryMatchCount: 0 as const,
        workspaceUntrackedMatchCount: 0 as const,
        catalogMatchCount: 0 as const,
        catalogSourcesScanned: [".data/scenario-catalog.jsonl (missing)"],
      },
    },
    timing: {
      startedAt: "2026-07-30T01:00:00.000Z",
      completedAt: "2026-07-30T01:01:00.000Z",
      elapsedMs: 60_000,
      targetMaxMs: 28_800_000,
    },
    eventLog: {
      path: "artifacts/gold-transfer-authoring/qa-002-forward-transfer-v1/events.jsonl",
      eventCount: 2,
      sha256: hashA,
    },
    modifiedFiles: [{
      path: "packages/world-core/src/forward-transfer-scenario.ts",
      sha256: hashA,
      bytes: 128,
    }],
    validationAttempts: [{
      attemptedAt: "2026-07-30T01:00:50.000Z",
      valid: true,
      issueCount: 0,
      issueCodes: [],
      definitionHash: hashB,
      validationStamp: hashA,
    }],
    reuse: {
      method:
        "canonical-json-pointer-leaf-equality/target-pointer-universe" as const,
      reusedLeafCount: 1,
      comparableLeafCount: 2,
      ratio: 0.5,
      changedJsonPointers: ["/title"],
      reusedJsonPointers: ["/schemaVersion"],
    },
    structure: {
      status: "passed" as const,
      studentRoleCount: 2,
      privateNpcCount: 2,
      nodeCount: 3,
      hasStructuredMaterialTask: true,
      hasStudentTriggeredEvent: true,
      hasTeacherGate: true,
      hasFixedEvaluation: true,
    },
    forbiddenRuntimeScan: {
      status: "passed" as const,
      scannedPaths: ["apps/web/src"],
      topicMarkers: ["scenario-forward-transfer-v1"],
      matches: [],
    },
    targetRelease: {
      scenarioId: "scenario-forward-transfer-v1",
      version: "1.0.0",
      releaseRef: "release-scenario-forward-transfer-v1-1.0.0-baseline",
      contentHash: hashB,
      schemaVersion: "scenario-package/1.0.0",
    },
    runtimeSmoke: {
      status: "passed" as const,
      sessionId: "session-forward-transfer" as string | null,
      checkIds: [
        "three_node_path",
        "teacher_gate",
        "fixed_teacher_final",
      ],
      eventCount: 12,
      receiptHash: hashA,
      claimBoundary: "只证明技术闭环。",
    },
    claimBoundary: "只证明前瞻配置迁移工时与技术闭环。",
    runHash: hashA,
  };
}

describe("gold transfer authoring evidence contracts", () => {
  it("accepts a forward-timed, fully evidenced new scenario run", () => {
    const parsed = GoldTransferAuthoringRunSchema.parse(passedAuthoringRun());
    expect(parsed.status).toBe("passed");
    expect(parsed.timing.elapsedMs).toBe(60_000);
  });

  it("rejects backfilled identities, manual elapsed time, and passed overtime", () => {
    const sameIdentity = passedAuthoringRun();
    sameIdentity.targetScenarioId =
      sameIdentity.baseline.templateBinding.scenarioId;
    expect(GoldTransferAuthoringRunSchema.safeParse(sameIdentity).success)
      .toBe(false);

    const manualElapsed = passedAuthoringRun();
    manualElapsed.timing.elapsedMs = 30_000;
    expect(GoldTransferAuthoringRunSchema.safeParse(manualElapsed).success)
      .toBe(false);

    const overtime = passedAuthoringRun();
    overtime.timing.completedAt = "2026-07-30T10:00:00.000Z";
    overtime.timing.elapsedMs = 9 * 60 * 60 * 1_000;
    expect(GoldTransferAuthoringRunSchema.safeParse(overtime).success)
      .toBe(false);
  });

  it("rejects hollow runtime receipts and forged structural status", () => {
    const hollowRuntime = passedAuthoringRun();
    hollowRuntime.runtimeSmoke.sessionId = null;
    hollowRuntime.runtimeSmoke.eventCount = 0;
    hollowRuntime.runtimeSmoke.checkIds = ["three_node_path"];
    expect(GoldTransferAuthoringRunSchema.safeParse(hollowRuntime).success)
      .toBe(false);

    const forgedStructure = passedAuthoringRun();
    forgedStructure.structure.studentRoleCount = 0;
    expect(GoldTransferAuthoringRunSchema.safeParse(forgedStructure).success)
      .toBe(false);
  });

  it("keeps an untouched historical transfer proof insufficient", () => {
    const parsed = GoldTransferConfigurationProofSchema.parse({
      schemaVersion: GoldTechnicalEvidenceSchemaVersion,
      generatedAt: "2026-07-30T01:00:00.000Z",
      scenarioBinding: {
        role: "transfer",
        scenarioId: "scenario-template-v1",
        version: "1.0.0",
        releaseRef: "release-scenario-template-v1-1.0.0-baseline",
        contentHash: hashA,
      },
      configurationSourceRefs: ["packages/world-core/src/scenario.ts"],
      validation: {
        valid: true,
        issueCount: 0,
        definitionHash: hashA,
        validationStamp: hashB,
      },
      observedStructure: {
        studentRoleIds: ["student-a", "student-b"],
        privateNpcActorIds: ["npc-a", "npc-b"],
        nodeIds: ["one", "two", "three"],
        eventPolicyCount: 1,
        teacherApprovalPolicyCount: 1,
        rubricCriterionCount: 1,
      },
      forbiddenRuntimeScan: {
        scannedPaths: ["apps/web/src"],
        topicMarkers: ["scenario-template-v1"],
        matches: [],
        status: "passed",
      },
      architectureStatus: "passed",
      authoringTime: {
        targetMaxMinutes: 480,
        observedMinutes: null,
        status: "insufficient",
        evidenceRef: null,
        rationale: "历史工时不可追溯。",
      },
      overallStatus: "insufficient",
      claimBoundary: "不得回填历史工时。",
      proofHash: hashA,
    });

    expect(parsed.authoringTime).toMatchObject({
      runId: null,
      startedAt: null,
      completedAt: null,
      elapsedMs: null,
      baselineGitCommit: null,
      evidenceSnapshotGitCommit: null,
      status: "insufficient",
    });
  });

  it("requires proof minutes to be derived from the bound run clock", () => {
    const base = {
      schemaVersion: GoldTechnicalEvidenceSchemaVersion,
      generatedAt: "2026-07-30T01:02:00.000Z",
      scenarioBinding: {
        role: "transfer" as const,
        scenarioId: "scenario-forward-transfer-v1",
        version: "1.0.0",
        releaseRef: "release-scenario-forward-transfer-v1-1.0.0-baseline",
        contentHash: hashB,
      },
      configurationSourceRefs: ["packages/world-core/src/forward-transfer.ts"],
      validation: {
        valid: true,
        issueCount: 0,
        definitionHash: hashB,
        validationStamp: hashA,
      },
      observedStructure: {
        studentRoleIds: ["student-a", "student-b"],
        privateNpcActorIds: ["npc-a", "npc-b"],
        nodeIds: ["one", "two", "three"],
        eventPolicyCount: 1,
        teacherApprovalPolicyCount: 1,
        rubricCriterionCount: 1,
      },
      forbiddenRuntimeScan: {
        scannedPaths: ["apps/web/src"],
        topicMarkers: ["scenario-forward-transfer-v1"],
        matches: [],
        status: "passed" as const,
      },
      architectureStatus: "passed" as const,
      authoringTime: {
        targetMaxMinutes: 480,
        observedMinutes: 1,
        runId: "qa-002-forward-transfer-v1",
        startedAt: "2026-07-30T01:00:00.000Z",
        completedAt: "2026-07-30T01:01:00.000Z",
        elapsedMs: 60_000,
        baselineGitCommit: "c".repeat(40),
        evidenceSnapshotGitCommit: "d".repeat(40),
        status: "passed" as const,
        evidenceRef:
          "artifacts/gold-transfer-authoring/qa-002-forward-transfer-v1/run.json",
        rationale: "前瞻连续计时通过。",
      },
      overallStatus: "passed" as const,
      claimBoundary: "只证明本次前瞻迁移。",
      proofHash: hashA,
    };
    expect(GoldTransferConfigurationProofSchema.safeParse(base).success)
      .toBe(true);

    const forgedMinutes = structuredClone(base);
    forgedMinutes.authoringTime.observedMinutes = 0.5;
    expect(
      GoldTransferConfigurationProofSchema.safeParse(forgedMinutes).success,
    ).toBe(false);

    const missingSnapshot = {
      ...base,
      authoringTime: {
        ...base.authoringTime,
        evidenceSnapshotGitCommit: null,
      },
    };
    expect(
      GoldTransferConfigurationProofSchema.safeParse(missingSnapshot).success,
    ).toBe(false);
  });
});
