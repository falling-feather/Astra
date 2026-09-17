import { describe, expect, it } from "vitest";
import {
  CourseReleaseSchema,
  ScenarioPackageSchema,
  createMessageMeta,
  type Command,
  type ScenarioPackage,
} from "@ronggang/contracts";
import { validateScenarioPackage } from "@ronggang/scenario-catalog";
import {
  WorldEngine,
  aiCopyrightRuntimeCourseContentHash,
  aiCopyrightRuntimeCourseRelease,
  aiCopyrightRuntimeScenario,
  aiCopyrightRuntimeScenarioContentHash,
  aiCopyrightRuntimeSectionMappings,
  aiCopyrightRuntimeSeedRelease,
  migrationRuntimeCourseReleases,
  migrationRuntime1CourseReleases,
  migrationRuntime1SeedReleases,
  migrationRuntimeScenarios,
  migrationRuntimeSeedReleases,
  rainEmergencyRuntimeCourseContentHash,
  rainEmergencyRuntimeCourseRelease,
  rainEmergencyRuntimeScenario,
  rainEmergencyRuntimeScenarioContentHash,
  rainEmergencyRuntimeSectionMappings,
  rainEmergencyRuntimeSeedRelease,
  villagePostpublicationRuntime1CourseContentHash,
  villagePostpublicationRuntime1CourseRelease,
  villagePostpublicationRuntime1Scenario,
  villagePostpublicationRuntime1ScenarioContentHash,
  villagePostpublicationRuntime1SeedRelease,
  villagePostpublicationRuntimeCourseContentHash,
  villagePostpublicationRuntimeCourseRelease,
  villagePostpublicationRuntimeScenario,
  villagePostpublicationRuntimeScenarioContentHash,
  villagePostpublicationRuntimeSectionMappings,
  villagePostpublicationRuntimeSeedRelease,
  villagePostpublicationRuntimeLaunchSuggestion,
  villageSuperRuntimeCourseContentHash,
  villageSuperRuntimeCourseRelease,
  villageSuperRuntimeScenario,
  villageSuperRuntimeScenarioContentHash,
  villageSuperRuntimeSectionMappings,
  villageSuperRuntimeSeedRelease,
  type MigrationRuntimeSectionMapping,
} from "../src/index.js";

interface ExpectedMapping {
  sectionId: string;
  actionIds: [string, string, string];
  primaryActionId: string;
  businessEventId: string;
  completionEventId: string;
  teacherGateId: string;
  businessApprovalPolicyId: string | null;
  mergedBusinessAndCompletion: boolean;
  terminal: boolean;
}

const villageExpected: ExpectedMapping[] = [
  {
    sectionId: "village-super-platform-map",
    actionIds: ["village-super-platform-map-action-map", "village-super-platform-map-action-verify", "village-super-platform-map-action-freeze"],
    primaryActionId: "village-super-platform-map-action-freeze",
    businessEventId: "village-super-platform-map-event-live-window-change",
    completionEventId: "village-super-platform-map:advance-event",
    teacherGateId: "gate-village-super-platform-map",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-super-story-angle",
    actionIds: ["village-super-story-angle-action-compare", "village-super-story-angle-action-challenge", "village-super-story-angle-action-pitch"],
    primaryActionId: "village-super-story-angle-action-pitch",
    businessEventId: "village-super-story-angle-event-community-voice-missing",
    completionEventId: "village-super-story-angle-event-community-voice-missing",
    teacherGateId: "gate-village-super-story-angle",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: true,
    terminal: false,
  },
  {
    sectionId: "village-super-storyboard",
    actionIds: ["village-super-storyboard-action-beats", "village-super-storyboard-action-rights", "village-super-storyboard-action-freeze"],
    primaryActionId: "village-super-storyboard-action-freeze",
    businessEventId: "village-super-storyboard-event-replacement-clip",
    completionEventId: "village-super-storyboard:advance-event",
    teacherGateId: "gate-village-super-storyboard",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-super-live-update",
    actionIds: ["village-super-live-update-action-ledger", "village-super-live-update-action-verify", "village-super-live-update-action-publish"],
    primaryActionId: "village-super-live-update-action-publish",
    businessEventId: "village-super-live-update-event-score-change",
    completionEventId: "village-super-live-update:advance-event",
    teacherGateId: "gate-village-super-live-update",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-super-platform-adaptation",
    actionIds: ["village-super-platform-adaptation-action-variants", "village-super-platform-adaptation-action-preflight", "village-super-platform-adaptation-action-approve"],
    primaryActionId: "village-super-platform-adaptation-action-approve",
    businessEventId: "village-super-platform-adaptation-event-rule-conflict",
    completionEventId: "village-super-platform-adaptation:advance-event",
    teacherGateId: "gate-village-super-platform-adaptation",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-super-data-review",
    actionIds: ["village-super-data-review-action-align", "village-super-data-review-action-evaluate", "village-super-data-review-action-submit"],
    primaryActionId: "village-super-data-review-action-submit",
    businessEventId: "village-super-data-review-event-anomaly-spike",
    completionEventId: "village-super-data-review:complete-event",
    teacherGateId: "gate-village-super-data-review",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: true,
  },
];

const villagePostpublicationExpected: ExpectedMapping[] = [
  {
    sectionId: "village-postpublication-context-triage",
    actionIds: ["village-postpublication-context-triage-action-compare", "village-postpublication-context-triage-action-classify", "village-postpublication-context-triage-action-freeze"],
    primaryActionId: "village-postpublication-context-triage-action-freeze",
    businessEventId: "village-postpublication-context-triage-event-context-challenge",
    completionEventId: "village-postpublication-context-triage:advance-event",
    teacherGateId: "gate-village-postpublication-context-triage",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-postpublication-interview-audit",
    actionIds: ["village-postpublication-interview-audit-action-audit", "village-postpublication-interview-audit-action-explain", "village-postpublication-interview-audit-action-submit-ledger"],
    primaryActionId: "village-postpublication-interview-audit-action-submit-ledger",
    businessEventId: "village-postpublication-interview-audit-event-version-audit-complete",
    completionEventId: "village-postpublication-interview-audit:advance-event",
    teacherGateId: "gate-village-postpublication-interview-audit",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-postpublication-scope-negotiation",
    actionIds: ["village-postpublication-scope-negotiation-action-scope", "village-postpublication-scope-negotiation-action-negotiate", "village-postpublication-scope-negotiation-action-submit-scope"],
    primaryActionId: "village-postpublication-scope-negotiation-action-submit-scope",
    businessEventId: "village-postpublication-scope-negotiation-event-scope-negotiation",
    completionEventId: "village-postpublication-scope-negotiation:advance-event",
    teacherGateId: "gate-village-postpublication-scope-negotiation",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-postpublication-multiplatform-correction",
    actionIds: ["village-postpublication-multiplatform-correction-action-build-variants", "village-postpublication-multiplatform-correction-action-preflight", "village-postpublication-multiplatform-correction-action-submit-correction"],
    primaryActionId: "village-postpublication-multiplatform-correction-action-submit-correction",
    businessEventId: "village-postpublication-multiplatform-correction-event-correction-package",
    completionEventId: "village-postpublication-multiplatform-correction:advance-event",
    teacherGateId: "gate-village-postpublication-multiplatform-correction",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "village-postpublication-impact-review",
    actionIds: ["village-postpublication-impact-review-action-align", "village-postpublication-impact-review-action-review", "village-postpublication-impact-review-action-submit-review"],
    primaryActionId: "village-postpublication-impact-review-action-submit-review",
    businessEventId: "village-postpublication-impact-review-event-impact-anomaly",
    completionEventId: "village-postpublication-impact-review:complete-event",
    teacherGateId: "gate-village-postpublication-impact-review",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: true,
  },
];

const aiExpected: ExpectedMapping[] = [
  {
    sectionId: "ai-copyright-source-ledger",
    actionIds: ["ai-copyright-source-ledger-action-register", "ai-copyright-source-ledger-action-trace", "ai-copyright-source-ledger-action-freeze"],
    primaryActionId: "ai-copyright-source-ledger-action-freeze",
    businessEventId: "ai-copyright-source-ledger-event-metadata-loss",
    completionEventId: "ai-copyright-source-ledger:advance-event",
    teacherGateId: "gate-ai-copyright-source-ledger",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "ai-copyright-generation-assessment",
    actionIds: ["ai-copyright-generation-assessment-action-decompose", "ai-copyright-generation-assessment-action-compare", "ai-copyright-generation-assessment-action-assess"],
    primaryActionId: "ai-copyright-generation-assessment-action-assess",
    businessEventId: "ai-copyright-generation-assessment-event-conflicting-detectors",
    completionEventId: "ai-copyright-generation-assessment:advance-event",
    teacherGateId: "gate-ai-copyright-generation-assessment",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "ai-copyright-rights-check",
    actionIds: ["ai-copyright-rights-check-action-ownership", "ai-copyright-rights-check-action-scope", "ai-copyright-rights-check-action-dispose"],
    primaryActionId: "ai-copyright-rights-check-action-dispose",
    businessEventId: "ai-copyright-rights-check-event-license-conflict",
    completionEventId: "ai-copyright-rights-check:advance-event",
    teacherGateId: "gate-ai-copyright-rights-check",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "ai-copyright-labeling",
    actionIds: ["ai-copyright-labeling-action-design", "ai-copyright-labeling-action-test", "ai-copyright-labeling-action-freeze"],
    primaryActionId: "ai-copyright-labeling-action-freeze",
    businessEventId: "ai-copyright-labeling-event-transcode-loss",
    completionEventId: "ai-copyright-labeling:advance-event",
    teacherGateId: "gate-ai-copyright-labeling",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "ai-copyright-platform-review",
    actionIds: ["ai-copyright-platform-review-action-preflight", "ai-copyright-platform-review-action-resolve", "ai-copyright-platform-review-action-submit"],
    primaryActionId: "ai-copyright-platform-review-action-submit",
    businessEventId: "ai-copyright-platform-review-event-review-conflict",
    completionEventId: "ai-copyright-platform-review:advance-event",
    teacherGateId: "gate-ai-copyright-platform-review",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "ai-copyright-complaint-correction",
    actionIds: ["ai-copyright-complaint-correction-action-freeze", "ai-copyright-complaint-correction-action-decide", "ai-copyright-complaint-correction-action-correct"],
    primaryActionId: "ai-copyright-complaint-correction-action-correct",
    businessEventId: "ai-copyright-complaint-correction-event-complaint-with-repost",
    completionEventId: "ai-copyright-complaint-correction:complete-event",
    teacherGateId: "gate-ai-copyright-complaint-correction",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: true,
  },
];

const rainExpected: ExpectedMapping[] = [
  {
    sectionId: "rain-warning-verification",
    actionIds: ["rain-warning-verification-action-collect", "rain-warning-verification-action-compare", "rain-warning-verification-action-brief"],
    primaryActionId: "rain-warning-verification-action-brief",
    businessEventId: "rain-warning-verification-event-warning-upgrade",
    completionEventId: "rain-warning-verification:advance-event",
    teacherGateId: "gate-rain-warning-verification",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "rain-closure-brief",
    actionIds: ["rain-closure-brief-action-draft", "rain-closure-brief-action-verify", "rain-closure-brief-action-publish"],
    primaryActionId: "rain-closure-brief-action-publish",
    businessEventId: "rain-closure-brief-event-closure-scope-update",
    completionEventId: "rain-closure-brief-event-closure-scope-update",
    teacherGateId: "gate-rain-closure-brief",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: true,
    terminal: false,
  },
  {
    sectionId: "rain-visitor-guidance",
    actionIds: ["rain-visitor-guidance-action-map", "rain-visitor-guidance-action-capacity", "rain-visitor-guidance-action-publish"],
    primaryActionId: "rain-visitor-guidance-action-publish",
    businessEventId: "rain-visitor-guidance-event-route-blocked",
    completionEventId: "rain-visitor-guidance:advance-event",
    teacherGateId: "gate-rain-visitor-guidance",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "rain-rumor-check",
    actionIds: ["rain-rumor-check-action-claims", "rain-rumor-check-action-crosscheck", "rain-rumor-check-action-explain"],
    primaryActionId: "rain-rumor-check-action-explain",
    businessEventId: "rain-rumor-check-event-rumor-spike",
    completionEventId: "rain-rumor-check:advance-event",
    teacherGateId: "gate-rain-rumor-check",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "rain-reopen-criteria",
    actionIds: ["rain-reopen-criteria-action-criteria", "rain-reopen-criteria-action-inspect", "rain-reopen-criteria-action-submit"],
    primaryActionId: "rain-reopen-criteria-action-submit",
    businessEventId: "rain-reopen-criteria-event-premature-reopen-pressure",
    completionEventId: "rain-reopen-criteria:advance-event",
    teacherGateId: "gate-rain-reopen-criteria",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: false,
  },
  {
    sectionId: "rain-multiplatform-continuous-update",
    actionIds: ["rain-multiplatform-continuous-update-action-timeline", "rain-multiplatform-continuous-update-action-sync", "rain-multiplatform-continuous-update-action-review"],
    primaryActionId: "rain-multiplatform-continuous-update-action-review",
    businessEventId: "rain-multiplatform-continuous-update-event-reopen-with-stale-channel",
    completionEventId: "rain-multiplatform-continuous-update:complete-event",
    teacherGateId: "gate-rain-multiplatform-continuous-update",
    businessApprovalPolicyId: null,
    mergedBusinessAndCompletion: false,
    terminal: true,
  },
];

const runtimeCases = [
  {
    key: "village",
    scenario: villageSuperRuntimeScenario,
    seed: villageSuperRuntimeSeedRelease,
    courseRelease: villageSuperRuntimeCourseRelease,
    scenarioHash: villageSuperRuntimeScenarioContentHash,
    courseHash: villageSuperRuntimeCourseContentHash,
    scenarioId: "scenario-village-super-multiplatform",
    scenarioVersion: "2.0.1",
    seedReleaseId: "release-scenario-village-super-multiplatform-2.0.1-authored-sequence",
    courseReleaseId: "release-course-village-super-multiplatform-2.0.0-runtime.2",
    mappings: villageSuperRuntimeSectionMappings,
    expected: villageExpected,
  },
  {
    key: "village-postpublication",
    scenario: villagePostpublicationRuntimeScenario,
    seed: villagePostpublicationRuntimeSeedRelease,
    courseRelease: villagePostpublicationRuntimeCourseRelease,
    scenarioHash: villagePostpublicationRuntimeScenarioContentHash,
    courseHash: villagePostpublicationRuntimeCourseContentHash,
    scenarioId: "scenario-village-super-postpublication-context",
    scenarioVersion: "1.0.1",
    seedReleaseId: "release-scenario-village-super-postpublication-context-1.0.1-authored-sequence",
    courseReleaseId: "release-course-village-super-postpublication-context-1.0.0-runtime.2",
    mappings: villagePostpublicationRuntimeSectionMappings,
    expected: villagePostpublicationExpected,
  },
  {
    key: "ai",
    scenario: aiCopyrightRuntimeScenario,
    seed: aiCopyrightRuntimeSeedRelease,
    courseRelease: aiCopyrightRuntimeCourseRelease,
    scenarioHash: aiCopyrightRuntimeScenarioContentHash,
    courseHash: aiCopyrightRuntimeCourseContentHash,
    scenarioId: "scenario-ai-tourism-copyright-governance",
    scenarioVersion: "2.0.1",
    seedReleaseId: "release-scenario-ai-tourism-copyright-governance-2.0.1-authored-sequence",
    courseReleaseId: "release-course-ai-tourism-copyright-governance-2.0.0-runtime.2",
    mappings: aiCopyrightRuntimeSectionMappings,
    expected: aiExpected,
  },
  {
    key: "rain",
    scenario: rainEmergencyRuntimeScenario,
    seed: rainEmergencyRuntimeSeedRelease,
    courseRelease: rainEmergencyRuntimeCourseRelease,
    scenarioHash: rainEmergencyRuntimeScenarioContentHash,
    courseHash: rainEmergencyRuntimeCourseContentHash,
    scenarioId: "scenario-scenic-rain-emergency-reporting",
    scenarioVersion: "2.0.1",
    seedReleaseId: "release-scenario-scenic-rain-emergency-reporting-2.0.1-authored-sequence",
    courseReleaseId: "release-course-scenic-rain-emergency-reporting-2.0.0-runtime.2",
    mappings: rainEmergencyRuntimeSectionMappings,
    expected: rainExpected,
  },
] as const;

function choiceCommand(input: {
  scenario: ScenarioPackage;
  sessionId: string;
  stateVersion: number;
  choiceRef: string;
  sequence: number;
}): Command {
  return {
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: input.scenario.scenarioId,
      actorId: "student-reporter",
      correlationId: `${input.sessionId}:choice:${input.sequence}`,
      timestamp: `2026-08-09T16:${String(input.sequence).padStart(2, "0")}:00.000Z`,
    }),
    kind: "Command",
    name: "record_experience_choice",
    expectedStateVersion: input.stateVersion,
    payload: { choiceRef: input.choiceRef },
  };
}

function approveCommand(input: {
  scenario: ScenarioPackage;
  sessionId: string;
  stateVersion: number;
  candidateId: string;
  sequence: number;
}): Command {
  return {
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: input.scenario.scenarioId,
      actorId: "teacher-main",
      correlationId: `${input.sessionId}:approve:${input.sequence}`,
      timestamp: `2026-08-09T17:${String(input.sequence).padStart(2, "0")}:00.000Z`,
    }),
    kind: "Command",
    name: "approve_candidate_event",
    expectedStateVersion: input.stateVersion,
    payload: {
      candidateId: input.candidateId,
      reason: "定向 runtime smoke 教师门批准",
    },
  };
}

async function approvePending(
  engine: WorldEngine,
  scenario: ScenarioPackage,
  sessionId: string,
  dynamicEventId: string,
  approvalPolicyId: string,
  sequence: number,
) {
  const teacher = await engine.getProjection(sessionId, "teacher-main");
  const candidate = teacher.pendingCandidates.find((item) => (
    item.payload.dynamicEventId === dynamicEventId
    && item.approvalPolicyId === approvalPolicyId
  ));
  expect(candidate, `${dynamicEventId} 应形成待审批候选`).toBeDefined();
  if (!candidate) throw new Error(`${dynamicEventId} 未形成待审批候选`);
  await engine.execute(approveCommand({
    scenario,
    sessionId,
    stateVersion: teacher.stateVersion,
    candidateId: candidate.candidateId,
    sequence,
  }));
  return candidate;
}

describe("AI-010 migration runtime scenarios", () => {
  it("publishes four schema-valid catalog releases with frozen scenario and CourseRelease hashes", () => {
    expect(migrationRuntimeScenarios).toHaveLength(4);
    expect(migrationRuntimeSeedReleases).toHaveLength(4);
    expect(migrationRuntimeCourseReleases).toHaveLength(4);
    expect(migrationRuntime1SeedReleases.map((release) => release.ref))
      .toEqual([
        expect.objectContaining({
          releaseId: "release-scenario-village-super-multiplatform-2.0.0-baseline",
          version: "2.0.0",
          contentHash: "e27066fbc3dc25811af3f1973ac1238e3884dfb86e9f7fdb50e1aa16be0f694a",
        }),
        expect.objectContaining({
          releaseId: "release-scenario-village-super-postpublication-context-1.0.0-baseline",
          version: "1.0.0",
          contentHash: villagePostpublicationRuntime1ScenarioContentHash,
        }),
        expect.objectContaining({
          releaseId: "release-scenario-ai-tourism-copyright-governance-2.0.0-baseline",
          version: "2.0.0",
          contentHash: "ba1f6ec1f0ba66e9145987773d680db71192e6cb07b59c499706f7ee9303d196",
        }),
        expect.objectContaining({
          releaseId: "release-scenario-scenic-rain-emergency-reporting-2.0.0-baseline",
          version: "2.0.0",
          contentHash: "a5a5faf8a37c287db8e4bdcae6f05980d6d6613d1138bae75c3092108a46de9c",
        }),
      ]);
    expect(migrationRuntime1CourseReleases.map((release) => ({
      releaseId: release.releaseId,
      version: release.version,
      contentHash: release.contentHash,
    }))).toEqual([
      {
        releaseId: "release-course-village-super-multiplatform-2.0.0-runtime.1",
        version: 2,
        contentHash: "bcdd310bfcf1c7eab59176a0aa743b9949a8b4239b99c88ae25ef58481ff3491",
      },
      {
        releaseId: "release-course-village-super-postpublication-context-1.0.0-runtime.1",
        version: 2,
        contentHash: villagePostpublicationRuntime1CourseContentHash,
      },
      {
        releaseId: "release-course-ai-tourism-copyright-governance-2.0.0-runtime.1",
        version: 2,
        contentHash: "67cdc4d1dcaab6fffa5ae52072af9e3c725edc7cc18f813de10bf086394102e3",
      },
      {
        releaseId: "release-course-scenic-rain-emergency-reporting-2.0.0-runtime.1",
        version: 2,
        contentHash: "5e9f1208f8338a5688c03e6ae4e9ebda8ac3d62b57277351e47fa44610771757",
      },
    ]);
    for (const item of runtimeCases) {
      expect(ScenarioPackageSchema.parse(item.scenario)).toEqual(item.scenario);
      const validation = validateScenarioPackage(item.scenario, {
        draftId: `runtime-${item.key}`,
        revision: 1,
        validatedAt: "2026-08-09T15:10:00.000Z",
      });
      expect(validation.valid, JSON.stringify(validation.issues)).toBe(true);
      expect(validation.issues.filter((issue) => issue.severity === "error"))
        .toEqual([]);
      expect(item.seed.ref).toMatchObject({
        releaseId: item.seedReleaseId,
        scenarioId: item.scenarioId,
        version: item.scenarioVersion,
        contentHash: item.scenarioHash,
      });
      expect(CourseReleaseSchema.parse(item.courseRelease)).toEqual(
        item.courseRelease,
      );
      expect(item.courseRelease).toMatchObject({
        releaseId: item.courseReleaseId,
        version: 3,
        contentHash: item.courseHash,
        scenarioReleaseRef: {
          scenarioId: item.scenarioId,
          version: item.scenarioVersion,
          contentHash: item.scenarioHash,
        },
      });
      expect(item.scenario.roles.filter((role) => role.actorKind === "student"))
        .toEqual([expect.objectContaining({ roleId: "reporter" })]);
      expect(item.scenario.roles.filter((role) => role.actorKind === "agent"))
        .toHaveLength(14);
    }
  });

  it("exports an explicit new-session launch suggestion without aliasing the old village course", () => {
    expect(villagePostpublicationRuntimeLaunchSuggestion).toMatchObject({
      courseId: "course-village-super-postpublication-context",
      scenarioId: "scenario-village-super-postpublication-context",
      entryNodeId: "village-postpublication-context-triage",
      studentRoleId: "reporter",
      launchMode: "new_session_only",
    });
    expect(villagePostpublicationRuntimeLaunchSuggestion.runtimeCourseReleaseId)
      .toBe(villagePostpublicationRuntimeCourseRelease.releaseId);
    expect(villagePostpublicationRuntimeLaunchSuggestion.courseId)
      .not.toBe("course-village-super-multiplatform");
  });

  it("freezes all 23 section action, B, X and exact teacher-gate mappings", () => {
    expect(runtimeCases.flatMap((item) => item.mappings)).toHaveLength(23);
    for (const item of runtimeCases) {
      expect(item.mappings).toHaveLength(item.expected.length);
      expect(item.mappings).toMatchObject(item.expected);
      for (const expected of item.expected) {
        const mapping = item.mappings.find((candidate) => (
          candidate.sectionId === expected.sectionId
        ));
        const experience = item.scenario.experienceDesign?.nodeMappings.find(
          (candidate) => candidate.nodeId === expected.sectionId,
        );
        const chapter = item.courseRelease.chapters.find((candidate) => (
          candidate.chapterId === expected.sectionId
        ));
        expect(mapping).toBeDefined();
        expect(experience).toBeDefined();
        expect(chapter?.availableActionIds).toEqual(expected.actionIds);
        expect(chapter?.dynamicEventIds).toEqual([expected.businessEventId]);
        expect(chapter?.teacherGateIds).toEqual([expected.teacherGateId]);
        const businessEvent = experience?.dynamicEvents.find((event) => (
          event.dynamicEventId === expected.businessEventId
        ));
        const completionEvent = experience?.dynamicEvents.find((event) => (
          event.dynamicEventId === expected.completionEventId
        ));
        expect(businessEvent).toBeDefined();
        expect(completionEvent).toMatchObject({
          triggerRef: expected.primaryActionId,
          approvalPolicyId: expected.teacherGateId,
          eventType: expected.terminal ? "scene_completed" : "node_activated",
        });
        expect(experience?.dynamicEvents).toHaveLength(
          expected.mergedBusinessAndCompletion ? 1 : 2,
        );
        if (!expected.mergedBusinessAndCompletion) {
          expect(businessEvent).toMatchObject({
            eventType: "experience_consequence_applied",
            approvalPolicyId: expected.businessApprovalPolicyId,
          });
        }
        expect(item.scenario.approvalPolicies.find((policy) => (
          policy.approvalPolicyId === expected.teacherGateId
        ))).toMatchObject({ minimumEvidenceCount: 3 });
        if (expected.businessApprovalPolicyId) {
          expect(item.scenario.approvalPolicies.find((policy) => (
            policy.approvalPolicyId === expected.businessApprovalPolicyId
          ))).toMatchObject({ minimumEvidenceCount: 1 });
        }
      }
    }
    expect(runtimeCases.flatMap((item) => item.mappings).filter((mapping) => (
      mapping.mergedBusinessAndCompletion
    ))).toHaveLength(2);
    expect(runtimeCases.flatMap((item) => item.mappings).filter((mapping) => (
      mapping.businessReviewDeferredToCompletion
    ))).toHaveLength(10);
    expect(runtimeCases.flatMap((item) => item.scenario.approvalPolicies))
      .toHaveLength(23);
  });

  it("runs all 23 sections through real authored currentTaskAnchor order before the X gate", async () => {
    for (const item of runtimeCases) {
      const engine = new WorldEngine({ scenario: item.scenario });
      const sessionId = `session-runtime-${item.key}`;
      await engine.createSession(sessionId, true);
      let sequence = 1;
      for (const [sectionIndex, mapping] of item.mappings.entries()) {
        let reporter = await engine.getProjection(sessionId, "student-reporter");
        expect(reporter.currentNode.nodeId).toBe(mapping.sectionId);
        const experience = item.scenario.experienceDesign!.nodeMappings.find(
          (candidate) => candidate.nodeId === mapping.sectionId,
        )!;
        const businessEvent = experience.dynamicEvents.find((event) => (
          event.dynamicEventId === mapping.businessEventId
        ))!;
        await expect(engine.execute(choiceCommand({
          scenario: item.scenario,
          sessionId,
          stateVersion: reporter.stateVersion,
          choiceRef: mapping.actionIds[1],
          sequence: sequence++,
        }))).rejects.toThrow("请按课程编排顺序完成当前步骤");
        for (const actionId of mapping.actionIds.slice(0, 2)) {
          expect(
            reporter.experienceGuide?.currentNodeMapping?.operationTasks.map(
              (task) => task.taskId,
            ),
          ).toEqual([actionId]);
          expect(reporter.structuredWorld?.tasks.map((task) => task.taskId))
            .toEqual([actionId]);
          expect(reporter.structuredWorld?.tasks[0]?.status).toBe("ready");
          expect(reporter.currentTaskAnchor).toMatchObject({
            taskId: actionId,
            phase: "ready",
          });
          reporter = await engine.execute(choiceCommand({
            scenario: item.scenario,
            sessionId,
            stateVersion: reporter.stateVersion,
            choiceRef: actionId,
            sequence: sequence++,
          }));
          if (
            mapping.businessReviewDeferredToCompletion
            && businessEvent.triggerRef === actionId
          ) {
            const teacher = await engine.getProjection(
              sessionId,
              "teacher-main",
            );
            expect(teacher.pendingCandidates.filter((candidate) => (
              candidate.payload.dynamicEventId === mapping.businessEventId
            ))).toEqual([]);
            expect(reporter.recentEvents).toContainEqual(
              expect.objectContaining({
                eventType: "experience_consequence_applied",
                payload: expect.objectContaining({
                  dynamicEventId: mapping.businessEventId,
                }),
              }),
            );
            expect(reporter.currentTaskAnchor.phase).not.toBe("waiting");
          }
        }
        const decisionTaskIds = [
          `${mapping.sectionId}:agent-decision:accept`,
          `${mapping.sectionId}:agent-decision:request_evidence`,
          `${mapping.sectionId}:agent-decision:reject`,
        ];
        expect(
          reporter.experienceGuide?.currentNodeMapping?.operationTasks.map(
            (task) => task.taskId,
          ),
        ).toEqual(decisionTaskIds);
        expect(reporter.structuredWorld?.tasks).toEqual([]);
        expect(reporter.currentTaskAnchor).toMatchObject({
          taskId: null,
          phase: "no_task",
        });
        await expect(engine.execute(choiceCommand({
          scenario: item.scenario,
          sessionId,
          stateVersion: reporter.stateVersion,
          choiceRef: mapping.primaryActionId,
          sequence: sequence++,
        }))).rejects.toThrow("请先完成本节智能体建议");
        reporter = await engine.execute(choiceCommand({
          scenario: item.scenario,
          sessionId,
          stateVersion: reporter.stateVersion,
          choiceRef: `${mapping.sectionId}:agent-decision:request_evidence`,
          sequence: sequence++,
        }));
        expect(
          reporter.experienceGuide?.currentNodeMapping?.operationTasks.map(
            (task) => task.taskId,
          ),
        ).toEqual([mapping.primaryActionId]);
        expect(reporter.structuredWorld?.tasks.map((task) => task.taskId))
          .toEqual([mapping.primaryActionId]);
        expect(reporter.structuredWorld?.tasks[0]?.status).toBe("ready");
        expect(reporter.currentTaskAnchor).toMatchObject({
          taskId: mapping.primaryActionId,
          phase: "ready",
        });
        reporter = await engine.execute(choiceCommand({
          scenario: item.scenario,
          sessionId,
          stateVersion: reporter.stateVersion,
          choiceRef: mapping.primaryActionId,
          sequence: sequence++,
        }));
        reporter = await engine.getProjection(sessionId, "student-reporter");
        expect(reporter.currentNode.nodeId).toBe(mapping.sectionId);
        expect(reporter.pendingCandidates).toEqual([]);
        expect(reporter.structuredWorld?.tasks).toEqual([
          expect.objectContaining({
            taskId: mapping.primaryActionId,
            status: "waiting",
          }),
        ]);
        expect(reporter.currentTaskAnchor).toMatchObject({
          taskId: mapping.primaryActionId,
          phase: "waiting",
        });
        const completionGateProjection = await engine.getProjection(
          sessionId,
          "teacher-main",
        );
        expect(completionGateProjection.pendingCandidates).toEqual([
          expect.objectContaining({
            approvalPolicyId: mapping.teacherGateId,
            payload: expect.objectContaining({
              dynamicEventId: mapping.completionEventId,
            }),
          }),
        ]);
        const completionCandidate = await approvePending(
          engine,
          item.scenario,
          sessionId,
          mapping.completionEventId,
          mapping.teacherGateId,
          sequence++,
        );
        expect(completionCandidate.evidenceRefs).toHaveLength(4);
        if (mapping.businessReviewDeferredToCompletion) {
          expect(completionCandidate.sourceRefs).toContain(
            mapping.businessEventId,
          );
        }
        reporter = await engine.getProjection(sessionId, "student-reporter");
        if (mapping.terminal) {
          expect(reporter.scenario.status).toBe("completed");
          expect(reporter.currentNode).toMatchObject({
            nodeId: mapping.sectionId,
            status: "completed",
          });
          expect(reporter.nodes.every((node) => node.status === "completed"))
            .toBe(true);
        } else {
          expect(reporter.currentNode.nodeId).toBe(
            item.mappings[sectionIndex + 1]!.sectionId,
          );
        }
      }
    }
  }, 15_000);
});
