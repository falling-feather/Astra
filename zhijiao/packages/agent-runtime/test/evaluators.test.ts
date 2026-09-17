import { describe, expect, it } from "vitest";
import {
  AgentRunRequestSchema,
  EvaluationCaseSchema,
  RoleContractSchema,
  createMessageMeta,
  type AgentRunRequest,
} from "@ronggang/contracts";
import { DeterministicModelProvider } from "@ronggang/model-gateway";
import {
  AgentRuntime,
  AgentRuntimeExecutionError,
  GatewaySemanticEvaluationModel,
  createLearningCuratorHandlers,
  createSemanticEvaluatorHandlers,
  LearningCuratorInputSchema,
  learningCuratorAgentDefinition,
  semanticEvaluatorDefinitions,
  type LearningCuratorModelPort,
  type SemanticEvaluationModelPort,
} from "../src/index.js";
import { buildAgentContext } from "./context-fixture.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

const evaluationCase = EvaluationCaseSchema.parse({
  schemaVersion: "evaluation/1.0.0",
  evaluationCaseId: "evaluation-case-1",
  caseRevision: 1,
  caseHash: hashA,
  sessionEpoch: "epoch-evaluation",
  submissionId: "submission-1",
  artifactId: "artifact-1",
  revisionId: "revision-2",
  evidenceBundleId: "bundle-1",
  evidenceBundleHash: hashB,
  rubricId: "rubric-local-tourism-media",
  rubricVersion: "1.0.0",
  rubricHash: hashA,
  dimensions: [
    {
      dimensionId: "fact",
      label: "事实核验",
      weight: 0.6,
      maxScore: 60,
      rule: "事实判断必须可追溯",
      evaluationKind: "evidence_action",
    },
    {
      dimensionId: "trace",
      label: "证据链",
      weight: 0.4,
      maxScore: 40,
      rule: "过程证据必须完整",
      evaluationKind: "evidence_count",
    },
  ],
  requiredEvaluatorKinds: [
    "rule",
    "evidence_sufficiency",
    "work_quality",
    "professional_collaboration",
  ],
  definitionVersion: "evaluation-case/1.0.0",
  openedFromMessageId: "message-submit-1",
  openedAt: "2026-07-25T08:00:00.000Z",
});

const assessorRole = RoleContractSchema.parse({
  agentId: "agent-evidence-assessor",
  actorKind: "agent",
  roleId: "assessor",
  displayName: "证据充分性评价器",
  purpose: "形成只读逐维评价建议",
  teamId: "team-jiangnan-01",
  visibleScopes: ["public_world", "assigned_team", "role_private", "audit_only"],
  privateScopes: ["actor:agent-evidence-assessor"],
  allowedIntents: ["record_evaluation_proposal"],
  deniedActions: ["形成最终成绩"],
  toolPolicy: ["read_reviewed_facts"],
  tokenBudget: 4_000,
});

const learningRole = RoleContractSchema.parse({
  ...assessorRole,
  agentId: "agent-learning",
  roleId: "learning_curator",
  displayName: "学习候选策展智能体",
  allowedIntents: ["propose_learning_candidate"],
  privateScopes: ["actor:agent-learning"],
});

const teacherReview = LearningCuratorInputSchema.parse({
  reviewId: "teacher-review-1",
  evaluationCaseId: evaluationCase.evaluationCaseId,
  dimensions: evaluationCase.dimensions.map((dimension) => ({
    dimensionId: dimension.dimensionId,
    finalScore: dimension.maxScore,
    publicFeedback: "证据与岗位行动能够相互印证。",
    maxScore: dimension.maxScore,
    evidenceRefs: ["evidence-1"],
  })),
  finalScore: 100,
  publicSummary: "成果已完成事实核验与完整证据交接。",
  finalHash: hashA,
});

function request(input: {
  role: typeof assessorRole | typeof learningRole;
  triggerType:
    | "evaluation_case_opened"
    | "evaluation_branch_retry_requested"
    | "teacher_reviewed"
    | "learning_candidate_generation_retry_requested";
  signals: AgentRunRequest["signals"];
}): AgentRunRequest {
  const sessionId = "session-evaluation-runtime";
  const context = buildAgentContext({
    role: input.role,
    sessionId,
    sessionEpoch: evaluationCase.sessionEpoch,
    stateVersion: 20,
    evidence: [{
      itemId: "evidence-1",
      content: "已固定成果修订、信源和岗位交接记录。",
    }],
  });
  return AgentRunRequestSchema.parse({
    ...createMessageMeta({
      sessionId,
      sceneId: "scenario-local-tourism-media-v0.1",
      actorId: input.role.agentId,
      correlationId: "corr-evaluation-runtime",
      timestamp: "2026-07-25T08:00:00.000Z",
    }),
    kind: "AgentRunRequest",
    taskId: `task-${input.role.agentId}`,
    agentRunId: `run-${input.role.agentId}`,
    role: input.role,
    trigger: {
      type: input.triggerType,
      sourceId: `event-${input.triggerType}`,
    },
    stateVersion: 20,
    access: context.access,
    context: context.context,
    contextManifest: context.contextManifest,
    signals: input.signals,
  });
}

function evaluatorRequest(
  triggerType:
    | "evaluation_case_opened"
    | "evaluation_branch_retry_requested" = "evaluation_case_opened",
): AgentRunRequest {
  return request({
    role: assessorRole,
    triggerType,
    signals: {
      evaluatorKind: "evidence_sufficiency",
      evaluationCase: JSON.stringify(evaluationCase),
      evidenceBundle: JSON.stringify({
        schemaVersion: "evaluation/1.0.0",
        bundleId: "bundle-1",
        sessionEpoch: evaluationCase.sessionEpoch,
        submissionId: "submission-1",
        artifactId: "artifact-1",
        revisionId: "revision-2",
        revisionNumber: 2,
        revisionContentHash: hashA,
        rubricId: evaluationCase.rubricId,
        rubricVersion: evaluationCase.rubricVersion,
        rubricHash: evaluationCase.rubricHash,
        evidenceRefs: [{
          evidenceId: "evidence-1",
          contentHash: hashA,
          audienceHash: hashB,
        }],
        sourceEventRefs: ["event-submission"],
        scenarioReleaseId: "release-1",
        scenarioContentHash: hashB,
        createdAt: "2026-07-25T08:00:00.000Z",
        bundleHash: hashB,
      }),
      allowedEvidenceRefs: "evidence-1",
    },
  });
}

function completedEvaluationModel(
  evidenceRef = "evidence-1",
): SemanticEvaluationModelPort {
  return {
    async invoke() {
      return {
        dimensions: evaluationCase.dimensions.map((dimension) => ({
          dimensionId: dimension.dimensionId,
          scoreSuggestion: dimension.maxScore - 2,
          maxScore: dimension.maxScore,
          reason: "固定证据能够支撑该维度建议。",
          evidenceRefs: [evidenceRef],
          confidence: 0.85,
          riskFlags: [],
        })),
      };
    },
  };
}

describe("semantic evaluation graphs", () => {
  it("authorizes a targeted branch retry through the definition policy", async () => {
    const runtime = new AgentRuntime({
      handlers: createSemanticEvaluatorHandlers(new Map([
        ["evidence_sufficiency", completedEvaluationModel()],
      ])),
    });
    const definition = semanticEvaluatorDefinitions.get(assessorRole.agentId)!;
    const result = await runtime.run(
      definition,
      evaluatorRequest("evaluation_branch_retry_requested"),
    );

    expect(definition.definitionVersion).toBe("evaluation-semantic/1.0.7");
    expect(result.trace.status).toBe("completed");
    expect(result.intent?.intentType).toBe("record_evaluation_proposal");
  });

  it("normalizes model-owned labels and score scales to fixed case metadata", async () => {
    const model = new GatewaySemanticEvaluationModel({
      provider: new DeterministicModelProvider({
        profileId: "evaluation-normalization-test",
        resolver: () => ({
          dimensions: evaluationCase.dimensions.map((dimension, index) => ({
            dimensionId: dimension.label,
            label: dimension.label,
            weight: dimension.weight,
            rule: dimension.rule,
            evaluationKind: dimension.evaluationKind,
            scoreSuggestion: 80,
            maxScore: index === 0 ? dimension.maxScore : 100,
            reason: "模型给出百分制建议，固定元数据由服务器恢复。",
            evidenceRefs: [
              index % 2 === 0
                ? "evidence:evidence-1"
                : " evidence-1 ",
            ],
            confidence: 0.8,
            riskFlags: [],
          })),
        }),
      }),
    });
    const runtime = new AgentRuntime({
      handlers: createSemanticEvaluatorHandlers(new Map([
        ["evidence_sufficiency", model],
      ])),
    });
    const result = await runtime.run(
      semanticEvaluatorDefinitions.get(assessorRole.agentId)!,
      evaluatorRequest(),
    );
    const dimensions = result.intent?.proposedPayload.dimensions as Array<{
      dimensionId: string;
      scoreSuggestion: number;
      maxScore: number;
      evidenceRefs: string[];
      riskFlags: string[];
    }>;

    expect(result.trace.status).toBe("completed");
    expect(dimensions).toMatchObject(evaluationCase.dimensions.map((dimension, index) => ({
      dimensionId: dimension.dimensionId,
      scoreSuggestion: dimension.maxScore * 0.8,
      maxScore: dimension.maxScore,
      evidenceRefs: ["evidence-1"],
      riskFlags: [
        "server_normalized_dimension_label",
        "server_normalized_evidence_ref",
        index === 0
          ? "server_normalized_percent_score"
          : "server_normalized_score_scale",
        "server_removed_echoed_dimension_metadata",
      ],
    })));
  });

  it("accepts only exact echoed case metadata and rejects a changed label", async () => {
    const model = new GatewaySemanticEvaluationModel({
      provider: new DeterministicModelProvider({
        profileId: "evaluation-echo-mismatch-test",
        resolver: () => ({
          dimensions: evaluationCase.dimensions.map((dimension, index) => ({
            dimensionId: dimension.dimensionId,
            label: index === 0 ? "模型改写的量规标签" : dimension.label,
            weight: dimension.weight,
            rule: dimension.rule,
            evaluationKind: dimension.evaluationKind,
            scoreSuggestion: dimension.maxScore - 2,
            maxScore: dimension.maxScore,
            reason: "固定证据能够支撑该维度建议。",
            evidenceRefs: ["evidence-1"],
            confidence: 0.85,
            riskFlags: [],
          })),
        }),
      }),
    });
    const runtime = new AgentRuntime({
      handlers: createSemanticEvaluatorHandlers(new Map([
        ["evidence_sufficiency", model],
      ])),
    });
    const result = await runtime.run(
      semanticEvaluatorDefinitions.get(assessorRole.agentId)!,
      evaluatorRequest(),
    );

    expect(result.trace.status).toBe("degraded");
    expect(result.trace.nodes.some((node) => (
      node.nodeId === "semantic-model"
      && node.errorCode === "evaluation_echoed_dimension_metadata_invalid:dimensions.0.label"
    ))).toBe(true);
    expect(result.intent?.proposedPayload).toMatchObject({
      status: "unavailable",
      dimensions: [],
      errorCode: "evaluation_echoed_dimension_metadata_invalid:dimensions.0.label",
    });
  });

  it("returns a completed, evidence-linked proposal intent", async () => {
    const runtime = new AgentRuntime({
      handlers: createSemanticEvaluatorHandlers(new Map([
        ["evidence_sufficiency", completedEvaluationModel()],
      ])),
    });
    const definition = semanticEvaluatorDefinitions.get(assessorRole.agentId)!;
    const result = await runtime.run(definition, evaluatorRequest());

    expect(result.trace.status).toBe("completed");
    expect(result.intent).toMatchObject({
      intentType: "record_evaluation_proposal",
      expectedStateVersion: 20,
      proposedPayload: {
        evaluatorKind: "evidence_sufficiency",
        status: "completed",
        errorCode: null,
      },
      evidenceRefs: ["evidence-1"],
    });
  });

  it("records unavailable without fabricating scores when the live model fails", async () => {
    const failingModel: SemanticEvaluationModelPort = {
      async invoke() {
        throw new AgentRuntimeExecutionError(
          "provider_timeout",
          "provider unavailable",
        );
      },
    };
    const runtime = new AgentRuntime({
      handlers: createSemanticEvaluatorHandlers(new Map([
        ["evidence_sufficiency", failingModel],
      ])),
    });
    const result = await runtime.run(
      semanticEvaluatorDefinitions.get(assessorRole.agentId)!,
      evaluatorRequest(),
    );

    expect(result.trace.status).toBe("degraded");
    expect(result.trace.fallbackUsed).toBe(true);
    expect(result.intent?.proposedPayload).toEqual({
      evaluatorKind: "evidence_sufficiency",
      status: "unavailable",
      dimensions: [],
      errorCode: "provider_timeout",
    });
  });

  it("downgrades an out-of-bundle citation to unavailable", async () => {
    const runtime = new AgentRuntime({
      handlers: createSemanticEvaluatorHandlers(new Map([
        ["evidence_sufficiency", completedEvaluationModel("evidence-private")],
      ])),
    });
    const result = await runtime.run(
      semanticEvaluatorDefinitions.get(assessorRole.agentId)!,
      evaluatorRequest(),
    );

    expect(result.trace.status).toBe("degraded");
    expect(result.trace.nodes.some((node) => (
      node.nodeId === "proposal-guard"
      && node.errorCode === "evaluation_evidence_ref_invalid"
    ))).toBe(true);
    expect(result.intent?.proposedPayload.status).toBe("unavailable");
  });
});

describe("learning curator graph", () => {
  function learningRequest(
    triggerType:
      | "teacher_reviewed"
      | "learning_candidate_generation_retry_requested" = "teacher_reviewed",
  ): AgentRunRequest {
    return request({
      role: learningRole,
      triggerType,
      signals: {
        teacherReview: JSON.stringify(teacherReview),
        evaluationCaseId: teacherReview.evaluationCaseId,
        finalAssessmentId: teacherReview.reviewId,
        allowedEvidenceRefs: "evidence-1",
      },
    });
  }

  it("rejects a learning input snapshot containing teacher-private fields", () => {
    expect(() => LearningCuratorInputSchema.parse({
      ...teacherReview,
      internalNote: "teacher-internal-canary",
      reviewedBy: "teacher-main",
      requestId: "private-request-id",
    })).toThrow();
  });

  it("authorizes a controlled learning-generation retry", async () => {
    const model: LearningCuratorModelPort = {
      async invoke() {
        return {
          title: "可追溯岗位终评样例",
          proposedContent: {
            kind: "assessment_example",
            summary: teacherReview.publicSummary,
          },
          sourceEvidenceRefs: ["evidence-1"],
          expectedBenefit: "提供经人工终评的证据样例。",
          knownRisks: ["不得泛化为通用规则"],
          conflictRefs: [],
        };
      },
    };
    const runtime = new AgentRuntime({
      handlers: createLearningCuratorHandlers(model),
    });
    const result = await runtime.run(
      learningCuratorAgentDefinition,
      learningRequest("learning_candidate_generation_retry_requested"),
    );

    expect(learningCuratorAgentDefinition.definitionVersion)
      .toBe("learning-curator/1.0.2");
    expect(result.trace.status).toBe("completed");
    expect(result.intent?.intentType).toBe("propose_learning_candidate");
  });

  it("proposes only a pending-review assessment example", async () => {
    const model: LearningCuratorModelPort = {
      async invoke() {
        return {
          title: "可追溯岗位终评样例",
          proposedContent: {
            kind: "assessment_example",
            summary: teacherReview.publicSummary,
          },
          sourceEvidenceRefs: ["evidence-1"],
          expectedBenefit: "提供经人工终评的证据样例。",
          knownRisks: ["不得泛化为通用规则"],
          conflictRefs: [],
        };
      },
    };
    const runtime = new AgentRuntime({
      handlers: createLearningCuratorHandlers(model),
    });
    const result = await runtime.run(
      learningCuratorAgentDefinition,
      learningRequest(),
    );

    expect(result.trace.status).toBe("completed");
    expect(result.intent).toMatchObject({
      intentType: "propose_learning_candidate",
      proposedPayload: {
        status: "completed",
        candidateType: "assessment_example",
        sourceEvidenceRefs: ["evidence-1"],
      },
      requiresTeacherReview: true,
    });
    expect(JSON.stringify(result.intent)).not.toContain("teacher-internal-canary");
  });

  it("rejects private provider fields and records unavailable", async () => {
    const model: LearningCuratorModelPort = {
      async invoke() {
        return {
          title: "不安全候选",
          proposedContent: { providerRequestId: "private-request" },
          sourceEvidenceRefs: ["evidence-1"],
          expectedBenefit: "测试隐私守卫。",
          knownRisks: [],
          conflictRefs: [],
        };
      },
    };
    const runtime = new AgentRuntime({
      handlers: createLearningCuratorHandlers(model),
    });
    const result = await runtime.run(
      learningCuratorAgentDefinition,
      learningRequest(),
    );

    expect(result.trace.status).toBe("degraded");
    expect(result.trace.nodes.some((node) => (
      node.nodeId === "candidate-guard"
      && node.errorCode === "learning_private_content_detected"
    ))).toBe(true);
    expect(result.intent?.proposedPayload).toEqual({
      status: "unavailable",
      candidateType: "assessment_example",
      errorCode: "learning_private_content_detected",
    });
  });
});
