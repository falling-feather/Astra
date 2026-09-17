import {
  ScenarioCompilerVersion,
  ScenarioPackageSchema,
  ScenarioValidationReportSchema,
  type CollaborationStrategy,
  type ScenarioPackage,
  type ScenarioValidationIssue,
  type ScenarioValidationReport,
} from "@ronggang/contracts";
import { createHash } from "node:crypto";
import { hashCanonical, hashScenarioPackage } from "./canonical.js";
import { validateScenarioCollaborationConfig } from "./collaboration-config.js";

const registeredGovernanceNodeCombinations = new Set([
  "governance-content-safety|governance-specialist/1.0.1|governance-content-safety/1.0.1|content-safety-cn/2026.1",
  "governance-copyright-scope|governance-specialist/1.0.1|governance-copyright/1.0.1|copyright-scope/2026.1",
  "governance-fact-consistency|governance-specialist/1.0.1|governance-fact/1.0.1|source-consistency/2026.1",
  "governance-platform-rules|governance-specialist/1.0.1|governance-platform/1.0.1|platform-publication/2026.1",
]);

function duplicateIssues(
  values: readonly string[],
  path: string,
  label: string,
): ScenarioValidationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].map((value) => ({
    code: "duplicate_id",
    severity: "error",
    path,
    message: `${label}标识重复：${value}`,
  }));
}

function issue(
  code: string,
  path: string,
  message: string,
  severity: "error" | "warning" = "error",
): ScenarioValidationIssue {
  return { code, severity, path, message };
}

export function validateScenarioPackage(
  rawPackage: unknown,
  input: {
    draftId?: string;
    revision?: number;
    validatedAt?: string;
    collaborationStrategySnapshot?: readonly CollaborationStrategy[];
    requireCollaborationConfig?: boolean;
  } = {},
): ScenarioValidationReport {
  const parsed = ScenarioPackageSchema.safeParse(rawPackage);
  const definitionHash = hashCanonical(rawPackage);
  const issues: ScenarioValidationIssue[] = [];
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      issues.push(issue(
        "schema_invalid",
        zodIssue.path.length > 0 ? zodIssue.path.join(".") : "$",
        zodIssue.message,
      ));
    }
  } else {
    const scenario = parsed.data;
    const roleIds = new Set(scenario.roles.map((role) => role.agentId));
    const rolesByActor = new Map(scenario.roles.map((role) => [role.agentId, role]));
    const rolesByRole = new Map(scenario.roles.map((role) => [role.roleId, role]));
    const nodeIds = new Set(scenario.nodes.map((node) => node.nodeId));
    const materialIds = new Set(scenario.materials.map((material) => material.materialId));
    const optionIds = new Set(scenario.roleInteractions.map((item) => item.optionId));
    const approvalIds = new Set(scenario.approvalPolicies.map((item) => item.approvalPolicyId));
    const knowledgeChunkIds = new Set(scenario.knowledgeChunks.map((item) => item.chunkId));

    issues.push(
      ...validateScenarioCollaborationConfig({
        config: scenario.collaborationConfig,
        scenarioId: scenario.scenarioId,
        ...(input.collaborationStrategySnapshot
          ? { strategySnapshot: input.collaborationStrategySnapshot }
          : {}),
        ...(input.requireCollaborationConfig !== undefined
          ? { required: input.requireCollaborationConfig }
          : {}),
      }),
      ...duplicateIssues(scenario.roles.map((role) => role.agentId), "roles", "角色"),
      ...duplicateIssues(scenario.nodes.map((node) => node.nodeId), "nodes", "节点"),
      ...duplicateIssues(scenario.nodes.map((node) => String(node.order)), "nodes.order", "节点顺序"),
      ...duplicateIssues(scenario.materials.map((material) => material.materialId), "materials", "材料"),
      ...duplicateIssues(scenario.roleInteractions.map((item) => item.optionId), "roleInteractions", "互动选项"),
      ...duplicateIssues(scenario.rubric.map((item) => item.criterionId), "rubric", "评分项"),
      ...duplicateIssues(scenario.approvalPolicies.map((item) => item.approvalPolicyId), "approvalPolicies", "审批策略"),
      ...duplicateIssues(scenario.eventPolicies.map((item) => item.policyId), "eventPolicies", "事件策略"),
      ...duplicateIssues(
        (scenario.directorEventTemplates ?? []).map((item) => item.routeId),
        "directorEventTemplates",
        "导演路线",
      ),
      ...duplicateIssues(scenario.knowledgeChunks.map((item) => item.chunkId), "knowledgeChunks", "知识切片"),
    );

    if (!scenario.roles.some((role) => role.actorKind === "teacher" && role.roleId === "teacher")) {
      issues.push(issue("missing_teacher", "roles", "情境必须包含教师角色"));
    }
    if (!scenario.roles.some((role) => role.actorKind === "system" && role.roleId === "system")) {
      issues.push(issue("missing_system", "roles", "情境必须包含唯一权威世界内核角色"));
    }
    const studentRoles = scenario.roles.filter((role) => (
      role.actorKind === "student"
    ));
    if (studentRoles.length === 0) {
      issues.push(issue("missing_student_role", "roles", "情境必须包含学生岗位"));
    } else if (studentRoles.length === 1) {
      const controlledCollaborators = scenario.roles.filter((role) => (
        role.actorKind === "agent"
        && [
          "editor_in_chief",
          "fact_checker",
          "copyright_owner",
          "platform_operator",
        ].includes(role.roleId)
      ));
      if (
        studentRoles[0]?.roleId !== "reporter"
        || controlledCollaborators.length < 2
      ) {
        issues.push(issue(
          "single_student_role_invalid",
          "roles",
          "单主岗情境只允许记者学生，并至少配置两个受控采编、核查、治理或运营协作者",
        ));
      }
    }
    if (!nodeIds.has(scenario.bootstrap.entryNodeId)) {
      issues.push(issue("unknown_entry_node", "bootstrap.entryNodeId", "入口节点不存在"));
    }
    for (const fact of scenario.bootstrap.initialFacts) {
      for (const sourceRef of fact.sourceRefs) {
        if (!materialIds.has(sourceRef)) {
          issues.push(issue("unknown_fact_material", `bootstrap.initialFacts.${fact.factId}`, `事实引用未知材料：${sourceRef}`));
        }
      }
    }
    for (const message of scenario.bootstrap.openingMessages) {
      const role = rolesByActor.get(message.actorId);
      if (!role || role.roleId !== message.roleId) {
        issues.push(issue("unknown_message_actor", `bootstrap.openingMessages.${message.actorId}`, "启动消息的角色引用不一致"));
      }
    }
    for (const seed of scenario.bootstrap.memorySeeds) {
      if (!roleIds.has(seed.actorId)) {
        issues.push(issue("unknown_memory_actor", `bootstrap.memorySeeds.${seed.actorId}`, "私有记忆种子引用未知角色"));
      }
    }
    for (const material of scenario.materials) {
      if (!material.sourceRef.startsWith("/assets/") && !material.sourceRef.startsWith("demo://")) {
        issues.push(issue("unsafe_material_ref", `materials.${material.materialId}.sourceRef`, "材料只能引用已登记的 /assets/ 或 demo:// 资源"));
      }
      for (const roleId of material.visibleToRoles) {
        if (!scenario.roles.some((role) => role.roleId === roleId)) {
          issues.push(issue("unknown_material_role", `materials.${material.materialId}.visibleToRoles`, `材料引用未配置岗位：${roleId}`));
        }
      }
    }
    for (const interaction of scenario.roleInteractions) {
      const initiator = rolesByActor.get(interaction.initiatorActorId);
      const target = rolesByActor.get(interaction.targetActorId);
      if (!initiator) {
        issues.push(issue("unknown_interaction_initiator", `roleInteractions.${interaction.optionId}`, "互动发起角色不存在"));
      }
      if (!target || target.roleId !== interaction.targetRoleId) {
        issues.push(issue("unknown_interaction_target", `roleInteractions.${interaction.optionId}`, "互动目标角色不存在或岗位不匹配"));
      }
      if (initiator && !initiator.communicationPolicy?.allowedTargetRoleIds.includes(interaction.targetRoleId)) {
        issues.push(issue("interaction_acl_denied", `roleInteractions.${interaction.optionId}`, "互动目标未被岗位通信契约授权"));
      }
      for (const prerequisite of interaction.prerequisites) {
        if (prerequisite.kind === "interaction_responded" && !optionIds.has(prerequisite.optionId)) {
          issues.push(issue("unknown_prerequisite_option", `roleInteractions.${interaction.optionId}.prerequisites`, `前置互动不存在：${prerequisite.optionId}`));
        }
      }
    }
    for (const gate of scenario.interactionGates) {
      for (const optionId of gate.requiredOptionIds) {
        if (!optionIds.has(optionId)) {
          issues.push(issue("unknown_gate_option", `interactionGates.${gate.command}`, `门禁引用未知互动：${optionId}`));
        }
      }
    }
    for (const policy of scenario.eventPolicies) {
      const sourceRole = scenario.roles.find((role) => role.roleId === policy.sourceRoleId);
      if (!sourceRole || !sourceRole.allowedIntents.includes(policy.sourceIntentType)) {
        issues.push(issue("invalid_event_source", `eventPolicies.${policy.policyId}`, "事件策略来源岗位未声明对应行动意图"));
      }
      if (policy.requiredOptionId && !optionIds.has(policy.requiredOptionId)) {
        issues.push(issue("unknown_event_option", `eventPolicies.${policy.policyId}.requiredOptionId`, "事件策略引用未知互动选项"));
      }
      if (!approvalIds.has(policy.approvalPolicyId)) {
        issues.push(issue("unknown_approval_policy", `eventPolicies.${policy.policyId}.approvalPolicyId`, "事件策略引用未知审批策略"));
      }
      const expectedEventByHandler = {
        visitor_correction_v1: "world_fact_updated",
        copyright_dispute_v1: "copyright_risk_flagged",
        platform_escalation_v1: "node_activated",
      } as const;
      if (expectedEventByHandler[policy.effectHandlerId] !== policy.eventType) {
        issues.push(issue(
          "effect_event_mismatch",
          `eventPolicies.${policy.policyId}.eventType`,
          `效果处理器 ${policy.effectHandlerId} 不能生成 ${policy.eventType}`,
        ));
      }
    }
    const eventPolicySources = new Map<string, string>();
    for (const policy of scenario.eventPolicies) {
      const key = [
        policy.sourceRoleId,
        policy.sourceIntentType,
        policy.requiredOptionId ?? "none",
      ].join(":");
      const existing = eventPolicySources.get(key);
      if (existing) {
        issues.push(issue(
          "ambiguous_event_policy",
          `eventPolicies.${policy.policyId}`,
          `事件策略来源与 ${existing} 重复，运行时无法无歧义选择`,
        ));
      } else {
        eventPolicySources.set(key, policy.policyId);
      }
    }
    if (Boolean(scenario.directorConfig) !== Boolean(scenario.directorEventTemplates)) {
      issues.push(issue(
        "director_config_incomplete",
        "directorConfig",
        "导演策略与导演事件模板必须同时配置",
      ));
    }
    if (scenario.directorConfig && scenario.directorEventTemplates) {
      const routeIds = new Set(scenario.directorEventTemplates.map((template) => template.routeId));
      const allowedDirectorTriggers = new Set([
        "session_started",
        "node_activated",
        "world_fact_confirmed",
        "world_fact_updated",
        "director_recovery_requested",
      ]);
      if (!scenario.roles.some((role) => (
        role.roleId === "scene_director"
        && role.allowedIntents.includes("propose_scenario_intervention")
        && role.allowedIntents.includes("record_scene_no_op")
      ))) {
        issues.push(issue(
          "scene_director_contract_invalid",
          "roles",
          "情境导演必须声明候选与 no_op 两类受控意图",
        ));
      }
      if (!scenario.roles.some((role) => (
        role.roleId === "teaching_director"
        && role.allowedIntents.includes("record_teaching_directive")
      ))) {
        issues.push(issue(
          "teaching_director_contract_invalid",
          "roles",
          "教学导演必须声明结构化教学指令意图",
        ));
      }
      if (scenario.directorConfig.allowedRouteIds.length < 2) {
        issues.push(issue(
          "insufficient_director_routes",
          "directorConfig.allowedRouteIds",
          "双导演情境至少需要两条可选择路线",
        ));
      }
      for (const routeId of scenario.directorConfig.allowedRouteIds) {
        if (!routeIds.has(routeId)) {
          issues.push(issue(
            "unknown_allowed_route",
            "directorConfig.allowedRouteIds",
            `导演策略引用未知路线：${routeId}`,
          ));
        }
      }
      const graph = new Map<string, string[]>();
      for (const template of scenario.directorEventTemplates) {
        graph.set(template.routeId, template.alternativeRouteIds);
        for (const nodeId of template.applicableNodeIds) {
          if (!nodeIds.has(nodeId)) {
            issues.push(issue(
              "unknown_director_node",
              `directorEventTemplates.${template.routeId}.applicableNodeIds`,
              `导演路线引用未知节点：${nodeId}`,
            ));
          }
        }
        for (const roleId of template.affectedRoleIds) {
          if (!scenario.roles.some((role) => role.roleId === roleId)) {
            issues.push(issue(
              "unknown_director_role",
              `directorEventTemplates.${template.routeId}.affectedRoleIds`,
              `导演路线引用未配置岗位：${roleId}`,
            ));
          }
        }
        for (const trigger of template.triggerEventTypes) {
          if (!allowedDirectorTriggers.has(trigger)) {
            issues.push(issue(
              "unsafe_director_trigger",
              `directorEventTemplates.${template.routeId}.triggerEventTypes`,
              `导演路线不允许订阅该事件：${trigger}`,
            ));
          }
        }
        if (
          template.maximumEvidenceCount !== null
          && template.maximumEvidenceCount < template.minimumEvidenceCount
        ) {
          issues.push(issue(
            "director_evidence_range_invalid",
            `directorEventTemplates.${template.routeId}`,
            "导演路线最大证据数不能小于最小证据数",
          ));
        }
        if (!approvalIds.has(template.approvalPolicyId)) {
          issues.push(issue(
            "unknown_director_approval_policy",
            `directorEventTemplates.${template.routeId}.approvalPolicyId`,
            "导演路线引用未知审批策略",
          ));
        }
        for (const sourceRef of template.sourceRefs) {
          if (!knowledgeChunkIds.has(sourceRef) && !materialIds.has(sourceRef)) {
            issues.push(issue(
              "unknown_director_source",
              `directorEventTemplates.${template.routeId}.sourceRefs`,
              `导演路线引用未知材料或知识切片：${sourceRef}`,
            ));
          }
        }
        for (const alternativeRouteId of template.alternativeRouteIds) {
          if (!routeIds.has(alternativeRouteId)) {
            issues.push(issue(
              "unknown_alternative_route",
              `directorEventTemplates.${template.routeId}.alternativeRouteIds`,
              `导演路线引用未知替代路线：${alternativeRouteId}`,
            ));
          }
          if (alternativeRouteId === template.routeId) {
            issues.push(issue(
              "director_route_self_cycle",
              `directorEventTemplates.${template.routeId}.alternativeRouteIds`,
              "导演路线不能把自身作为替代路线",
            ));
          }
        }
      }
      const visit = (routeId: string, active: Set<string>, visited: Set<string>): boolean => {
        if (active.has(routeId)) return true;
        if (visited.has(routeId)) return false;
        active.add(routeId);
        for (const next of graph.get(routeId) ?? []) {
          if (visit(next, active, visited)) return true;
        }
        active.delete(routeId);
        visited.add(routeId);
        return false;
      };
      const visited = new Set<string>();
      for (const routeId of routeIds) {
        if (visit(routeId, new Set<string>(), visited)) {
          issues.push(issue(
            "director_route_cycle",
            "directorEventTemplates.alternativeRouteIds",
            "导演替代路线图不能形成循环",
          ));
          break;
        }
      }
    }
    if (scenario.productionConfig) {
      const production = scenario.productionConfig;
      issues.push(
        ...duplicateIssues(
          production.artifactTemplates.map((template) => template.templateId),
          "productionConfig.artifactTemplates",
          "成果模板",
        ),
        ...duplicateIssues(
          production.processingPlans.map((plan) => plan.planId),
          "productionConfig.processingPlans",
          "处理计划",
        ),
        ...duplicateIssues(
          production.allowedUploadMimeTypes,
          "productionConfig.allowedUploadMimeTypes",
          "上传 MIME 类型",
        ),
      );

      for (const template of production.artifactTemplates) {
        issues.push(...duplicateIssues(
          template.sections.map((section) => section.sectionId),
          `productionConfig.artifactTemplates.${template.templateId}.sections`,
          "成果章节",
        ));
        issues.push(...duplicateIssues(
          template.allowedRoleIds,
          `productionConfig.artifactTemplates.${template.templateId}.allowedRoleIds`,
          "成果岗位",
        ));
        for (const roleId of template.allowedRoleIds) {
          const role = rolesByRole.get(roleId);
          if (!role) {
            issues.push(issue(
              "unknown_production_role",
              `productionConfig.artifactTemplates.${template.templateId}.allowedRoleIds`,
              `成果模板引用未配置岗位：${roleId}`,
            ));
            continue;
          }
          const requiredIntents = [
            "create_production_artifact",
            "save_artifact_revision",
          ];
          for (const intent of requiredIntents) {
            if (!role.allowedIntents.includes(intent)) {
              issues.push(issue(
                "production_role_intent_missing",
                `roles.${role.agentId}.allowedIntents`,
                `成果岗位 ${roleId} 未声明必要意图：${intent}`,
              ));
            }
          }
          if (!role.toolPolicy.includes("edit_artifact")) {
            issues.push(issue(
              "production_role_tool_missing",
              `roles.${role.agentId}.toolPolicy`,
              `成果岗位 ${roleId} 未声明 edit_artifact 工具权限`,
            ));
          }
        }
      }

      for (const plan of production.processingPlans) {
        issues.push(...duplicateIssues(
          plan.capabilities,
          `productionConfig.processingPlans.${plan.planId}.capabilities`,
          "处理能力",
        ));
        issues.push(...duplicateIssues(
          plan.allowedMediaTypes,
          `productionConfig.processingPlans.${plan.planId}.allowedMediaTypes`,
          "处理媒体类型",
        ));
        if (plan.minimumSuccessfulSteps > new Set(plan.capabilities).size) {
          issues.push(issue(
            "processing_success_threshold_invalid",
            `productionConfig.processingPlans.${plan.planId}.minimumSuccessfulSteps`,
            "最少成功步骤数不能超过处理计划中的唯一能力数",
          ));
        }
      }

      const governancePlan = production.governancePlan;
      if (governancePlan) {
        issues.push(
          ...duplicateIssues(
            governancePlan.branches.map((branch) => branch.node.nodeId),
            "productionConfig.governancePlan.branches.node.nodeId",
            "治理节点",
          ),
          ...duplicateIssues(
            governancePlan.branches.map((branch) => String(branch.priority)),
            "productionConfig.governancePlan.branches.priority",
            "治理优先级",
          ),
        );

        const requiredDomains = new Set([
          "fact",
          "copyright",
          "content_safety",
          "platform_rule",
        ]);
        for (const branch of governancePlan.branches) {
          requiredDomains.delete(branch.domain);
          const registrationKey = [
            branch.node.nodeId,
            branch.node.definitionVersion,
            branch.node.promptVersion,
            branch.node.rulesetId,
          ].join("|");
          if (!registeredGovernanceNodeCombinations.has(registrationKey)) {
            issues.push(issue(
              "governance_node_definition_unregistered",
              `productionConfig.governancePlan.branches.${branch.domain}.node`,
              `治理节点定义组合未注册：${registrationKey}`,
            ));
          }
          for (const chunkId of branch.node.knowledgeChunkIds) {
            const chunk = scenario.knowledgeChunks.find(
              (candidate) => candidate.chunkId === chunkId,
            );
            if (!chunk) {
              issues.push(issue(
                "unknown_governance_knowledge",
                `productionConfig.governancePlan.branches.${branch.domain}.node.knowledgeChunkIds`,
                `治理节点引用未知知识切片：${chunkId}`,
              ));
              continue;
            }
            const actualContentHash = createHash("sha256")
              .update(chunk.content, "utf8")
              .digest("hex");
            if (
              chunk.status !== "active"
              || chunk.contentHash !== actualContentHash
            ) {
              issues.push(issue(
                "governance_knowledge_integrity_invalid",
                `knowledgeChunks.${chunkId}`,
                `治理知识切片未激活或内容哈希失配：${chunkId}`,
              ));
            }
            if (
              chunk.audience.scopes.some((scope) => (
                scope === "role_private"
                || scope === "teacher_only"
                || scope === "audit_only"
              ))
              || chunk.audience.roleIds.length > 0
              || chunk.audience.actorIds.length > 0
              || chunk.audience.privateNamespaces.length > 0
            ) {
              issues.push(issue(
                "governance_knowledge_acl_too_narrow",
                `knowledgeChunks.${chunkId}.audience`,
                `治理运行知识不得旁路岗位私有或教师专属边界：${chunkId}`,
              ));
            }
          }
        }
        if (requiredDomains.size > 0) {
          issues.push(issue(
            "governance_domains_incomplete",
            "productionConfig.governancePlan.branches",
            `旗舰治理计划缺少专业领域：${[...requiredDomains].join("、")}`,
          ));
        }

        const teacherRole = scenario.roles.find((role) => (
          role.actorKind === "teacher"
          && role.allowedIntents.includes("review_governance")
          && role.toolPolicy.includes("governance.review")
        ));
        if (!teacherRole) {
          issues.push(issue(
            "governance_teacher_contract_missing",
            "roles",
            "治理计划要求教师角色声明 review_governance 意图和 governance.review 工具",
          ));
        }
        const requesterRole = scenario.roles.find((role) => (
          role.actorKind === "student"
          && role.allowedIntents.includes("request_governance_review")
          && role.toolPolicy.includes("governance.review.request")
        ));
        if (!requesterRole) {
          issues.push(issue(
            "governance_requester_contract_missing",
            "roles",
            "治理计划要求至少一个学生岗位声明审核请求意图和工具",
          ));
        }
      }

      if (!production.artifactTemplates.some((template) => (
        template.kind === "article"
        && template.allowedRoleIds.includes("responsible_editor")
        && template.minimumRevisions >= 2
      ))) {
        issues.push(issue(
          "missing_flagship_article_template",
          "productionConfig.artifactTemplates",
          "旗舰融媒体情境必须包含责任编辑可用且至少两版的文章成果模板",
        ));
      }
    }
    if (scenario.courseGuide) {
      const guide = scenario.courseGuide;
      const artifactTemplateIds = new Set(
        scenario.productionConfig?.artifactTemplates.map(
          (template) => template.templateId,
        ) ?? [],
      );
      issues.push(
        ...duplicateIssues(
          guide.learningObjectives.map((objective) => objective.objectiveId),
          "courseGuide.learningObjectives",
          "课程目标",
        ),
        ...duplicateIssues(
          guide.roleBriefs.map((brief) => brief.roleId),
          "courseGuide.roleBriefs",
          "岗位任务卡",
        ),
        ...duplicateIssues(
          guide.nodeGuides.map((nodeGuide) => nodeGuide.nodeId),
          "courseGuide.nodeGuides",
          "节点工作指引",
        ),
      );
      if (guide.contentVersion !== scenario.version) {
        issues.push(issue(
          "course_guide_version_mismatch",
          "courseGuide.contentVersion",
          "课程内容指引版本必须与情境包版本一致",
        ));
      }
      const briefRoleIds = new Set(guide.roleBriefs.map((brief) => brief.roleId));
      for (const studentRole of scenario.roles.filter(
        (role) => role.actorKind === "student",
      )) {
        if (!briefRoleIds.has(studentRole.roleId)) {
          issues.push(issue(
            "missing_student_role_brief",
            "courseGuide.roleBriefs",
            `学生岗位缺少任务卡：${studentRole.roleId}`,
          ));
        }
      }
      for (const brief of guide.roleBriefs) {
        const configuredRole = scenario.roles.find(
          (role) => role.roleId === brief.roleId,
        );
        if (!configuredRole || configuredRole.actorKind !== "student") {
          issues.push(issue(
            "invalid_course_brief_role",
            `courseGuide.roleBriefs.${brief.roleId}`,
            "岗位任务卡只能引用已配置的学生岗位",
          ));
        }
        for (const collaborationRoleId of brief.collaborationRoleIds) {
          if (!scenario.roles.some((role) => (
            role.roleId === collaborationRoleId
          ))) {
            issues.push(issue(
              "unknown_course_collaboration_role",
              `courseGuide.roleBriefs.${brief.roleId}.collaborationRoleIds`,
              `岗位任务卡引用未知协作岗位：${collaborationRoleId}`,
            ));
          }
        }
        for (const nodeId of brief.primaryNodeIds) {
          if (!nodeIds.has(nodeId)) {
            issues.push(issue(
              "unknown_course_brief_node",
              `courseGuide.roleBriefs.${brief.roleId}.primaryNodeIds`,
              `岗位任务卡引用未知节点：${nodeId}`,
            ));
          }
        }
        for (const templateId of brief.deliverableTemplateIds) {
          if (!artifactTemplateIds.has(templateId)) {
            issues.push(issue(
              "unknown_course_brief_template",
              `courseGuide.roleBriefs.${brief.roleId}.deliverableTemplateIds`,
              `岗位任务卡引用未知成果模板：${templateId}`,
            ));
          }
        }
      }
      const guidedNodeIds = new Set(
        guide.nodeGuides.map((nodeGuide) => nodeGuide.nodeId),
      );
      for (const nodeId of nodeIds) {
        if (!guidedNodeIds.has(nodeId)) {
          issues.push(issue(
            "missing_course_node_guide",
            "courseGuide.nodeGuides",
            `情境节点缺少工作指引：${nodeId}`,
          ));
        }
      }
      for (const nodeGuide of guide.nodeGuides) {
        if (!nodeIds.has(nodeGuide.nodeId)) {
          issues.push(issue(
            "unknown_course_guide_node",
            `courseGuide.nodeGuides.${nodeGuide.nodeId}`,
            "节点工作指引引用未知情境节点",
          ));
        }
        for (const materialId of nodeGuide.requiredMaterialIds) {
          if (!materialIds.has(materialId)) {
            issues.push(issue(
              "unknown_course_guide_material",
              `courseGuide.nodeGuides.${nodeGuide.nodeId}.requiredMaterialIds`,
              `节点工作指引引用未知材料：${materialId}`,
            ));
          }
        }
        for (const templateId of nodeGuide.suggestedArtifactTemplateIds) {
          if (!artifactTemplateIds.has(templateId)) {
            issues.push(issue(
              "unknown_course_guide_template",
              `courseGuide.nodeGuides.${nodeGuide.nodeId}.suggestedArtifactTemplateIds`,
              `节点工作指引引用未知成果模板：${templateId}`,
            ));
          }
        }
      }
    }
    if (scenario.experienceDesign) {
      const design = scenario.experienceDesign;
      const configuredRoleIds = new Set(
        scenario.roles.map((role) => role.roleId),
      );
      const studentRoleIds = new Set(
        scenario.roles
          .filter((role) => role.actorKind === "student")
          .map((role) => role.roleId),
      );
      const sceneIds = new Set(design.scenes.map((scene) => scene.sceneId));
      const npcActorIds = new Set(
        design.npcInstances.map((npc) => npc.actorId),
      );
      const hotspotsById = new Map(
        design.hotspots.map((hotspot) => [hotspot.hotspotId, hotspot]),
      );
      const taskNodeById = new Map<string, string>();
      const opportunityNodeById = new Map<string, string>();
      const gapNodeById = new Map<string, string>();
      const contributionNodeById = new Map<string, string>();
      const dynamicEventNodeById = new Map<string, string>();
      const deliverableNodeById = new Map<string, string>();
      const evidenceNodeById = new Map<string, string>();
      const choiceNodeIdsByRef = new Map<string, Set<string>>();

      issues.push(
        ...duplicateIssues(
          design.scenes.map((scene) => scene.sceneId),
          "experienceDesign.scenes",
          "体验场景",
        ),
        ...duplicateIssues(
          design.npcInstances.map((npc) => npc.actorId),
          "experienceDesign.npcInstances",
          "NPC实例",
        ),
        ...duplicateIssues(
          design.hotspots.map((hotspot) => hotspot.hotspotId),
          "experienceDesign.hotspots",
          "体验热点",
        ),
        ...duplicateIssues(
          design.nodeMappings.map((mapping) => mapping.nodeId),
          "experienceDesign.nodeMappings",
          "节点体验映射",
        ),
        ...duplicateIssues(
          design.causalBranches.map((branch) => branch.branchId),
          "experienceDesign.causalBranches",
          "因果分支",
        ),
      );
      if (design.contentVersion !== scenario.version) {
        issues.push(issue(
          "experience_version_mismatch",
          "experienceDesign.contentVersion",
          "双维度体验内容版本必须与情境包版本一致",
        ));
      }
      if (design.kind === "flagship" && scenario.nodes.length !== 7) {
        issues.push(issue(
          "flagship_node_count_invalid",
          "experienceDesign.kind",
          "旗舰黄金路径必须固定为七个课程节点",
        ));
      }
      if (design.kind === "micro_transfer") {
        const studentCount = scenario.roles.filter(
          (role) => role.actorKind === "student",
        ).length;
        if (studentCount !== 2) {
          issues.push(issue(
            "transfer_student_count_invalid",
            "roles",
            "第二微型情境必须固定两个学生岗位",
          ));
        }
        if (design.npcInstances.length !== 2) {
          issues.push(issue(
            "transfer_npc_count_invalid",
            "experienceDesign.npcInstances",
            "第二微型情境必须固定两个私有NPC实例",
          ));
        }
        if (scenario.nodes.length !== 3) {
          issues.push(issue(
            "transfer_node_count_invalid",
            "nodes",
            "第二微型情境必须固定三个连续课程节点",
          ));
        }
      }

      for (const scene of design.scenes) {
        for (const nodeId of scene.nodeIds) {
          if (!nodeIds.has(nodeId)) {
            issues.push(issue(
              "unknown_experience_scene_node",
              `experienceDesign.scenes.${scene.sceneId}.nodeIds`,
              `体验场景引用未知节点：${nodeId}`,
            ));
          }
        }
      }
      for (const npc of design.npcInstances) {
        const actor = rolesByActor.get(npc.actorId);
        if (
          !actor
          || actor.actorKind !== "agent"
          || actor.roleId !== npc.roleId
        ) {
          issues.push(issue(
            "invalid_experience_npc",
            `experienceDesign.npcInstances.${npc.actorId}`,
            "NPC实例必须引用角色与岗位一致的智能体Actor",
          ));
        }
        for (const sceneId of npc.sceneIds) {
          if (!sceneIds.has(sceneId)) {
            issues.push(issue(
              "unknown_experience_npc_scene",
              `experienceDesign.npcInstances.${npc.actorId}.sceneIds`,
              `NPC实例引用未知场景：${sceneId}`,
            ));
          }
        }
      }
      for (const hotspot of design.hotspots) {
        if (!sceneIds.has(hotspot.sceneId)) {
          issues.push(issue(
            "unknown_experience_hotspot_scene",
            `experienceDesign.hotspots.${hotspot.hotspotId}.sceneId`,
            "体验热点引用未知场景",
          ));
        }
        if (
          hotspot.targetActorId
          && !npcActorIds.has(hotspot.targetActorId)
        ) {
          issues.push(issue(
            "unknown_experience_hotspot_npc",
            `experienceDesign.hotspots.${hotspot.hotspotId}.targetActorId`,
            "面向NPC的体验热点必须引用已登记的私有NPC实例",
          ));
        }
        for (const roleId of hotspot.visibleToRoleIds) {
          if (!configuredRoleIds.has(roleId)) {
            issues.push(issue(
              "unknown_experience_hotspot_role",
              `experienceDesign.hotspots.${hotspot.hotspotId}.visibleToRoleIds`,
              `体验热点引用未配置岗位：${roleId}`,
            ));
          }
        }
        for (const optionId of hotspot.interactionOptionIds) {
          const interaction = scenario.roleInteractions.find(
            (candidate) => candidate.optionId === optionId,
          );
          if (!interaction) {
            issues.push(issue(
              "unknown_experience_hotspot_option",
              `experienceDesign.hotspots.${hotspot.hotspotId}.interactionOptionIds`,
              `体验热点引用未知互动选项：${optionId}`,
            ));
          } else if (
            hotspot.targetActorId
            && interaction.targetActorId !== hotspot.targetActorId
          ) {
            issues.push(issue(
              "experience_hotspot_target_mismatch",
              `experienceDesign.hotspots.${hotspot.hotspotId}.interactionOptionIds`,
              `体验热点与互动目标不一致：${optionId}`,
            ));
          }
        }
      }

      const mappedNodeIds = new Set(
        design.nodeMappings.map((mapping) => mapping.nodeId),
      );
      for (const nodeId of nodeIds) {
        if (!mappedNodeIds.has(nodeId)) {
          issues.push(issue(
            "missing_experience_node_mapping",
            "experienceDesign.nodeMappings",
            `情境节点缺少双维度体验映射：${nodeId}`,
          ));
        }
      }
      for (const mapping of design.nodeMappings) {
        if (!nodeIds.has(mapping.nodeId)) {
          issues.push(issue(
            "unknown_experience_mapping_node",
            `experienceDesign.nodeMappings.${mapping.nodeId}`,
            "双维度体验映射引用未知情境节点",
          ));
        }
        for (const task of mapping.operationTasks) {
          if (taskNodeById.has(task.taskId)) {
            issues.push(issue(
              "duplicate_id",
              "experienceDesign.nodeMappings.operationTasks",
              `课程操作任务标识重复：${task.taskId}`,
            ));
          }
          taskNodeById.set(task.taskId, mapping.nodeId);
          choiceNodeIdsByRef.set(
            task.taskId,
            new Set([
              ...(choiceNodeIdsByRef.get(task.taskId) ?? []),
              mapping.nodeId,
            ]),
          );
          for (const roleId of task.roleIds) {
            if (!studentRoleIds.has(roleId)) {
              issues.push(issue(
                "invalid_experience_task_role",
                `experienceDesign.nodeMappings.${mapping.nodeId}.operationTasks.${task.taskId}`,
                `课程操作任务只能分配给已配置学生岗位：${roleId}`,
              ));
            }
          }
        }
        for (const opportunity of mapping.worldOpportunities) {
          if (opportunityNodeById.has(opportunity.opportunityId)) {
            issues.push(issue(
              "duplicate_id",
              "experienceDesign.nodeMappings.worldOpportunities",
              `世界互动机会标识重复：${opportunity.opportunityId}`,
            ));
          }
          opportunityNodeById.set(opportunity.opportunityId, mapping.nodeId);
          const hotspot = hotspotsById.get(opportunity.hotspotId);
          const scene = design.scenes.find(
            (candidate) => candidate.sceneId === opportunity.sceneId,
          );
          if (
            !sceneIds.has(opportunity.sceneId)
            || !hotspot
            || hotspot.sceneId !== opportunity.sceneId
            || !scene?.nodeIds.includes(mapping.nodeId)
          ) {
            issues.push(issue(
              "invalid_experience_opportunity_location",
              `experienceDesign.nodeMappings.${mapping.nodeId}.worldOpportunities.${opportunity.opportunityId}`,
              "世界互动机会必须引用同一已登记场景中的热点",
            ));
          }
        }
        for (const gap of mapping.npcInformationGaps) {
          if (gapNodeById.has(gap.gapId)) {
            issues.push(issue(
              "duplicate_id",
              "experienceDesign.nodeMappings.npcInformationGaps",
              `NPC信息差标识重复：${gap.gapId}`,
            ));
          }
          gapNodeById.set(gap.gapId, mapping.nodeId);
          if (!npcActorIds.has(gap.npcActorId)) {
            issues.push(issue(
              "unknown_experience_gap_npc",
              `experienceDesign.nodeMappings.${mapping.nodeId}.npcInformationGaps.${gap.gapId}`,
              "NPC信息差引用未知私有NPC实例",
            ));
          }
        }
        for (const contribution of mapping.agentContributions) {
          if (contributionNodeById.has(contribution.contributionId)) {
            issues.push(issue(
              "duplicate_id",
              "experienceDesign.nodeMappings.agentContributions",
              `智能体贡献标识重复：${contribution.contributionId}`,
            ));
          }
          contributionNodeById.set(
            contribution.contributionId,
            mapping.nodeId,
          );
        }
        for (const dynamicEvent of mapping.dynamicEvents) {
          if (dynamicEventNodeById.has(dynamicEvent.dynamicEventId)) {
            issues.push(issue(
              "duplicate_id",
              "experienceDesign.nodeMappings.dynamicEvents",
              `动态事件标识重复：${dynamicEvent.dynamicEventId}`,
            ));
          }
          dynamicEventNodeById.set(
            dynamicEvent.dynamicEventId,
            mapping.nodeId,
          );
          if (
            dynamicEvent.approvalPolicyId
            && !approvalIds.has(dynamicEvent.approvalPolicyId)
          ) {
            issues.push(issue(
              "unknown_experience_event_approval",
              `experienceDesign.nodeMappings.${mapping.nodeId}.dynamicEvents.${dynamicEvent.dynamicEventId}`,
              "动态事件引用未知审批策略",
            ));
          }
        }
        for (const deliverable of mapping.stageDeliverables) {
          if (deliverableNodeById.has(deliverable.deliverableId)) {
            issues.push(issue(
              "duplicate_id",
              "experienceDesign.nodeMappings.stageDeliverables",
              `阶段成果标识重复：${deliverable.deliverableId}`,
            ));
          }
          deliverableNodeById.set(deliverable.deliverableId, mapping.nodeId);
          if (
            deliverable.templateId
            && !scenario.productionConfig?.artifactTemplates.some(
              (template) => template.templateId === deliverable.templateId,
            )
          ) {
            issues.push(issue(
              "unknown_experience_deliverable_template",
              `experienceDesign.nodeMappings.${mapping.nodeId}.stageDeliverables.${deliverable.deliverableId}`,
              `阶段成果引用未知成果模板：${deliverable.templateId}`,
            ));
          }
        }
        for (const evidence of mapping.capabilityEvidence) {
          if (evidenceNodeById.has(evidence.evidenceRequirementId)) {
            issues.push(issue(
              "duplicate_id",
              "experienceDesign.nodeMappings.capabilityEvidence",
              `能力证据标识重复：${evidence.evidenceRequirementId}`,
            ));
          }
          evidenceNodeById.set(
            evidence.evidenceRequirementId,
            mapping.nodeId,
          );
        }
      }

      const knownChoiceRefs = new Set([
        ...taskNodeById.keys(),
        ...optionIds,
      ]);
      const knownEvidenceSourceRefs = new Set([
        ...knownChoiceRefs,
        ...opportunityNodeById.keys(),
        ...gapNodeById.keys(),
        ...contributionNodeById.keys(),
        ...dynamicEventNodeById.keys(),
        ...deliverableNodeById.keys(),
        ...materialIds,
      ]);
      for (const mapping of design.nodeMappings) {
        for (const opportunity of mapping.worldOpportunities) {
          for (const choiceRef of opportunity.choiceRefs) {
            if (!knownChoiceRefs.has(choiceRef)) {
              issues.push(issue(
                "unknown_experience_choice_ref",
                `experienceDesign.nodeMappings.${mapping.nodeId}.worldOpportunities.${opportunity.opportunityId}.choiceRefs`,
                `世界互动机会引用未知学生选择：${choiceRef}`,
              ));
              continue;
            }
            choiceNodeIdsByRef.set(
              choiceRef,
              new Set([
                ...(choiceNodeIdsByRef.get(choiceRef) ?? []),
                mapping.nodeId,
              ]),
            );
            const taskNodeId = taskNodeById.get(choiceRef);
            if (taskNodeId && taskNodeId !== mapping.nodeId) {
              issues.push(issue(
                "experience_opportunity_choice_node_mismatch",
                `experienceDesign.nodeMappings.${mapping.nodeId}.worldOpportunities.${opportunity.opportunityId}.choiceRefs`,
                `世界互动机会引用了其他节点的课程任务：${choiceRef}`,
              ));
            }
            if (
              optionIds.has(choiceRef)
              && !hotspotsById.get(opportunity.hotspotId)
                ?.interactionOptionIds.includes(choiceRef)
            ) {
              issues.push(issue(
                "experience_opportunity_choice_hotspot_mismatch",
                `experienceDesign.nodeMappings.${mapping.nodeId}.worldOpportunities.${opportunity.opportunityId}.choiceRefs`,
                `世界互动机会引用的岗位互动不属于当前热点：${choiceRef}`,
              ));
            }
          }
        }
        for (const dynamicEvent of mapping.dynamicEvents) {
          for (const taskId of dynamicEvent.affectedTaskIds) {
            if (!taskNodeById.has(taskId)) {
              issues.push(issue(
                "unknown_experience_affected_task",
                `experienceDesign.nodeMappings.${mapping.nodeId}.dynamicEvents.${dynamicEvent.dynamicEventId}.affectedTaskIds`,
                `动态事件引用未知课程任务：${taskId}`,
              ));
            }
          }
          if (
            dynamicEvent.triggerKind === "student_action"
            && !knownChoiceRefs.has(dynamicEvent.triggerRef)
          ) {
            issues.push(issue(
              "unknown_experience_student_trigger",
              `experienceDesign.nodeMappings.${mapping.nodeId}.dynamicEvents.${dynamicEvent.dynamicEventId}.triggerRef`,
              "学生行为触发事件必须引用课程任务或岗位互动选项",
            ));
          }
          if (
            dynamicEvent.triggerKind === "agent_candidate"
            && !contributionNodeById.has(dynamicEvent.triggerRef)
          ) {
            issues.push(issue(
              "unknown_experience_agent_trigger",
              `experienceDesign.nodeMappings.${mapping.nodeId}.dynamicEvents.${dynamicEvent.dynamicEventId}.triggerRef`,
              "智能体候选触发事件必须引用已登记的智能体贡献",
            ));
          }
        }
        for (const evidence of mapping.capabilityEvidence) {
          for (const sourceRef of evidence.sourceRefs) {
            if (!knownEvidenceSourceRefs.has(sourceRef)) {
              issues.push(issue(
                "unknown_experience_evidence_source",
                `experienceDesign.nodeMappings.${mapping.nodeId}.capabilityEvidence.${evidence.evidenceRequirementId}.sourceRefs`,
                `能力证据引用未知内容对象：${sourceRef}`,
              ));
            }
          }
        }
      }

      const branchNodeIds = new Set<string>();
      for (const branch of design.causalBranches) {
        branchNodeIds.add(branch.nodeId);
        if (!nodeIds.has(branch.nodeId)) {
          issues.push(issue(
            "unknown_experience_branch_node",
            `experienceDesign.causalBranches.${branch.branchId}.nodeId`,
            "因果分支引用未知情境节点",
          ));
        }
        const studentChoiceNodeIds = choiceNodeIdsByRef.get(
          branch.studentChoiceRef,
        );
        if (!studentChoiceNodeIds) {
          issues.push(issue(
            "unknown_experience_branch_ref",
            `experienceDesign.causalBranches.${branch.branchId}.studentChoiceRef`,
            `因果分支引用未知对象：${branch.studentChoiceRef}`,
          ));
        } else if (!studentChoiceNodeIds.has(branch.nodeId)) {
          issues.push(issue(
            "experience_branch_node_mismatch",
            `experienceDesign.causalBranches.${branch.branchId}.studentChoiceRef`,
            `因果分支对象不属于节点 ${branch.nodeId}：${branch.studentChoiceRef}`,
          ));
        }
        const refs = [
          [
            branch.agentContributionRef,
            contributionNodeById.get(branch.agentContributionRef),
            "agentContributionRef",
          ],
          [
            branch.worldConsequenceRef,
            dynamicEventNodeById.get(branch.worldConsequenceRef),
            "worldConsequenceRef",
          ],
          [
            branch.capabilityEvidenceRef,
            evidenceNodeById.get(branch.capabilityEvidenceRef),
            "capabilityEvidenceRef",
          ],
        ] as const;
        for (const [reference, referenceNodeId, field] of refs) {
          if (!referenceNodeId) {
            issues.push(issue(
              "unknown_experience_branch_ref",
              `experienceDesign.causalBranches.${branch.branchId}.${field}`,
              `因果分支引用未知对象：${reference}`,
            ));
          } else if (referenceNodeId !== branch.nodeId) {
            issues.push(issue(
              "experience_branch_node_mismatch",
              `experienceDesign.causalBranches.${branch.branchId}.${field}`,
              `因果分支对象不属于节点 ${branch.nodeId}：${reference}`,
            ));
          }
        }
      }
      for (const nodeId of nodeIds) {
        if (!branchNodeIds.has(nodeId)) {
          issues.push(issue(
            "missing_experience_causal_branch",
            "experienceDesign.causalBranches",
            `情境节点缺少学生选择—智能体贡献—世界后果—能力证据因果分支：${nodeId}`,
          ));
        }
      }

      if (
        design.fixedEvaluation.rubricId !== scenario.rubricId
        || design.fixedEvaluation.rubricVersion !== scenario.rubricVersion
      ) {
        issues.push(issue(
          "experience_evaluation_mismatch",
          "experienceDesign.fixedEvaluation",
          "固定评价必须引用当前情境包的精确Rubric版本",
        ));
      }
      for (
        const evidenceRequirementId
        of design.fixedEvaluation.evidenceRequirementIds
      ) {
        if (!evidenceNodeById.has(evidenceRequirementId)) {
          issues.push(issue(
            "unknown_experience_evaluation_evidence",
            "experienceDesign.fixedEvaluation.evidenceRequirementIds",
            `固定评价引用未知能力证据：${evidenceRequirementId}`,
          ));
        }
      }
      if (design.kind === "micro_transfer") {
        const hasMaterialTask = design.nodeMappings.some((mapping) => (
          mapping.agentContributions.some((contribution) => (
            contribution.templateId === "assistant/material-understanding"
            || contribution.templateId === "assistant/interview-structuring"
          ))
        ));
        if (!hasMaterialTask) {
          issues.push(issue(
            "transfer_material_task_missing",
            "experienceDesign.nodeMappings.agentContributions",
            "第二微型情境必须包含材料理解或采访结构化任务",
          ));
        }
        const hasStudentIncidentWithGate = design.nodeMappings.some(
          (mapping) => mapping.dynamicEvents.some((dynamicEvent) => (
            dynamicEvent.triggerKind === "student_action"
            && dynamicEvent.approvalPolicyId !== null
          )),
        );
        if (!hasStudentIncidentWithGate) {
          issues.push(issue(
            "transfer_incident_gate_missing",
            "experienceDesign.nodeMappings.dynamicEvents",
            "第二微型情境必须包含由学生行为触发且经过治理或教师门的突发事件",
          ));
        }
      }
    }
    const rubricWeight = scenario.rubric.reduce((total, criterion) => total + criterion.weight, 0);
    if (Math.abs(rubricWeight - 1) > 0.000_001) {
      issues.push(issue("rubric_weight_invalid", "rubric", `评分权重之和必须为 1，当前为 ${rubricWeight}`));
    }
    for (const chunk of scenario.knowledgeChunks) {
      if (chunk.courseId !== scenario.courseId) {
        issues.push(issue("knowledge_course_mismatch", `knowledgeChunks.${chunk.chunkId}.courseId`, "知识切片课程标识与情境不一致"));
      }
      if (chunk.nodeId && !nodeIds.has(chunk.nodeId)) {
        issues.push(issue("unknown_knowledge_node", `knowledgeChunks.${chunk.chunkId}.nodeId`, "知识切片引用未知节点"));
      }
      if (chunk.roleId && !scenario.roles.some((role) => role.roleId === chunk.roleId)) {
        issues.push(issue("unknown_knowledge_role", `knowledgeChunks.${chunk.chunkId}.roleId`, "知识切片引用未配置岗位"));
      }
    }
  }

  const valid = !issues.some((item) => item.severity === "error");
  const validatedAt = input.validatedAt ?? new Date().toISOString();
  const stamp = valid
    ? hashCanonical({
      compilerVersion: ScenarioCompilerVersion,
      definitionHash,
      draftId: input.draftId ?? "detached",
      revision: input.revision ?? 1,
    })
    : null;
  return ScenarioValidationReportSchema.parse({
    draftId: input.draftId ?? "detached",
    revision: input.revision ?? 1,
    definitionHash: parsed.success ? hashScenarioPackage(parsed.data) : definitionHash,
    compilerVersion: ScenarioCompilerVersion,
    valid,
    issues,
    validatedAt,
    validationStamp: stamp,
  });
}

export function assertValidScenarioPackage(rawPackage: unknown): ScenarioPackage {
  const report = validateScenarioPackage(rawPackage);
  if (!report.valid) {
    throw new Error(`情境包校验失败：${report.issues.map((item) => item.message).join("；")}`);
  }
  return ScenarioPackageSchema.parse(rawPackage);
}
