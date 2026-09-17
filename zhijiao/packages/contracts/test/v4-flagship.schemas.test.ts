import { describe, expect, it } from "vitest";
import {
  AdminGroundedCollaborationEpisodeV4Schema,
  AutonomousWorldDecisionV4Schema,
  BlindEvidenceAssessmentInputV4Schema,
  EvidenceAssessmentDecisionV4Schema,
  GroundedCollaborationEpisodeV4Schema,
  GroundedKnowledgeCitationV4Schema,
  MediaWorkRevisionV4Schema,
  SecondSessionHandoffV4Schema,
  SemanticActionDecisionV4Schema,
  SemanticActionRequestV4Schema,
  StudentGroundedCollaborationEpisodeV4Schema,
  TeacherGroundedCollaborationEpisodeV4Schema,
} from "../src/index.js";
import {
  acceptedSemanticActionDecisionV4Fixture,
  adminGroundedCollaborationEpisodeV4Fixture,
  blindEvidenceAssessmentInputV4Fixture,
  clarificationSemanticActionDecisionV4Fixture,
  evidenceAssessmentDecisionV4Fixture,
  mediaWorkRevisionV4Fixture,
  refusedSemanticActionDecisionV4Fixture,
  scheduledAutonomousWorldDecisionV4Fixture,
  secondSessionHandoffV4Fixture,
  semanticActionRequestV4Fixture,
  studentGroundedCollaborationEpisodeV4Fixture,
  suppressedAutonomousWorldDecisionV4Fixture,
  teacherGroundedCollaborationEpisodeV4Fixture,
} from "./v4-flagship.fixture.js";

describe("V4 旗舰语义世界、协作、媒体、评价与双场契约", () => {
  it("严格保留知识引用立场，并让旧协作记录按历史支持语义可读", () => {
    const legacy = studentGroundedCollaborationEpisodeV4Fixture();
    Reflect.deleteProperty(
      legacy.suggestion!.knowledgeCitations[0]! as unknown as Record<string, unknown>,
      "stance",
    );
    const parsedLegacy = StudentGroundedCollaborationEpisodeV4Schema.parse(legacy);
    expect(parsedLegacy.suggestion?.knowledgeCitations[0]?.stance).toBe("supports");

    const citation = parsedLegacy.suggestion!.knowledgeCitations[0]!;
    expect(GroundedKnowledgeCitationV4Schema.parse({
      ...citation,
      stance: "refutes",
    }).stance).toBe("refutes");
    expect(GroundedKnowledgeCitationV4Schema.parse({
      ...citation,
      stance: "context",
    }).stance).toBe("context");
    expect(() => GroundedKnowledgeCitationV4Schema.parse({
      ...citation,
      stance: "unknown",
    })).toThrow();
  });

  it("接受成功、澄清、拒绝三种互斥语义行动结果", () => {
    expect(SemanticActionRequestV4Schema.parse(
      semanticActionRequestV4Fixture(),
    ).utterance).toContain("阿环");
    expect(SemanticActionDecisionV4Schema.parse(
      acceptedSemanticActionDecisionV4Fixture(),
    ).status).toBe("accepted");
    expect(SemanticActionDecisionV4Schema.parse(
      clarificationSemanticActionDecisionV4Fixture(),
    ).status).toBe("clarification_required");
    expect(SemanticActionDecisionV4Schema.parse(
      refusedSemanticActionDecisionV4Fixture(),
    ).status).toBe("refused");
  });

  it("客户端不能提交 Actor、原始目标或重复签发令牌", () => {
    expect(() => SemanticActionRequestV4Schema.parse({
      ...semanticActionRequestV4Fixture(),
      actorId: "student-forged",
      targetRef: "entity-private",
    })).toThrow();

    const duplicate = structuredClone(semanticActionRequestV4Fixture());
    duplicate.selections.push({ ...duplicate.selections[0]! });
    expect(() => SemanticActionRequestV4Schema.parse(duplicate)).toThrow();
  });

  it("澄清与拒绝保持零写入，接受只形成 proposal-only 候选", () => {
    const falseClarification = structuredClone(
      clarificationSemanticActionDecisionV4Fixture(),
    ) as unknown as { writeDisposition: string };
    falseClarification.writeDisposition = "candidate_only";
    expect(() => SemanticActionDecisionV4Schema.parse(falseClarification))
      .toThrow();

    const forgedAccepted = structuredClone(
      acceptedSemanticActionDecisionV4Fixture(),
    ) as unknown as { canonicalAction: { authority: string } };
    forgedAccepted.canonicalAction.authority = "world_writer";
    expect(() => SemanticActionDecisionV4Schema.parse(forgedAccepted)).toThrow();
  });

  it("自主世界只安排已评估计划，抑制态不伪造事件", () => {
    expect(AutonomousWorldDecisionV4Schema.parse(
      scheduledAutonomousWorldDecisionV4Fixture(),
    ).status).toBe("scheduled");
    expect(AutonomousWorldDecisionV4Schema.parse(
      suppressedAutonomousWorldDecisionV4Fixture(),
    ).status).toBe("suppressed");

    const unobservedPlan = structuredClone(
      scheduledAutonomousWorldDecisionV4Fixture(),
    ) as unknown as { selectedPlanRef: string };
    unobservedPlan.selectedPlanRef = "npc-plan-not-evaluated";
    expect(() => AutonomousWorldDecisionV4Schema.parse(unobservedPlan)).toThrow();

    const fakeSuppressed = structuredClone(
      suppressedAutonomousWorldDecisionV4Fixture(),
    ) as unknown as { candidateEvent: unknown };
    fakeSuppressed.candidateEvent = scheduledAutonomousWorldDecisionV4Fixture()
      .candidateEvent;
    expect(() => AutonomousWorldDecisionV4Schema.parse(fakeSuppressed)).toThrow();
  });

  it("三角色投影严格隔离技术执行字段", () => {
    expect(GroundedCollaborationEpisodeV4Schema.parse(
      studentGroundedCollaborationEpisodeV4Fixture(),
    ).audience).toBe("student");
    expect(GroundedCollaborationEpisodeV4Schema.parse(
      teacherGroundedCollaborationEpisodeV4Fixture(),
    ).audience).toBe("teacher");
    expect(GroundedCollaborationEpisodeV4Schema.parse(
      adminGroundedCollaborationEpisodeV4Fixture(),
    ).audience).toBe("admin");

    expect(() => StudentGroundedCollaborationEpisodeV4Schema.parse({
      ...studentGroundedCollaborationEpisodeV4Fixture(),
      traceRef: "trace-private",
      prompt: "private prompt",
      providerId: "vendor",
      privateMemory: "hidden",
    })).toThrow();
    expect(() => TeacherGroundedCollaborationEpisodeV4Schema.parse({
      ...teacherGroundedCollaborationEpisodeV4Fixture(),
      executionSummary: { providerId: "vendor" },
    })).toThrow();
  });

  it("协作必须形成动态三步/五步链且动作来自选中智能体", () => {
    const badSequence = structuredClone(
      teacherGroundedCollaborationEpisodeV4Fixture(),
    );
    badSequence.moves[1]!.moveKind = "revision";
    expect(() => TeacherGroundedCollaborationEpisodeV4Schema.parse(badSequence))
      .toThrow();

    const dynamicThreeStep = structuredClone(
      teacherGroundedCollaborationEpisodeV4Fixture(),
    );
    const proposal = dynamicThreeStep.moves[0]!;
    const evidenceRequest = dynamicThreeStep.moves[2]!;
    const jointProposal = dynamicThreeStep.moves[4]!;
    dynamicThreeStep.moves = [
      { ...proposal, predecessorMoveRefs: [] },
      {
        ...evidenceRequest,
        moveId: "move-evidence-dynamic-001",
        predecessorMoveRefs: [proposal.moveId],
      },
      {
        ...jointProposal,
        moveId: "move-joint-dynamic-001",
        predecessorMoveRefs: [proposal.moveId, "move-evidence-dynamic-001"],
      },
    ];
    dynamicThreeStep.jointProposal!.sourceMoveRefs = dynamicThreeStep.moves.map(
      (move) => move.moveId,
    );
    expect(TeacherGroundedCollaborationEpisodeV4Schema.parse(dynamicThreeStep)
      .moves.map((move) => move.moveKind)).toEqual([
      "proposal",
      "evidence_request",
      "joint_proposal",
    ]);

    const historicalClosures = structuredClone(dynamicThreeStep);
    for (let index = 0; index < 3; index += 1) {
      const previous = historicalClosures.moves.at(-1)!;
      historicalClosures.moves.push({
        ...previous,
        moveId: `move-joint-history-00${index + 1}`,
        predecessorMoveRefs: historicalClosures.moves.map((move) => move.moveId),
      });
    }
    historicalClosures.jointProposal!.sourceMoveRefs = historicalClosures.moves.map(
      (move) => move.moveId,
    );
    expect(TeacherGroundedCollaborationEpisodeV4Schema.parse(historicalClosures)
      .moves).toHaveLength(6);

    const unselected = structuredClone(
      teacherGroundedCollaborationEpisodeV4Fixture(),
    );
    unselected.moves[0]!.agentTemplateRef = "agent-template-platform";
    expect(() => TeacherGroundedCollaborationEpisodeV4Schema.parse(unselected))
      .toThrow();

    const roleDrift = structuredClone(
      teacherGroundedCollaborationEpisodeV4Fixture(),
    );
    roleDrift.moves[0]!.professionalRoleId = "role-fact-checker";
    expect(() => TeacherGroundedCollaborationEpisodeV4Schema.parse(roleDrift))
      .toThrow();

    const wrongCount = structuredClone(
      adminGroundedCollaborationEpisodeV4Fixture(),
    );
    wrongCount.executionSummary.selectedCount = 4;
    expect(() => AdminGroundedCollaborationEpisodeV4Schema.parse(wrongCount))
      .toThrow();

    const fakeLive = structuredClone(
      adminGroundedCollaborationEpisodeV4Fixture(),
    );
    fakeLive.moves[0]!.execution.executionMode = "live";
    expect(() => AdminGroundedCollaborationEpisodeV4Schema.parse(fakeLive))
      .toThrow();
  });

  it("融媒体修订保存源资产、变换、权利、披露与三种成品", () => {
    const parsed = MediaWorkRevisionV4Schema.parse(mediaWorkRevisionV4Fixture());
    expect(new Set(parsed.derivedAssets.map((asset) => asset.mediaKind)))
      .toEqual(new Set(["image", "audio", "video"]));

    const withdrawn = structuredClone(mediaWorkRevisionV4Fixture());
    withdrawn.sourceAssets[0]!.rightsStatus = "withdrawn";
    expect(() => MediaWorkRevisionV4Schema.parse(withdrawn)).toThrow();

    const brokenChain = structuredClone(mediaWorkRevisionV4Fixture());
    brokenChain.transformations[1]!.inputAssetRef = "asset-not-registered";
    expect(() => MediaWorkRevisionV4Schema.parse(brokenChain)).toThrow();

    const textOnlyPackage = structuredClone(mediaWorkRevisionV4Fixture());
    textOnlyPackage.derivedAssets = textOnlyPackage.derivedAssets.filter(
      (asset) => asset.mediaKind === "image",
    );
    expect(() => MediaWorkRevisionV4Schema.parse(textOnlyPackage)).toThrow();
  });

  it("盲评输入排除身份、难度、建议、模型与技术 Trace", () => {
    expect(BlindEvidenceAssessmentInputV4Schema.parse(
      blindEvidenceAssessmentInputV4Fixture(),
    ).surfaceSignals.allowedForScoring).toBe(false);
    expect(() => BlindEvidenceAssessmentInputV4Schema.parse({
      ...blindEvidenceAssessmentInputV4Fixture(),
      studentId: "student-leaked",
      bindingId: "binding-leaked",
      challengeLevel: 7,
      agentAdvice: "copy this answer",
      traceRef: "trace-private",
    })).toThrow();
  });

  it("评价不以表面信号取巧，证据不足不出分，最终态要求专业量规与教师", () => {
    expect(EvidenceAssessmentDecisionV4Schema.parse(
      evidenceAssessmentDecisionV4Fixture(),
    ).status).toBe("final");

    const unverifiedFinal = structuredClone(evidenceAssessmentDecisionV4Fixture());
    unverifiedFinal.rubricReviewStatus = "pending_expert_review";
    expect(() => EvidenceAssessmentDecisionV4Schema.parse(unverifiedFinal))
      .toThrow();

    const duplicateCriterion = structuredClone(evidenceAssessmentDecisionV4Fixture());
    duplicateCriterion.criterionAssessments[1]!.criterionId =
      duplicateCriterion.criterionAssessments[0]!.criterionId;
    expect(() => EvidenceAssessmentDecisionV4Schema.parse(duplicateCriterion))
      .toThrow();

    const falseInsufficient = structuredClone(evidenceAssessmentDecisionV4Fixture());
    falseInsufficient.status = "insufficient_evidence";
    expect(() => EvidenceAssessmentDecisionV4Schema.parse(falseInsufficient))
      .toThrow();
  });

  it("第二场必须至少改变两项机制、最多自动调一级并绑定同一学习者", () => {
    expect(SecondSessionHandoffV4Schema.parse(
      secondSessionHandoffV4Fixture(),
    ).status).toBe("provisioned");

    const oneMechanic = structuredClone(secondSessionHandoffV4Fixture());
    if (oneMechanic.proposal === null) throw new Error("fixture drift");
    oneMechanic.proposal.changedMechanics = oneMechanic.proposal.changedMechanics
      .slice(0, 1);
    expect(() => SecondSessionHandoffV4Schema.parse(oneMechanic)).toThrow();

    const jumped = structuredClone(secondSessionHandoffV4Fixture());
    if (jumped.proposal === null) throw new Error("fixture drift");
    jumped.proposal.targetChallengeLevel = 7;
    expect(() => SecondSessionHandoffV4Schema.parse(jumped)).toThrow();

    const crossed = structuredClone(secondSessionHandoffV4Fixture());
    if (crossed.provision === null) throw new Error("fixture drift");
    crossed.provision.learnerSubjectHash = "0".repeat(64);
    expect(() => SecondSessionHandoffV4Schema.parse(crossed)).toThrow();
  });
});
