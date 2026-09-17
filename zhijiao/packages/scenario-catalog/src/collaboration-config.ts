import {
  CollaborationStrategySchema,
  ScenarioCollaborationFlagshipScenarioId,
  type CollaborationStrategy,
  type ScenarioCollaborationConfig,
  type ScenarioValidationIssue,
} from "@ronggang/contracts";

function error(
  code: string,
  path: string,
  message: string,
): ScenarioValidationIssue {
  return {
    code,
    severity: "error",
    path,
    message,
  };
}

export interface ScenarioCollaborationConfigValidationInput {
  config: ScenarioCollaborationConfig | undefined;
  scenarioId: string;
  /**
   * Server-owned snapshot returned by CollaborationStrategyService.list().
   * Request bodies must never supply this collection.
   */
  strategySnapshot?: readonly CollaborationStrategy[];
  required?: boolean;
}

export function validateScenarioCollaborationConfig(
  input: ScenarioCollaborationConfigValidationInput,
): ScenarioValidationIssue[] {
  if (!input.config) {
    return input.required
      ? [error(
        "collaboration_config_required",
        "collaborationConfig",
        "从旗舰情境 1.1.1 复制的草稿必须配置固定暴雨事件、三个 active 智能体和 approved 协作策略",
      )]
      : [];
  }
  if (input.scenarioId !== ScenarioCollaborationFlagshipScenarioId) {
    return [error(
      "collaboration_config_non_flagship_scenario",
      "collaborationConfig",
      "旗舰事件协作配置只能用于固定的本地文旅融媒体旗舰情境",
    )];
  }

  const reference = input.config.strategyRef;
  const rawStrategy = input.strategySnapshot?.find((candidate) => (
    candidate.strategyId === reference.strategyId
    && candidate.version === reference.version
  ));
  if (!rawStrategy) {
    return [error(
      "collaboration_strategy_missing",
      "collaborationConfig.strategyRef",
      `协作策略不存在：${reference.strategyId}@${reference.version}`,
    )];
  }

  const parsed = CollaborationStrategySchema.safeParse(rawStrategy);
  if (!parsed.success) {
    return [error(
      "collaboration_strategy_invalid",
      "collaborationConfig.strategyRef",
      `协作策略快照不符合冻结契约：${reference.strategyId}@${reference.version}`,
    )];
  }
  const strategy = parsed.data;

  if (strategy.contentHash !== reference.contentHash) {
    return [error(
      "collaboration_strategy_hash_drift",
      "collaborationConfig.strategyRef.contentHash",
      `协作策略内容哈希已漂移：${reference.strategyId}@${reference.version}`,
    )];
  }

  if (strategy.governance.status !== "approved") {
    return [error(
      "collaboration_strategy_not_approved",
      "collaborationConfig.strategyRef",
      `协作策略当前状态为 ${strategy.governance.status}，只有 approved 版本可以校验和发布`,
    )];
  }

  if (
    strategy.content.eventConditions.routeId !== input.config.routeId
    || strategy.content.eventConditions.triggerEventId !== input.config.eventId
  ) {
    return [error(
      "collaboration_strategy_event_mismatch",
      "collaborationConfig.strategyRef",
      "approved 协作策略的代表性路线或事件与情境配置不一致",
    )];
  }

  const approvedForTrigger = (input.strategySnapshot ?? []).flatMap(
    (candidate) => {
      const parsedCandidate = CollaborationStrategySchema.safeParse(candidate);
      return parsedCandidate.success
        && parsedCandidate.data.governance.status === "approved"
        && parsedCandidate.data.content.eventConditions.triggerEventId
          === input.config!.eventId
        ? [parsedCandidate.data]
        : [];
    },
  );
  if (
    approvedForTrigger.length !== 1
    || approvedForTrigger[0]?.strategyId !== reference.strategyId
    || approvedForTrigger[0]?.version !== reference.version
    || approvedForTrigger[0]?.contentHash !== reference.contentHash
  ) {
    return [error(
      "collaboration_strategy_approved_ambiguous",
      "collaborationConfig.strategyRef",
      "同一代表性事件必须且只能有一个与冻结引用完全一致的 approved 协作策略",
    )];
  }

  return [];
}
