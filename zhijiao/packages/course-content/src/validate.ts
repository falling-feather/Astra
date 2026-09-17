import {
  hashCourseContentRelease,
  hashKnowledgeRecord,
} from "./canonical.js";
import {
  CourseContentSchemaVersion,
  CourseReleaseTargetSchemaVersion,
  KnowledgeRecordSchemaVersion,
  type CourseContentRelease,
  type CourseContentValidationIssue,
  type CourseContentValidationReport,
} from "./types.js";

export interface CourseContentValidationOptions {
  expectedCourseId?: string;
  expectedSectionCount?: number;
  minimumKnowledgeRecordCount?: number;
}

function validPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function addDuplicateIssues(
  values: readonly string[],
  path: string,
  issues: CourseContentValidationIssue[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      issues.push({
        code: "duplicate_id",
        path,
        message: `标识重复：${value}`,
      });
    }
    seen.add(value);
  }
}

function requiredText(
  value: string,
  path: string,
  issues: CourseContentValidationIssue[],
): void {
  if (value.trim().length === 0) {
    issues.push({ code: "required_text", path, message: "字段不能为空" });
  }
}

export function validateCourseContentRelease(
  release: CourseContentRelease,
  options: CourseContentValidationOptions = {},
): CourseContentValidationReport {
  const issues: CourseContentValidationIssue[] = [];
  if (release.schemaVersion !== CourseContentSchemaVersion) {
    issues.push({
      code: "schema_version",
      path: "schemaVersion",
      message: `课程内容版本必须为 ${CourseContentSchemaVersion}`,
    });
  }
  if (release.targetContract !== CourseReleaseTargetSchemaVersion) {
    issues.push({
      code: "target_contract",
      path: "targetContract",
      message: `公共契约目标必须为 ${CourseReleaseTargetSchemaVersion}`,
    });
  }
  if (
    options.expectedCourseId !== undefined
    && release.releaseRef.courseId !== options.expectedCourseId
  ) {
    issues.push({
      code: "course_id",
      path: "releaseRef.courseId",
      message: `课程标识应为 ${options.expectedCourseId}`,
    });
  }
  if (
    options.expectedSectionCount !== undefined
    && release.sections.length !== options.expectedSectionCount
  ) {
    issues.push({
      code: "section_count",
      path: "sections",
      message: `小节数应为 ${options.expectedSectionCount}`,
    });
  }
  if (
    options.minimumKnowledgeRecordCount !== undefined
    && release.knowledgeRecords.length < options.minimumKnowledgeRecordCount
  ) {
    issues.push({
      code: "knowledge_count",
      path: "knowledgeRecords",
      message: `知识记录不得少于 ${options.minimumKnowledgeRecordCount} 条`,
    });
  }

  requiredText(release.title, "title", issues);
  requiredText(release.summary, "summary", issues);
  if (release.primaryJob.learnerRoleId !== "reporter") {
    issues.push({
      code: "learner_role",
      path: "primaryJob.learnerRoleId",
      message: "普通学生只能绑定记者主岗位",
    });
  }
  if (!release.simulationPolicy.hiddenFactsAreFictionalized) {
    issues.push({
      code: "simulation_boundary",
      path: "simulationPolicy.hiddenFactsAreFictionalized",
      message: "隐藏事实必须明确为教学仿真",
    });
  }
  if (release.simulationPolicy.realPersonClaimsAllowed) {
    issues.push({
      code: "real_person_claim",
      path: "simulationPolicy.realPersonClaimsAllowed",
      message: "课程不得把隐藏情境写成真实人物事实",
    });
  }
  if (release.mediaPolicy.repositoryMediaAssets.length > 0) {
    issues.push({
      code: "unlicensed_media",
      path: "mediaPolicy.repositoryMediaAssets",
      message: "课程内容包不得携带未授权图片、音频或视频资产",
    });
  }

  const knowledgeIds = release.knowledgeRecords.map((record) => record.knowledgeId);
  addDuplicateIssues(knowledgeIds, "knowledgeRecords", issues);
  addDuplicateIssues(
    release.knowledgeRecords.map((record) => record.contentHash),
    "knowledgeRecords.*.contentHash",
    issues,
  );
  const knowledgeById = new Map(
    release.knowledgeRecords.map((record) => [record.knowledgeId, record]),
  );
  let qualifiedKnowledgeRecordCount = 0;
  for (const [index, record] of release.knowledgeRecords.entries()) {
    const path = `knowledgeRecords[${index}]`;
    if (record.schemaVersion !== KnowledgeRecordSchemaVersion) {
      issues.push({ code: "knowledge_schema", path: `${path}.schemaVersion`, message: "知识记录 Schema 不匹配" });
    }
    requiredText(record.knowledgeId, `${path}.knowledgeId`, issues);
    requiredText(record.topic, `${path}.topic`, issues);
    requiredText(record.teachingSummary, `${path}.teachingSummary`, issues);
    requiredText(record.source.sourceId, `${path}.source.sourceId`, issues);
    requiredText(record.source.title, `${path}.source.title`, issues);
    requiredText(record.source.publisher, `${path}.source.publisher`, issues);
    requiredText(record.source.locator, `${path}.source.locator`, issues);
    requiredText(record.source.sourceVersion, `${path}.source.sourceVersion`, issues);
    requiredText(record.source.rightsNote, `${path}.source.rightsNote`, issues);
    if (!validPublicUrl(record.source.url)) {
      issues.push({ code: "source_url", path: `${path}.source.url`, message: "来源必须为可解析的 HTTPS URL" });
    }
    if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(record.source.publicationDate)) {
      issues.push({ code: "publication_date", path: `${path}.source.publicationDate`, message: "发布日期必须为 YYYY、YYYY-MM 或 YYYY-MM-DD" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(record.source.accessedAt)) {
      issues.push({ code: "accessed_at", path: `${path}.source.accessedAt`, message: "访问日期必须为 YYYY-MM-DD" });
    }
    if (record.source.storedExcerpt !== null) {
      issues.push({ code: "stored_excerpt", path: `${path}.source.storedExcerpt`, message: "本批次不在仓库存储来源原文摘录" });
    }
    if (record.source.accessStatus !== "reachable_on_check_date") {
      issues.push({ code: "access_status", path: `${path}.source.accessStatus`, message: "来源必须记录为核验日可访问" });
    }
    if (!/不复制|不保存/u.test(record.source.rightsNote)) {
      issues.push({ code: "copyright_note", path: `${path}.source.rightsNote`, message: "版权说明必须明确不复制或不保存来源原文与媒体" });
    }
    if (record.reusePolicy !== "metadata_link_and_paraphrase_only") {
      issues.push({ code: "reuse_policy", path: `${path}.reusePolicy`, message: "来源只允许元数据、链接和改写摘要" });
    }
    if (!/^[a-f0-9]{64}$/u.test(record.contentHash)) {
      issues.push({ code: "knowledge_hash_format", path: `${path}.contentHash`, message: "知识哈希格式错误" });
    } else if (hashKnowledgeRecord(record) !== record.contentHash) {
      issues.push({ code: "knowledge_hash_drift", path: `${path}.contentHash`, message: "知识记录内容哈希漂移" });
    }
    if (
      record.reviewStatus !== "retired"
      && validPublicUrl(record.source.url)
      && record.source.locator.trim().length > 0
      && record.source.sourceVersion.trim().length > 0
    ) {
      qualifiedKnowledgeRecordCount += 1;
    }
  }

  const sectionIds = release.sections.map((section) => section.sectionId);
  addDuplicateIssues(sectionIds, "sections", issues);
  const referencedKnowledgeIds = new Set<string>();
  const globalActionIds: string[] = [];
  const globalEventIds: string[] = [];
  const globalEvidenceIds: string[] = [];
  const globalArtifactIds: string[] = [];
  const globalObjectiveIds: string[] = [];
  const globalHiddenFactIds: string[] = [];
  const globalAgentRuleIds: string[] = [];
  const globalTeacherGateIds: string[] = [];
  let dynamicEventCount = 0;
  for (const [index, section] of release.sections.entries()) {
    const path = `sections[${index}]`;
    requiredText(section.sectionId, `${path}.sectionId`, issues);
    requiredText(section.title, `${path}.title`, issues);
    requiredText(section.typicalWorkTask, `${path}.typicalWorkTask`, issues);
    requiredText(section.taskBrief, `${path}.taskBrief`, issues);
    if (section.order !== index + 1) {
      issues.push({ code: "section_order", path: `${path}.order`, message: "小节顺序必须从 1 连续递增" });
    }
    if (section.objectives.length === 0) {
      issues.push({ code: "objectives_required", path: `${path}.objectives`, message: "每节必须包含学习目标" });
    }
    const objectiveIds = section.objectives.map((objective) => objective.objectiveId);
    addDuplicateIssues(objectiveIds, `${path}.objectives`, issues);
    globalObjectiveIds.push(...objectiveIds);
    for (const [objectiveIndex, objective] of section.objectives.entries()) {
      requiredText(objective.description, `${path}.objectives[${objectiveIndex}].description`, issues);
      requiredText(objective.competencyRef, `${path}.objectives[${objectiveIndex}].competencyRef`, issues);
    }
    if (section.publicSourceKnowledgeIds.length === 0) {
      issues.push({ code: "sources_required", path: `${path}.publicSourceKnowledgeIds`, message: "每节必须引用公开来源" });
    }
    for (const knowledgeId of section.publicSourceKnowledgeIds) {
      referencedKnowledgeIds.add(knowledgeId);
      if (!knowledgeById.has(knowledgeId)) {
        issues.push({ code: "unknown_knowledge", path: `${path}.publicSourceKnowledgeIds`, message: `引用未知知识记录：${knowledgeId}` });
      }
    }
    if (section.hiddenFacts.length === 0) {
      issues.push({ code: "hidden_facts_required", path: `${path}.hiddenFacts`, message: "每节必须包含教学仿真隐藏事实" });
    }
    const hiddenFactIds = section.hiddenFacts.map((fact) => fact.factId);
    addDuplicateIssues(hiddenFactIds, `${path}.hiddenFacts`, issues);
    globalHiddenFactIds.push(...hiddenFactIds);
    if (section.actions.length === 0) {
      issues.push({ code: "actions_required", path: `${path}.actions`, message: "每节必须包含可执行动作" });
    }
    if (section.dynamicEvents.length === 0) {
      issues.push({ code: "dynamic_events_required", path: `${path}.dynamicEvents`, message: "每节必须包含动态事件" });
    }
    if (section.agentSelectionRules.length === 0) {
      issues.push({ code: "agent_rules_required", path: `${path}.agentSelectionRules`, message: "每节必须声明智能体选择规则" });
    }
    if (section.evidenceRequirements.length === 0) {
      issues.push({ code: "evidence_required", path: `${path}.evidenceRequirements`, message: "每节必须声明证据要求" });
    }
    if (section.rubric.length === 0) {
      issues.push({ code: "rubric_required", path: `${path}.rubric`, message: "每节必须声明量规" });
    }
    const rubricWeight = section.rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (rubricWeight !== 100) {
      issues.push({ code: "rubric_weight", path: `${path}.rubric`, message: `量规权重应为 100，当前为 ${rubricWeight}` });
    }

    const actionIds = section.actions.map((action) => action.actionId);
    const evidenceIds = section.evidenceRequirements.map((item) => item.evidenceId);
    addDuplicateIssues(actionIds, `${path}.actions`, issues);
    addDuplicateIssues(evidenceIds, `${path}.evidenceRequirements`, issues);
    globalActionIds.push(...actionIds);
    globalEvidenceIds.push(...evidenceIds);
    globalArtifactIds.push(section.artifact.artifactId);
    const actionIdSet = new Set(actionIds);
    const evidenceIdSet = new Set(evidenceIds);
    if (section.actions.filter((action) => action.primary).length !== 1) {
      issues.push({ code: "primary_action", path: `${path}.actions`, message: "每节必须且只能有一个主要行动" });
    }
    for (const [actionIndex, action] of section.actions.entries()) {
      for (const knowledgeId of action.requiredKnowledgeIds) {
        if (!knowledgeById.has(knowledgeId)) {
          issues.push({ code: "unknown_action_knowledge", path: `${path}.actions[${actionIndex}].requiredKnowledgeIds`, message: `动作引用未知知识记录：${knowledgeId}` });
        }
      }
      for (const evidenceId of action.producesEvidenceIds) {
        if (!evidenceIdSet.has(evidenceId)) {
          issues.push({ code: "unknown_action_evidence", path: `${path}.actions[${actionIndex}].producesEvidenceIds`, message: `动作输出未知证据：${evidenceId}` });
        }
      }
    }
    for (const [factIndex, fact] of section.hiddenFacts.entries()) {
      if (fact.visibility !== "teacher_and_engine") {
        issues.push({ code: "hidden_fact_visibility", path: `${path}.hiddenFacts[${factIndex}].visibility`, message: "隐藏事实只能供教师与引擎使用" });
      }
      if (!fact.summary.startsWith("仿真")) {
        issues.push({ code: "hidden_fact_isolation", path: `${path}.hiddenFacts[${factIndex}].summary`, message: "隐藏事实必须以‘仿真’显式标记，禁止映射为真实案例事实" });
      }
      requiredText(fact.revealCondition, `${path}.hiddenFacts[${factIndex}].revealCondition`, issues);
      for (const evidenceId of fact.requiredEvidenceIds) {
        if (!evidenceIdSet.has(evidenceId)) {
          issues.push({ code: "unknown_hidden_fact_evidence", path: `${path}.hiddenFacts[${factIndex}].requiredEvidenceIds`, message: `隐藏事实引用未知证据：${evidenceId}` });
        }
      }
    }
    for (const [eventIndex, event] of section.dynamicEvents.entries()) {
      dynamicEventCount += 1;
      globalEventIds.push(event.eventId);
      if (event.trigger.kind === "on_action" && !actionIdSet.has(event.trigger.ref)) {
        issues.push({ code: "unknown_event_action", path: `${path}.dynamicEvents[${eventIndex}].trigger.ref`, message: `事件引用未知动作：${event.trigger.ref}` });
      }
      if (event.trigger.kind === "on_evidence_count" && !evidenceIdSet.has(event.trigger.ref)) {
        issues.push({ code: "unknown_event_evidence", path: `${path}.dynamicEvents[${eventIndex}].trigger.ref`, message: `事件引用未知证据：${event.trigger.ref}` });
      }
      for (const agentId of event.affectedAgentIds) {
        if (!event.candidateAgentIds.includes(agentId)) {
          issues.push({ code: "affected_agent_not_candidate", path: `${path}.dynamicEvents[${eventIndex}]`, message: `受影响智能体未进入候选集：${agentId}` });
        }
      }
    }
    for (const [ruleIndex, rule] of section.agentSelectionRules.entries()) {
      globalAgentRuleIds.push(rule.ruleId);
      if (rule.maximumSelectedAgents < 1 || rule.maximumSelectedAgents > rule.candidateAgentIds.length) {
        issues.push({ code: "agent_selection_limit", path: `${path}.agentSelectionRules[${ruleIndex}].maximumSelectedAgents`, message: "选择上限必须位于 1 与候选数之间" });
      }
      for (const agentId of rule.affectedAgentIds) {
        if (!rule.candidateAgentIds.includes(agentId)) {
          issues.push({ code: "affected_agent_not_candidate", path: `${path}.agentSelectionRules[${ruleIndex}]`, message: `受影响智能体未进入候选集：${agentId}` });
        }
      }
    }
    if (
      section.adviceDecisionPolicy.allowedDecisions.join("|")
      !== "accept|request_more_evidence|reject"
      || !section.adviceDecisionPolicy.onlyOneVisibleSuggestionAtATime
    ) {
      issues.push({ code: "advice_decision_policy", path: `${path}.adviceDecisionPolicy`, message: "建议决定必须固定为采纳、补证、拒绝且单条可见" });
    }
    requiredText(section.artifact.label, `${path}.artifact.label`, issues);
    if (section.artifact.completionCriteria.length === 0) {
      issues.push({ code: "artifact_criteria", path: `${path}.artifact.completionCriteria`, message: "阶段成果必须有完成条件" });
    }
    if (!actionIdSet.has(section.teacherGate.rejectReturnsToActionId)) {
      issues.push({ code: "teacher_gate_return", path: `${path}.teacherGate.rejectReturnsToActionId`, message: "教师门退回动作不存在" });
    }
    globalTeacherGateIds.push(section.teacherGate.gateId);
    if (section.teacherGate.checks.length === 0) {
      issues.push({ code: "teacher_gate_checks", path: `${path}.teacherGate.checks`, message: "教师门必须有检查项" });
    }
    requiredText(section.migrationReflection.prompt, `${path}.migrationReflection.prompt`, issues);
    if (section.migrationReflection.requiredComparisonDimensions.length === 0) {
      issues.push({ code: "migration_dimensions", path: `${path}.migrationReflection.requiredComparisonDimensions`, message: "迁移反思必须声明比较维度" });
    }
  }
  addDuplicateIssues(globalActionIds, "sections.*.actions", issues);
  addDuplicateIssues(globalEventIds, "sections.*.dynamicEvents", issues);
  addDuplicateIssues(globalEvidenceIds, "sections.*.evidenceRequirements", issues);
  addDuplicateIssues(globalArtifactIds, "sections.*.artifact", issues);
  addDuplicateIssues(globalObjectiveIds, "sections.*.objectives", issues);
  addDuplicateIssues(globalHiddenFactIds, "sections.*.hiddenFacts", issues);
  addDuplicateIssues(globalAgentRuleIds, "sections.*.agentSelectionRules", issues);
  addDuplicateIssues(globalTeacherGateIds, "sections.*.teacherGate", issues);
  if (dynamicEventCount < 2) {
    issues.push({ code: "course_dynamic_event_count", path: "sections", message: "每门课至少包含两次动态事件" });
  }
  if (release.sections.filter((section) => section.artifact.finalCourseArtifact).length !== 1) {
    issues.push({ code: "final_artifact", path: "sections.*.artifact.finalCourseArtifact", message: "课程必须且只能有一个最终作品" });
  }
  for (const record of release.knowledgeRecords) {
    if (!referencedKnowledgeIds.has(record.knowledgeId)) {
      issues.push({ code: "orphan_knowledge", path: "knowledgeRecords", message: `知识记录未被任何小节使用：${record.knowledgeId}` });
    }
    for (const sectionId of record.applicableSectionIds) {
      if (!sectionIds.includes(sectionId)) {
        issues.push({ code: "unknown_applicable_section", path: `knowledgeRecords.${record.knowledgeId}.applicableSectionIds`, message: `知识记录引用未知小节：${sectionId}` });
      }
    }
  }
  const serialized = JSON.stringify(release);
  if (/file:\/\//iu.test(serialized) || /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm|mp3|wav)(?:[?"#]|$)/iu.test(serialized)) {
    issues.push({ code: "embedded_media_reference", path: "$", message: "课程内容不得嵌入本地或远程图片、音频、视频资产引用" });
  }
  if (!/^[a-f0-9]{64}$/u.test(release.releaseRef.contentHash)) {
    issues.push({ code: "course_hash_format", path: "releaseRef.contentHash", message: "课程内容哈希格式错误" });
  } else if (hashCourseContentRelease(release) !== release.releaseRef.contentHash) {
    issues.push({ code: "course_hash_drift", path: "releaseRef.contentHash", message: "课程内容哈希漂移" });
  }

  return {
    valid: issues.length === 0,
    sectionCount: release.sections.length,
    knowledgeRecordCount: release.knowledgeRecords.length,
    qualifiedKnowledgeRecordCount,
    referencedKnowledgeRecordCount: referencedKnowledgeIds.size,
    dynamicEventCount,
    issues,
  };
}
