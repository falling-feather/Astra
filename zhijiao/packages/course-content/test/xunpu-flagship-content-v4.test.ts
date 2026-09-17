import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FlagshipContentReferenceV4SchemaVersion } from "@ronggang/contracts";
import {
  assessXunpuFlagshipContentReadinessV4,
  buildXunpuFlagshipRuntimeReleaseV3R2,
  createXunpuFlagshipRuntimeDefinitionV4,
  getXunpuWorldSimulationReleaseV3,
  hashXunpuFlagshipContentV4,
  validateXunpuFlagshipContentV4,
  xunpuFlagshipContentV4,
  type XunpuFlagshipContentV4,
} from "../src/index.js";

describe("泉州蟳埔 V4 旗舰世界内容包", () => {
  const productRoot = fileURLToPath(new URL("../../../", import.meta.url));

  it("冻结可编译世界、人物、冲突、路线、成果与终局", () => {
    expect(validateXunpuFlagshipContentV4(xunpuFlagshipContentV4)).toEqual({
      valid: true,
      issues: [],
    });
    expect(xunpuFlagshipContentV4).toMatchObject({
      schemaVersion: "xunpu-flagship-content/4.0.0",
      courseId: "course-xunpu-intangible-media",
      scenarioId: "scenario-xunpu-living-world",
      primaryJobId: "integrated_media_reporter",
      studentRoleId: "reporter",
      expectedDurationMinutes: 55,
      version: 4,
    });
    expect(xunpuFlagshipContentV4.locations).toHaveLength(7);
    expect(xunpuFlagshipContentV4.locations.find(
      (location) => location.locationId === "loc-mobile-edit-bay",
    )?.allowedIntents).toContain("wait");
    expect(xunpuFlagshipContentV4.worldObjects).toHaveLength(11);
    expect(xunpuFlagshipContentV4.variables).toHaveLength(11);
    expect(xunpuFlagshipContentV4.timelineBeats).toHaveLength(14);
    expect(xunpuFlagshipContentV4.cast).toHaveLength(10);
    expect(xunpuFlagshipContentV4.dialogueScenes).toHaveLength(3);
    expect(xunpuFlagshipContentV4.conflictDomains).toHaveLength(6);
    expect(xunpuFlagshipContentV4.flagshipRoutes).toHaveLength(4);
    expect(xunpuFlagshipContentV4.artifacts).toHaveLength(9);
    expect(xunpuFlagshipContentV4.endings.map((ending) => ending.endingId)).toEqual([
      "ending-trusted-collaboration",
      "ending-prudent-delay",
      "ending-traffic-backlash",
      "ending-governance-failure",
    ]);
    expect(hashXunpuFlagshipContentV4(xunpuFlagshipContentV4))
      .toBe(xunpuFlagshipContentV4.contentHash);
    expect(Object.isFrozen(xunpuFlagshipContentV4)).toBe(true);
    expect(Object.isFrozen(xunpuFlagshipContentV4.cast)).toBe(true);
  });

  it("三类关键 NPC 都具备多轮、多解、拒绝与恢复的真实对话", () => {
    expect(xunpuFlagshipContentV4.dialogueScenes.map((scene) => scene.npcRef))
      .toEqual(["entity-gatekeeper", "entity-inheritor", "entity-shopkeeper"]);
    for (const scene of xunpuFlagshipContentV4.dialogueScenes) {
      expect(scene.rules.filter((rule) => rule.outcome === "resolved"))
        .toHaveLength(3);
      expect(scene.rules.filter((rule) => rule.outcome === "refusal"))
        .toHaveLength(2);
      expect(scene.rules.filter((rule) => rule.outcome === "recovery"))
        .toHaveLength(2);
      expect(scene.issues.every((issue) => issue.requiredForResolution)).toBe(true);
      expect(scene.definitionHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(new Set(scene.rules.filter((rule) => rule.outcome === "resolved")
        .map((rule) => rule.routeRef)).size).toBe(3);
    }
  });

  it("把阶段、事件、协作与自主映射作为内容运行时定义发布", () => {
    const release = buildXunpuFlagshipRuntimeReleaseV3R2(
      getXunpuWorldSimulationReleaseV3().courseReleaseRef,
    );
    const definition = createXunpuFlagshipRuntimeDefinitionV4({
      schemaVersion: FlagshipContentReferenceV4SchemaVersion,
      contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
      courseReleaseRef: release.courseReleaseRef,
      scenarioReleaseRef: release.scenarioReleaseRef,
      simulationReleaseRef: release.simulationReleaseRef,
      contentHash: xunpuFlagshipContentV4.contentHash,
    });
    expect(definition).toMatchObject({
      schemaVersion: "flagship-world-runtime-definition/4.0.0",
      definitionId: "xunpu-flagship-world-runtime-v4",
    });
    expect(definition.phases).toHaveLength(8);
    expect(definition.intentBindings.length).toBeGreaterThanOrEqual(10);
    expect(definition.groundedBindings.map((item) => item.episodeTemplateRef))
      .toEqual(expect.arrayContaining([
        "episode-source-year-challenge",
        "episode-media-rights-challenge",
        "episode-breaking-rumor-challenge",
      ]));
    expect(definition.autonomyBindings).toHaveLength(14);
  });

  it("NPC 具有局部知识、跨轮记忆、计划、拒绝与恢复", () => {
    for (const npc of xunpuFlagshipContentV4.cast) {
      expect(npc.privatePressure).toMatch(/^仿真：/u);
      expect(npc.simulationNotice).toContain("教学仿真");
      expect(npc.localKnowledgeRefs.length).toBeGreaterThan(0);
      expect(npc.memoryKeys.length).toBeGreaterThanOrEqual(3);
      expect(npc.planSteps.length).toBeGreaterThanOrEqual(3);
      expect(npc.refusalConditions.length).toBeGreaterThan(0);
      expect(npc.recoveryConditions.length).toBeGreaterThan(0);
    }
    expect(xunpuFlagshipContentV4.cast.find(
      (npc) => npc.entityId === "entity-community-source",
    )?.memoryKeys).toEqual(expect.arrayContaining([
      "quote_scope",
      "withdrawn_items",
      "felt_exoticized",
    ]));
    const planSteps = xunpuFlagshipContentV4.cast.flatMap((npc) => npc.planSteps);
    expect(planSteps).toHaveLength(32);
    expect(new Set(planSteps.map((step) => step.planStepId))).toHaveLength(32);
    expect(planSteps.filter((step) => step.trigger.includes("story_published")))
      .toHaveLength(10);
  });

  it("把 55 分钟写成五幕连续职业节奏而非 58 分钟伪闭环", () => {
    const acts = xunpuFlagshipContentV4.experienceActs;
    expect(acts).toHaveLength(5);
    expect(acts[0]?.startMinute).toBe(0);
    expect(acts.at(-1)?.endMinute).toBe(55);
    for (let index = 1; index < acts.length; index += 1) {
      expect(acts[index]?.startMinute).toBe(acts[index - 1]?.endMinute);
    }
    expect(xunpuFlagshipContentV4.timelineBeats.at(-1)?.worldMinute).toBe(55);
    expect(xunpuFlagshipContentV4.worldObjects.find(
      (item) => item.objectId === "obj-publication-window",
    )?.initialState).toBe("剩余五十五个虚拟分钟");
    expect(acts.every((act) => (
      act.requiredBeatRefs.length > 0
      && act.requiredArtifactRefs.length > 0
      && act.decisionPressure.length > 20
      && act.completionSignal.length > 20
    ))).toBe(true);
  });

  it("六组冲突均可主动发生、具有多解、风险零写入和恢复", () => {
    for (const conflict of xunpuFlagshipContentV4.conflictDomains) {
      expect(conflict.proactiveTriggerKinds.length).toBeGreaterThan(0);
      expect(conflict.legalRoutes.length).toBeGreaterThanOrEqual(2);
      expect(conflict.riskyActions.length).toBeGreaterThan(0);
      expect(conflict.riskyActions.every(
        (action) => action.formalWriteAllowed === false,
      )).toBe(true);
      expect(conflict.recoveryConditions.length).toBeGreaterThan(0);
      expect(conflict.artifactRefs.length).toBeGreaterThan(0);
    }
    expect(xunpuFlagshipContentV4.timelineBeats.filter(
      (beat) => beat.proactive,
    ).length).toBeGreaterThanOrEqual(10);
  });

  it("两组灰度冲突不编码唯一答案，并让每种合法选择承担证据与机会成本", () => {
    expect(xunpuFlagshipContentV4.grayDilemmas.map((item) => item.dilemmaId))
      .toEqual([
        "dilemma-commercial-access-vs-independence",
        "dilemma-postpublication-context-vs-stability",
      ]);
    for (const dilemma of xunpuFlagshipContentV4.grayDilemmas) {
      expect(dilemma.noSingleCorrectAnswer).toBe(true);
      expect(dilemma.competingValues).toHaveLength(2);
      expect(dilemma.legitimateChoices).toHaveLength(3);
      expect(new Set(dilemma.legitimateChoices.map((choice) => choice.choiceRef)).size)
        .toBe(3);
      expect(dilemma.legitimateChoices.every((choice) => (
        choice.requiredEvidenceKinds.length > 0
        && choice.opportunityCosts.length > 0
      ))).toBe(true);
    }
  });

  it("发布后由人物、权利、来源和公共服务四条回应链继续改变世界", () => {
    expect(xunpuFlagshipContentV4.postPublicationResponseArcs).toHaveLength(4);
    for (const arc of xunpuFlagshipContentV4.postPublicationResponseArcs) {
      expect(arc.triggerRule).toContain("story_published");
      expect(arc.actorRefs.length).toBeGreaterThanOrEqual(2);
      expect(arc.outcomeVariants).toHaveLength(2);
      expect(arc.outcomeVariants.every((variant) => (
        variant.studentResponseOptions.length >= 3
        && variant.requiredEvidenceKinds.length > 0
        && variant.stateDeltas.length > 0
      ))).toBe(true);
      expect(arc.prohibitedShortcuts.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("三条合法路线与一条错误恢复路线保留不同机会成本", () => {
    expect(xunpuFlagshipContentV4.flagshipRoutes.map(
      (route) => route.routeKind,
    )).toEqual([
      "community_story",
      "evidence_explainer",
      "service_update",
      "traffic_recovery",
    ]);
    expect(xunpuFlagshipContentV4.flagshipRoutes.filter(
      (route) => route.preservesInitialFailureEvidence,
    ).map((route) => route.routeId)).toEqual([
      "route-flagship-traffic-recovery",
    ]);
    for (const route of xunpuFlagshipContentV4.flagshipRoutes) {
      expect(route.requiredBeatRefs.length).toBeGreaterThanOrEqual(6);
      expect(route.requiredArtifactRefs.length).toBeGreaterThanOrEqual(4);
      expect(route.opportunityCosts.length).toBeGreaterThan(0);
      expect(route.expectedStateDeltas.length).toBeGreaterThan(0);
      expect(route.successConditions.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("120 条语义样本严格覆盖允许、澄清和拒绝", () => {
    const samples = xunpuFlagshipContentV4.semanticSamples;
    expect(samples).toHaveLength(120);
    expect(new Set(samples.map((sample) => sample.sampleId))).toHaveLength(120);
    expect(new Set(samples.map((sample) => sample.utterance))).toHaveLength(120);
    expect(samples.filter((sample) => sample.expectedOutcome === "accepted"))
      .toHaveLength(78);
    expect(samples.filter(
      (sample) => sample.expectedOutcome === "clarification_required",
    )).toHaveLength(24);
    expect(samples.filter((sample) => sample.expectedOutcome === "refused"))
      .toHaveLength(18);
    expect(samples.filter((sample) => sample.blindSplit === "validation").length)
      .toBeGreaterThan(0);
    expect(samples.filter((sample) => sample.blindSplit === "test").length)
      .toBeGreaterThan(0);
    expect(samples.find(
      (sample) => sample.sampleId === "semantic-ambiguity-safety-010",
    )).toMatchObject({
      expectedOutcome: "refused",
      riskRefs: ["forged_authoritative_receipt"],
    });
  });

  it("36 条知识目标和 12 个多来源主张保持来源与复核边界", () => {
    expect(xunpuFlagshipContentV4.baseKnowledgeRefs).toHaveLength(24);
    expect(xunpuFlagshipContentV4.addedKnowledgeRecords).toHaveLength(12);
    expect(new Set([
      ...xunpuFlagshipContentV4.baseKnowledgeRefs,
      ...xunpuFlagshipContentV4.addedKnowledgeRecords.map(
        (record) => record.knowledgeId,
      ),
    ])).toHaveLength(36);
    for (const record of xunpuFlagshipContentV4.addedKnowledgeRecords) {
      expect(record.url).toMatch(/^https:\/\//u);
      expect(record.locator.length).toBeGreaterThanOrEqual(5);
      expect(record.reviewStatus).toBe("pending_expert_review");
      expect(record.storedExcerpt).toBe("");
      expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(xunpuFlagshipContentV4.groundedClaims).toHaveLength(12);
    expect(xunpuFlagshipContentV4.groundedClaims.every(
      (claim) => claim.knowledgeRefs.length >= 2
        && claim.minimumIndependentSupportCount >= 2,
    )).toBe(true);
  });

  it("36 条知识逐项形成可外部签审的专业复核包且仍诚实保持待复核", () => {
    const packet = xunpuFlagshipContentV4.professionalReviewPacket;
    expect(packet).toMatchObject({
      packetId: "professional-review-packet-xunpu-v4-r1",
      reviewStatus: "pending_expert_review",
      reviewEvidenceMustBeExternal: true,
      noAutomaticVerificationClaim: true,
    });
    expect(packet.items).toHaveLength(36);
    expect(new Set(packet.items.map((item) => item.knowledgeRef)).size).toBe(36);
    expect(packet.items.every((item) => (
      item.reviewStatus === "pending_expert_review"
      && item.requiredReviewerRoles.length >= 2
      && item.reviewQuestion.length > 20
      && item.sourceSnapshot.sourceContentHash.match(/^[a-f0-9]{64}$/u)
    ))).toBe(true);
  });

  it("最小迁移样本只换内容数据即可表达发布后灰度回应", () => {
    const sample = xunpuFlagshipContentV4.migrationSample;
    expect(sample).toMatchObject({
      targetCourseId: "course-village-super-multiplatform",
      serviceCodeChangeRequired: false,
    });
    expect(sample.section.order).toBe(7);
    expect(sample.section.actions).toHaveLength(3);
    expect(sample.section.dynamicEvents).toHaveLength(1);
    expect(sample.section.dynamicEvents[0]?.teacherApprovalRequired).toBe(true);
    expect(sample.section.evidenceRequirements).toHaveLength(3);
    expect(sample.section.rubric.reduce((sum, item) => sum + item.weight, 0))
      .toBe(100);
    expect(sample.section.hiddenFacts.every((fact) => (
      fact.visibility === "teacher_and_engine"
      && fact.summary.startsWith("仿真情境：")
    ))).toBe(true);
  });

  it("三个协作 Episode 强制 proposal 到 joint proposal 的完整修订链", () => {
    expect(xunpuFlagshipContentV4.agentEpisodes).toHaveLength(3);
    for (const episode of xunpuFlagshipContentV4.agentEpisodes) {
      expect(episode.requiredMoveSequence).toEqual([
        "proposal",
        "challenge",
        "evidence_request",
        "revision",
        "joint_proposal",
      ]);
      expect(episode.selectedAgentRefs.length).toBeGreaterThanOrEqual(4);
      expect(episode.groundedClaimRefs.length).toBeGreaterThan(0);
      expect(episode.failureClosedWhen.length).toBeGreaterThan(0);
    }
  });

  it("九类成果含真实字段，六维量规和八样例不以完成状态代替能力", () => {
    for (const artifact of xunpuFlagshipContentV4.artifacts) {
      expect(artifact.editableFields.length).toBeGreaterThan(0);
      expect(artifact.completionChecks.length).toBeGreaterThan(0);
      expect(artifact.evidenceRequirements.length).toBeGreaterThan(0);
      expect(artifact.artifactCompletionIsNotCompetencyScore).toBe(true);
    }
    expect(xunpuFlagshipContentV4.artifacts.find(
      (artifact) => artifact.artifactId === "artifact-multiplatform-package",
    )?.editableFields.map((field) => field.fieldId)).toEqual([
      "graphic_summary",
      "audio_cut",
      "video_cut",
      "breaking_update",
      "platform_reason",
    ]);
    expect(xunpuFlagshipContentV4.assessmentCriteria.reduce(
      (sum, criterion) => sum + criterion.weight,
      0,
    )).toBe(100);
    expect(xunpuFlagshipContentV4.workSamples).toHaveLength(8);
    expect(xunpuFlagshipContentV4.adversarialPairs).toHaveLength(6);
    expect(xunpuFlagshipContentV4.adversarialPairs.find(
      (pair) => pair.pairId === "pair-concise-vs-keywords",
    )?.invariant).toContain("短而有证据");
  });

  it("3—7 级压力和四种第二场具有机械差异", () => {
    expect(xunpuFlagshipContentV4.challengeProfiles.map((profile) => ({
      level: profile.challengeLevel,
      ceiling: profile.scoreCeiling,
      concurrent: profile.concurrentConflictLimit,
      scaffolding: profile.scaffoldingBudget,
    }))).toEqual([
      { level: 3, ceiling: 80, concurrent: 1, scaffolding: 5 },
      { level: 4, ceiling: 85, concurrent: 2, scaffolding: 4 },
      { level: 5, ceiling: 90, concurrent: 2, scaffolding: 3 },
      { level: 6, ceiling: 95, concurrent: 3, scaffolding: 2 },
      { level: 7, ceiling: 100, concurrent: 4, scaffolding: 1 },
    ]);
    expect(xunpuFlagshipContentV4.adaptationVariants).toHaveLength(4);
    for (const variant of xunpuFlagshipContentV4.adaptationVariants) {
      expect(variant.mechanicalDifferenceCount).toBeGreaterThanOrEqual(2);
      expect(variant.changedEventTemplateRefs.length).toBeGreaterThan(0);
      expect(variant.successEvidence.length).toBeGreaterThan(0);
    }
  });

  it("27 项媒体都存在、哈希匹配且带机器可读仿真披露", async () => {
    expect(xunpuFlagshipContentV4.mediaAssets).toHaveLength(27);
    for (const asset of xunpuFlagshipContentV4.mediaAssets) {
      expect(asset.productionStatus).toBe("ready");
      expect(asset.aiExplicitLabel).toBe(true);
      expect(asset.aiImplicitMetadata).toBe(true);
      const absolutePath = resolve(productRoot, asset.plannedRelativePath);
      const bytes = await readFile(absolutePath);
      expect(createHash("sha256").update(bytes).digest("hex"))
        .toBe(asset.contentHash);
      if (absolutePath.endsWith(".png")) {
        expect(bytes.includes(Buffer.from("AITrainingDisclosure\0", "latin1")))
          .toBe(true);
      } else {
        expect(bytes.includes(Buffer.from("教学仿真", "utf8"))).toBe(true);
      }
    }
  });

  it("如实报告专家复核仍未完成，不把结构合格写成内容就绪", () => {
    const readiness = assessXunpuFlagshipContentReadinessV4(
      xunpuFlagshipContentV4,
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.filter(
      (blocker) => blocker.code === "media_not_ready",
    )).toHaveLength(0);
    expect(readiness.blockers.filter(
      (blocker) => blocker.code === "implicit_label_missing",
    )).toHaveLength(0);
    expect(readiness.blockers.filter(
      (blocker) => blocker.code === "expert_review_pending",
    )).toHaveLength(12);
  });

  it("严格拒绝悬空语义目标和伪造的计划媒体哈希", () => {
    const broken = structuredClone(
      xunpuFlagshipContentV4,
    ) as unknown as XunpuFlagshipContentV4;
    (broken.semanticSamples[0] as { expectedTargetRefs: string[] })
      .expectedTargetRefs = ["entity-does-not-exist"];
    (broken.mediaAssets[0] as {
      productionStatus: "planned" | "ready";
      contentHash: string | null;
    }).productionStatus = "planned";
    const result = validateXunpuFlagshipContentV4(broken);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["content_hash", "unknown_ref", "asset_status"]),
    );
  });
});
