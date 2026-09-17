import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { V2IdentifierSchema } from "@ronggang/contracts";
import type { SimulationAgentTemplateV3 } from "@ronggang/agent-runtime";
import { PermissionDeniedError, type WorldSimulationEngineV3 } from "@ronggang/world-core";
import type { FlagshipStudentWorkServiceV3 } from "./flagship-student-work-v3.js";
import type {
  AuthorizedSimulationWorldActorV3,
} from "./world-simulation-v3-routes.js";

const sessionParamsSchema = z.object({ sessionId: V2IdentifierSchema }).strict();
const bindingQuerySchema = z.object({ bindingId: V2IdentifierSchema }).strict();
const challengeLevelSchema = z.union([
  z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
]);

const groupDescriptions: Readonly<Record<string, {
  title: string;
  responsibility: string;
}>> = {
  teaching_direction: {
    title: "教学与情境导演",
    responsibility: "控制教学压力、虚拟时间与下一波冲突候选，不替学生行动。",
  },
  field_npc: {
    title: "现场人物与信源",
    responsibility: "以局部视野、目标、关系和记忆回应采访与现场变化。",
  },
  editorial_collaboration: {
    title: "采编与编辑协作",
    responsibility: "围绕选题、稿件、信源和发布责任提供岗位建议。",
  },
  verification_governance: {
    title: "核查与内容治理",
    responsibility: "处理事实、权利、隐私和公共安全风险，必要时触发教师门。",
  },
  operations_distribution: {
    title: "运营与平台分发",
    responsibility: "模拟平台审核、多端发布、传播反馈与更正回执。",
  },
  assessment_growth: {
    title: "评价与学习成长",
    responsibility: "只从真实过程证据形成评价和成长候选，不直接给出权威成绩。",
  },
};

export interface FlagshipRoleViewsV3RouteDependencies {
  engine: Pick<WorldSimulationEngineV3, "getRecord">;
  work: Pick<FlagshipStudentWorkServiceV3, "getReviewWorkspace">;
  templates: readonly SimulationAgentTemplateV3[];
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

export async function registerFlagshipRoleViewsV3Routes(
  app: FastifyInstance,
  dependencies: FlagshipRoleViewsV3RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/work-review",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      if (authorized.audience !== "teacher" && authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有课程教师或管理员可以查看学生作品送审视图");
      }
      const world = await dependencies.engine.getRecord(params.sessionId);
      return {
        review: await dependencies.work.getReviewWorkspace({
          sessionId: params.sessionId,
          challengeLevel: challengeLevelSchema.parse(
            world.challengeAssignment.challengeLevel,
          ),
        }),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/admin/sessions/:sessionId/agent-topology",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      if (authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有管理员可以查看 V3 智能体执行拓扑");
      }
      const world = await dependencies.engine.getRecord(params.sessionId);
      const groupIds = [...new Set(dependencies.templates.map((item) => item.groupId))];
      if (groupIds.length !== 6 || dependencies.templates.length !== 14) {
        throw new Error("旗舰 V3 拓扑必须保持六组十四个受控智能体");
      }
      return {
        topology: {
          schemaVersion: "simulation-agent-topology/3.0.0",
          sessionId: params.sessionId,
          simulationReleaseRef: world.release.simulationReleaseRef,
          generatedAt: world.release.publishedAt,
          groups: groupIds.map((groupId, index) => {
            const description = groupDescriptions[groupId];
            if (!description) throw new Error(`V3 拓扑缺少职责组说明：${groupId}`);
            return { groupId, ...description, order: index + 1 };
          }),
          agents: dependencies.templates.map((template) => ({
            agentId: template.agentId,
            agentTemplateId: template.agentTemplateId,
            professionalRoleId: template.professionalRoleId,
            displayName: template.displayName,
            responsibility: template.responsibility,
            groupId: template.groupId,
            contributionKind: template.contributionKind,
            subscribedEventTypes: template.subscribedEventTypes,
            affectedObjectSelectors: template.affectedObjectSelectors,
            toolCapabilityRefs: template.toolCapabilityRefs,
            disclosurePolicyRef: template.disclosurePolicyRef,
            actionBudget: template.initialActionBudget,
            dispatchPriority: template.dispatchPriority,
            enabled: template.enabled,
            available: template.available,
            authority: "proposal_only",
            forbiddenActions: [
              "authoritative_world_write",
              "teacher_gate_bypass",
              "private_context_export",
            ],
          })),
        },
      };
    },
  );
}
