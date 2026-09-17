import { describe, expect, it } from "vitest";
import {
  WorldSimulationReleaseSchema,
  challengeScoreCeiling,
} from "@ronggang/contracts";
import {
  buildXunpuFlagshipWorldSimulationReleaseV3R2,
  buildXunpuFlagshipRuntimeReleaseV3R2,
  hashCanonical,
  validateXunpuFlagshipContentManifestV3,
  xunpuCourseRelease,
  xunpuFlagshipContentManifestV3,
  xunpuFlagshipWorldSimulationReleaseV3R2,
} from "../src/index.js";

describe("泉州蟳埔 V3 旗舰世界完整内容", () => {
  it("publishes policies for every student action in a new immutable generation and preserves the historical release", () => {
    const current = buildXunpuFlagshipRuntimeReleaseV3R2();
    const historical = buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3");
    expect(current.simulationReleaseRef).toMatchObject({ releaseId: "simulation-xunpu-living-world-r2-runtime.4", version: 6 });
    expect(historical.simulationReleaseRef).toMatchObject({ releaseId: "simulation-xunpu-living-world-r2-runtime.3", version: 5 });
    expect(historical).not.toHaveProperty("actionPolicy");
    expect(current.simulationReleaseRef.contentHash).not.toBe(historical.simulationReleaseRef.contentHash);
    expect(current.actionPolicy!.actions.map((action) => action.eventTemplateId).sort()).toEqual(current.eventTemplates.filter((event) => event.sourceKind === "student_action").map((event) => event.eventTemplateId).sort());
  });

  it("冻结六组冲突域、七类角色、九类成果、三类教师门与四种终局", () => {
    const report = validateXunpuFlagshipContentManifestV3(
      xunpuFlagshipContentManifestV3,
    );
    expect(report).toEqual({ valid: true, issues: [] });
    expect(xunpuFlagshipContentManifestV3.conflictDomains).toHaveLength(6);
    expect(xunpuFlagshipContentManifestV3.principalRoles).toHaveLength(7);
    expect(xunpuFlagshipContentManifestV3.artifacts).toHaveLength(9);
    expect(xunpuFlagshipContentManifestV3.teacherGates).toHaveLength(3);
    expect(xunpuFlagshipContentManifestV3.endings.map((ending) => ending.endingKind))
      .toEqual([
        "trusted_collaboration",
        "prudent_delay",
        "traffic_backlash",
        "governance_failure",
      ]);
    expect(xunpuFlagshipContentManifestV3.timingPlan.reduce(
      (sum, phase) => sum + phase.minutes,
      0,
    )).toBe(55);
  });

  it("每个冲突域至少有两条合法路线、失败恢复和真实成果出口", () => {
    const proactive = xunpuFlagshipContentManifestV3.conflictDomains.filter(
      (domain) => domain.proactiveTriggerKinds.some((kind) => kind !== "student"),
    );
    expect(proactive.length).toBeGreaterThanOrEqual(3);
    for (const domain of xunpuFlagshipContentManifestV3.conflictDomains) {
      expect(domain.alternativeRoutes.length).toBeGreaterThanOrEqual(2);
      expect(domain.availableStudentVerbs.length).toBeGreaterThanOrEqual(4);
      expect(domain.requiredArtifactRefs.length).toBeGreaterThan(0);
      expect(domain.recoveryConditions.length).toBeGreaterThan(0);
      expect(domain.eventTemplateRefs.length).toBeGreaterThan(0);
    }
    expect(xunpuFlagshipContentManifestV3.conflictDomains.find((domain) => (
      domain.conflictDomainId === "conflict-post-publication"
    ))?.alternativeRoutes.map((route) => route.routeId)).toEqual([
      "route-public-correction",
      "route-takedown-rebuild",
      "route-defend-with-evidence",
    ]);
  });

  it("九类成果包含可编辑字段、完成检查、证据要求和分级必交集", () => {
    const level3Required = xunpuFlagshipContentManifestV3.artifacts.filter(
      (artifact) => artifact.requiredAtChallengeLevels.includes(3),
    );
    const level7Required = xunpuFlagshipContentManifestV3.artifacts.filter(
      (artifact) => artifact.requiredAtChallengeLevels.includes(7),
    );
    expect(level3Required).toHaveLength(7);
    expect(level7Required).toHaveLength(9);
    for (const artifact of xunpuFlagshipContentManifestV3.artifacts) {
      expect(artifact.editableFields.length).toBeGreaterThan(0);
      expect(artifact.editableFields.every((field) => (
        field.minimumLength > 0 && field.maximumLength > field.minimumLength
      ))).toBe(true);
      expect(artifact.completionChecks.length).toBeGreaterThan(0);
      expect(artifact.evidenceRequirements.length).toBeGreaterThan(0);
    }
    expect(xunpuFlagshipContentManifestV3.artifacts.find((artifact) => (
      artifact.artifactId === "artifact-feature-story"
    ))?.editableFields.map((field) => field.fieldId)).toEqual([
      "headline",
      "lead",
      "body",
      "disclosure",
    ]);
  });

  it("3—7 级在并发、支架、事件和分数上限上机械不同", () => {
    expect(xunpuFlagshipContentManifestV3.challengeProfiles.map((profile) => ({
      level: profile.challengeLevel,
      ceiling: profile.scoreCeiling,
      concurrent: profile.concurrentConflictLimit,
      scaffolding: profile.scaffoldingBudget,
      eventCount: profile.eventTemplateRefs.length,
    }))).toEqual([
      { level: 3, ceiling: 80, concurrent: 1, scaffolding: 5, eventCount: 10 },
      { level: 4, ceiling: 85, concurrent: 2, scaffolding: 4, eventCount: 16 },
      { level: 5, ceiling: 90, concurrent: 2, scaffolding: 3, eventCount: 20 },
      { level: 6, ceiling: 95, concurrent: 3, scaffolding: 2, eventCount: 24 },
      { level: 7, ceiling: 100, concurrent: 4, scaffolding: 1, eventCount: 24 },
    ]);
    for (const profile of xunpuFlagshipContentManifestV3.challengeProfiles) {
      expect(profile.scoreCeiling).toBe(challengeScoreCeiling(profile.challengeLevel));
      expect(profile.protectionRules.length).toBeGreaterThan(0);
    }
  });

  it("七名角色全部明确为教学仿真且私有压力不冒充现实人物事实", () => {
    for (const role of xunpuFlagshipContentManifestV3.principalRoles) {
      expect(role.simulationNotice).toContain("教学仿真");
      expect(role.privatePressure).toMatch(/^仿真：/u);
      expect(role.disclosureRules.length).toBeGreaterThanOrEqual(3);
    }
    expect(xunpuFlagshipContentManifestV3.factBoundary).toEqual({
      allNamedPeopleAreSimulated: true,
      allPrivatePressuresAreSimulated: true,
      publicFactsRequireKnowledgeRefs: true,
      noExternalMediaCopied: true,
    });
    expect(xunpuFlagshipContentManifestV3.hiddenScenarioFacts.length)
      .toBeGreaterThanOrEqual(8);
    expect(xunpuFlagshipContentManifestV3.hiddenScenarioFacts.every((fact) => (
      fact.simulationOnly
      && fact.mustNeverBePresentedAsRealPersonFact
      && fact.summary.startsWith("仿真：")
      && fact.mayBecomePublicThrough.length > 0
    ))).toBe(true);
  });

  it("量规蓝图以真实成果和独立证据失败关闭，不把完成状态写成能力分", () => {
    expect(xunpuFlagshipContentManifestV3.rubricBlueprints).toHaveLength(6);
    expect(xunpuFlagshipContentManifestV3.rubricBlueprints.reduce(
      (sum, criterion) => sum + criterion.weight,
      0,
    )).toBe(100);
    expect(xunpuFlagshipContentManifestV3.assessmentBoundary).toEqual({
      artifactCompletionIsNotCompetencyScore: true,
      insufficientEvidenceStatus: "insufficient_evidence",
      finalAuthority: "teacher",
    });
    for (const criterion of xunpuFlagshipContentManifestV3.rubricBlueprints) {
      expect(criterion.artifactRefs.length).toBeGreaterThan(0);
      expect(criterion.observableEvidence.length).toBeGreaterThan(0);
      expect(criterion.minimumIndependentEvidenceCount).toBeGreaterThanOrEqual(2);
      expect(criterion.failClosedWhen.length).toBeGreaterThan(0);
    }
  });

  it("引用全部 24 条 HTTPS 来源并保留待专家复核状态", () => {
    expect(xunpuFlagshipContentManifestV3.sourceKnowledgeRefs).toHaveLength(24);
    expect(new Set(xunpuFlagshipContentManifestV3.sourceKnowledgeRefs.map(
      (source) => source.knowledgeId,
    ))).toHaveLength(24);
    expect(xunpuFlagshipContentManifestV3.sourceKnowledgeRefs.every((source) => (
      source.url.startsWith("https://")
      && source.locator.length >= 5
      && source.reviewStatus === "pending_expert_review"
    ))).toBe(true);
    expect(xunpuCourseRelease.knowledgeRecords.every((record) => (
      xunpuFlagshipContentManifestV3.sourceKnowledgeRefs.some(
        (source) => source.knowledgeId === record.knowledgeId,
      )
    ))).toBe(true);
    expect(xunpuFlagshipContentManifestV3.sourceRefresh).toMatchObject({
      checkedAt: "2026-08-26",
      expertReviewStillRequired: true,
    });
    expect(xunpuFlagshipContentManifestV3.sourceRefresh.checkedKnowledgeRefs)
      .toHaveLength(8);
    expect(xunpuFlagshipContentManifestV3.sourceRefresh.findings.some(
      (finding) => finding.includes("2008") && finding.includes("2007"),
    )).toBe(true);
    expect(JSON.stringify(xunpuFlagshipContentManifestV3)).not.toMatch(
      /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm|mp3|wav)(?:[?"#]|$)/iu,
    );
  });

  it("编译新的不可变 R2 世界发布版并让内容哈希覆盖完整发布内容", () => {
    const release = WorldSimulationReleaseSchema.parse(
      xunpuFlagshipWorldSimulationReleaseV3R2,
    );
    expect(release.simulationReleaseRef).toMatchObject({
      simulationId: "simulation-xunpu-living-world",
      releaseId: "simulation-xunpu-living-world-r2.2",
      version: 4,
    });
    expect(release.scenarioReleaseRef.version).toBe("3.3.0");
    expect(release.expectedDurationMinutes).toBe(55);
    expect(release.worldEntities).toHaveLength(23);
    expect(release.variableDefinitions).toHaveLength(11);
    expect(release.rules).toHaveLength(17);
    expect(release.eventTemplates).toHaveLength(25);
    expect(release.eventTemplates.find((event) => (
      event.eventTemplateId === "event-template-commercial-response"
    ))).toMatchObject({
      eventType: "student_resolves_commercial_exchange",
      sourceKind: "student_action",
      candidateAgentTemplateIds: ["agent-template-shopkeeper", "agent-template-editor"],
      challengeLevels: [4, 5, 6, 7],
    });
    expect(release.eventTemplates.find((event) => (
      event.eventTemplateId === "event-template-visual-consent"
    ))?.challengeLevels).toEqual([4, 5, 6, 7]);
    expect(release.riskGates).toHaveLength(3);
    expect(release.endingDefinitions).toHaveLength(4);
    expect(release.eventTemplates.find((event) => (
      event.eventTemplateId === "event-template-community-source"
    ))?.affectedObjectRefs).toEqual(expect.arrayContaining([
      { objectType: "world_variable", objectId: "community_trust" },
      { objectType: "world_variable", objectId: "source_access" },
    ]));
    expect(Object.isFrozen(xunpuFlagshipWorldSimulationReleaseV3R2)).toBe(true);
    expect(Object.isFrozen(xunpuFlagshipWorldSimulationReleaseV3R2.worldEntities))
      .toBe(true);
    for (const variant of release.challengeVariants) {
      expect(variant.eventTemplateRefs).toEqual(
        xunpuFlagshipContentManifestV3.challengeProfiles.find(
          (profile) => profile.challengeLevel === variant.challengeLevel,
        )?.eventTemplateRefs,
      );
      for (const eventRef of variant.eventTemplateRefs) {
        expect(release.eventTemplates.find(
          (event) => event.eventTemplateId === eventRef,
        )?.challengeLevels).toContain(variant.challengeLevel);
      }
    }
  });

  it("课程发布引用变化会生成新的世界哈希，不允许请求时静默漂移", () => {
    const rebound = buildXunpuFlagshipWorldSimulationReleaseV3R2({
      ...xunpuFlagshipWorldSimulationReleaseV3R2.courseReleaseRef,
      releaseId: "release-course-xunpu-intangible-media-runtime-test",
      version: 99,
      contentHash: "a".repeat(64),
    });
    expect(rebound.courseReleaseRef.version).toBe(99);
    expect(rebound.simulationReleaseRef.contentHash).not.toBe(
      xunpuFlagshipWorldSimulationReleaseV3R2.simulationReleaseRef.contentHash,
    );
    expect(WorldSimulationReleaseSchema.parse(rebound)).toEqual(rebound);
  });

  it("拒绝未知角色/成果引用、数量缺失和内容哈希漂移", () => {
    const malformed = structuredClone(xunpuFlagshipContentManifestV3);
    malformed.principalRoles.pop();
    malformed.artifacts.pop();
    malformed.conflictDomains[0]!.principalRoleRefs = ["role-unknown"];
    malformed.conflictDomains[1]!.requiredArtifactRefs = ["artifact-unknown"];
    const report = validateXunpuFlagshipContentManifestV3(malformed);
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "role_count",
      "artifact_count",
      "conflict_role_ref",
      "conflict_artifact_ref",
      "content_hash_drift",
    ]));
    const { contentHash: _contentHash, ...hashInput } = xunpuFlagshipContentManifestV3;
    expect(hashCanonical(hashInput)).toBe(xunpuFlagshipContentManifestV3.contentHash);
  });
});
