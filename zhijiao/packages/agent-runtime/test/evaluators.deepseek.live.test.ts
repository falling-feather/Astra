import { describe, expect, it } from "vitest";
import {
  AgentRunRequestSchema,
  EvaluationCaseSchema,
  EvaluationEvidenceBundleSchema,
  RoleContractSchema,
  createMessageMeta,
  type AgentRunRequest,
  type EvaluationEvaluatorKind,
  type RoleContract,
} from "@ronggang/contracts";
import { OpenAiCompatibleModelProvider } from "@ronggang/model-gateway";
import {
  AgentRuntime,
  GatewayLearningCuratorModel,
  GatewaySemanticEvaluationModel,
  LearningCuratorInputSchema,
  createLearningCuratorHandlers,
  createSemanticEvaluatorHandlers,
  learningCuratorAgentDefinition,
  semanticEvaluatorDefinitions,
  semanticEvaluatorProfiles,
} from "../src/index.js";
import { buildAgentContext } from "./context-fixture.js";

const liveEnabled = process.env.DEEPSEEK_LIVE_SMOKE === "1"
  && Boolean(process.env.DEEPSEEK_API_KEY);
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const sessionId = "session-deepseek-evaluation-live";
const sessionEpoch = "epoch-deepseek-evaluation-live";
const evidenceIds = ["evidence-live-fact", "evidence-live-collaboration"];

const evaluationCase = EvaluationCaseSchema.parse({
  schemaVersion: "evaluation/1.0.0",
  evaluationCaseId: "evaluation-case-deepseek-live",
  caseRevision: 1,
  caseHash: hashA,
  sessionEpoch,
  submissionId: "submission-deepseek-live",
  artifactId: "artifact-deepseek-live",
  revisionId: "revision-deepseek-live-r2",
  evidenceBundleId: "bundle-deepseek-live",
  evidenceBundleHash: hashB,
  rubricId: "rubric-local-tourism-media",
  rubricVersion: "1.0.0",
  rubricHash: hashA,
  dimensions: [
    {
      dimensionId: "fact_traceability",
      label: "事实与证据可追溯",
      weight: 0.6,
      maxScore: 60,
      rule: "事实判断必须引用固定证据，且区分现场观察与已审核事实。",
      evaluationKind: "evidence_action",
    },
    {
      dimensionId: "professional_handoff",
      label: "职业协作与交接",
      weight: 0.4,
      maxScore: 40,
      rule: "作品必须保留岗位交接、风险升级与发布门禁证据。",
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
  openedFromMessageId: "message-deepseek-live",
  openedAt: "2026-07-25T15:00:00.000Z",
});

const evidenceBundle = EvaluationEvidenceBundleSchema.parse({
  schemaVersion: "evaluation/1.0.0",
  bundleId: evaluationCase.evidenceBundleId,
  sessionEpoch,
  submissionId: evaluationCase.submissionId,
  artifactId: evaluationCase.artifactId,
  revisionId: evaluationCase.revisionId,
  revisionNumber: 2,
  revisionContentHash: hashA,
  rubricId: evaluationCase.rubricId,
  rubricVersion: evaluationCase.rubricVersion,
  rubricHash: evaluationCase.rubricHash,
  evidenceRefs: evidenceIds.map((evidenceId, index) => ({
    evidenceId,
    contentHash: index === 0 ? hashA : hashB,
    audienceHash: hashB,
  })),
  sourceEventRefs: ["event-submission-deepseek-live"],
  scenarioReleaseId: "release-deepseek-live",
  scenarioContentHash: hashB,
  createdAt: "2026-07-25T15:00:00.000Z",
  bundleHash: hashB,
});

function role(input: {
  agentId: string;
  roleId: "assessor" | "learning_curator";
  allowedIntent: "record_evaluation_proposal" | "propose_learning_candidate";
}): RoleContract {
  return RoleContractSchema.parse({
    agentId: input.agentId,
    actorKind: "agent",
    roleId: input.roleId,
    displayName: input.agentId,
    purpose: "DeepSeek V4 结构化评价与学习候选现场验收",
    teamId: "team-jiangnan-01",
    visibleScopes: ["assigned_team", "role_private", "audit_only"],
    privateScopes: [`actor:${input.agentId}`],
    allowedIntents: [input.allowedIntent],
    deniedActions: ["形成最终成绩", "直接发布学习内容"],
    toolPolicy: ["read_reviewed_facts"],
    tokenBudget: 4_000,
  });
}

function request(input: {
  role: RoleContract;
  triggerType: "evaluation_case_opened" | "teacher_reviewed";
  signals: AgentRunRequest["signals"];
  fixed?: Array<{ itemId: string; content: string }>;
  transient?: Array<{ itemId: string; content: string }>;
}): AgentRunRequest {
  const context = buildAgentContext({
    role: input.role,
    sessionId,
    sessionEpoch,
    stateVersion: 42,
    ...(input.fixed ? { fixed: input.fixed } : {}),
    evidence: [
      {
        itemId: evidenceIds[0]!,
        content: "经审核客流口径为去重后的入口计数，作品已明确标注统计来源。",
      },
      {
        itemId: evidenceIds[1]!,
        content: "责任编辑完成版权风险升级、暂停发布和总编门禁交接。",
      },
    ],
    ...(input.transient ? { transient: input.transient } : {}),
  });
  return AgentRunRequestSchema.parse({
    ...createMessageMeta({
      sessionId,
      sceneId: "scenario-local-tourism-media-v0.1",
      actorId: input.role.agentId,
      correlationId: `deepseek-live-${input.role.agentId}`,
      timestamp: "2026-07-25T15:00:00.000Z",
    }),
    kind: "AgentRunRequest",
    taskId: `task-deepseek-live-${input.role.agentId}`,
    agentRunId: `run-deepseek-live-${input.role.agentId}-${Date.now()}`,
    role: input.role,
    trigger: {
      type: input.triggerType,
      sourceId: `event-${input.triggerType}`,
    },
    stateVersion: 42,
    access: context.access,
    context: context.context,
    contextManifest: context.contextManifest,
    signals: input.signals,
  });
}

const provider = liveEnabled
  ? new OpenAiCompatibleModelProvider({
      profileId: "deepseek-v4-evaluation-live",
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      maxRetries: 0,
    })
  : null;

describe.runIf(liveEnabled)("DeepSeek V4 evaluation and learning graphs", () => {
  const semanticModel = new GatewaySemanticEvaluationModel({
    provider: provider!,
    profileId: "deepseek-v4-evaluation-live",
    timeoutMs: 30_000,
  });
  const runtime = new AgentRuntime({
    handlers: new Map([
      ...createSemanticEvaluatorHandlers(new Map([
        ["evidence_sufficiency", semanticModel],
        ["work_quality", semanticModel],
        ["professional_collaboration", semanticModel],
      ])),
      ...createLearningCuratorHandlers(new GatewayLearningCuratorModel({
        provider: provider!,
        profileId: "deepseek-v4-evaluation-live",
        timeoutMs: 30_000,
      })),
    ]),
  });

  it.each(semanticEvaluatorProfiles)(
    "returns a guarded live proposal for $evaluatorKind",
    async (profile) => {
      const assessor = role({
        agentId: profile.agentId,
        roleId: "assessor",
        allowedIntent: "record_evaluation_proposal",
      });
      const result = await runtime.run(
        semanticEvaluatorDefinitions.get(profile.agentId)!,
        request({
          role: assessor,
          triggerType: "evaluation_case_opened",
          fixed: [
            {
              itemId: "evaluation-policy",
              content: [
                `评价器：${profile.label} (${profile.evaluatorKind})`,
                `案件：${evaluationCase.evaluationCaseId}@${evaluationCase.caseRevision}`,
                `量规：${evaluationCase.rubricId}@${evaluationCase.rubricVersion}`,
                `allowedEvidenceRefs：${evidenceIds.join(",")}`,
                "必须逐一覆盖下方全部 dimensions，字段必须与输出契约完全一致。",
              ].join("\n"),
            },
          ],
          transient: [
            {
              itemId: "evaluation-case",
              content: JSON.stringify({
                evaluationCaseId: evaluationCase.evaluationCaseId,
                dimensions: evaluationCase.dimensions,
              }),
            },
            {
              itemId: "evidence-bundle",
              content: JSON.stringify({
                revisionId: evidenceBundle.revisionId,
                evidenceRefs: evidenceBundle.evidenceRefs,
              }),
            },
          ],
          signals: {
            evaluatorKind: profile.evaluatorKind,
            evaluationCase: JSON.stringify(evaluationCase),
            evidenceBundle: JSON.stringify(evidenceBundle),
            allowedEvidenceRefs: evidenceIds.join(","),
          },
        }),
      );

      expect(result.trace.status, JSON.stringify({
        errorCode: result.trace.errorCode,
        nodes: result.trace.nodes.map((node) => ({
          nodeId: node.nodeId,
          status: node.status,
          errorCode: node.errorCode,
        })),
        intent: result.intent?.proposedPayload,
      })).toBe("completed");
      expect(result.intent?.proposedPayload).toMatchObject({
        evaluatorKind: profile.evaluatorKind,
        status: "completed",
        errorCode: null,
      });
      expect(result.trace.modelInvocations[0]).toMatchObject({
        provider: "deepseek",
        mode: "live",
      });
      const dimensions = result.intent?.proposedPayload.dimensions as Array<{
        evidenceRefs: string[];
      }>;
      expect(dimensions).toHaveLength(evaluationCase.dimensions.length);
      expect(dimensions.flatMap((dimension) => dimension.evidenceRefs).every(
        (evidenceRef) => evidenceIds.includes(evidenceRef),
      )).toBe(true);
    },
    60_000,
  );

  it("returns a guarded pending-review learning candidate", async () => {
    const learningInput = LearningCuratorInputSchema.parse({
      reviewId: "teacher-review-deepseek-live",
      evaluationCaseId: evaluationCase.evaluationCaseId,
      finalScore: 92,
      publicSummary: "作品完成事实核验、版权风险升级与多岗位发布门禁交接。",
      dimensions: [
        {
          dimensionId: "fact_traceability",
          finalScore: 55,
          maxScore: 60,
          publicFeedback: "事实来源与固定证据能够相互印证。",
          evidenceRefs: [evidenceIds[0]],
        },
        {
          dimensionId: "professional_handoff",
          finalScore: 37,
          maxScore: 40,
          publicFeedback: "岗位交接和发布门禁留痕完整。",
          evidenceRefs: [evidenceIds[1]],
        },
      ],
      finalHash: hashA,
    });
    const curator = role({
      agentId: "agent-learning",
      roleId: "learning_curator",
      allowedIntent: "propose_learning_candidate",
    });
    const result = await runtime.run(
      learningCuratorAgentDefinition,
      request({
        role: curator,
        triggerType: "teacher_reviewed",
        fixed: [
          {
            itemId: "learning-policy",
            content: [
              `终评：${learningInput.reviewId} / ${learningInput.finalHash}`,
              `评价案件：${learningInput.evaluationCaseId}`,
              `allowedEvidenceRefs：${evidenceIds.join(",")}`,
              "只能生成 pending_review assessment_example，不能批准、发布或回滚。",
            ].join("\n"),
          },
        ],
        transient: [
          {
            itemId: "teacher-review-public",
            content: JSON.stringify(learningInput),
          },
        ],
        signals: {
          teacherReview: JSON.stringify(learningInput),
          evaluationCaseId: learningInput.evaluationCaseId,
          finalAssessmentId: learningInput.reviewId,
          allowedEvidenceRefs: evidenceIds.join(","),
        },
      }),
    );

    expect(result.trace.status, JSON.stringify({
      errorCode: result.trace.errorCode,
      nodes: result.trace.nodes.map((node) => ({
        nodeId: node.nodeId,
        status: node.status,
        errorCode: node.errorCode,
      })),
      intent: result.intent?.proposedPayload,
    })).toBe("completed");
    expect(result.intent?.proposedPayload).toMatchObject({
      status: "completed",
      candidateType: "assessment_example",
    });
    expect(result.trace.modelInvocations[0]).toMatchObject({
      provider: "deepseek",
      mode: "live",
    });
    expect(JSON.stringify(result.intent)).not.toMatch(
      /internalNote|reviewedBy|providerRequestId|sk-/iu,
    );
  }, 60_000);
});
