import type {
  FlagshipRuntimeActionConditionV4,
  FlagshipRuntimeActionPolicyV4,
} from "@ronggang/contracts";
import type { SimulationSessionRecord } from "./simulation-v3-types.js";

export type FlagshipActionPolicyEvaluationStatusV4 =
  | "allowed"
  | "blocked"
  | "legacy"
  | "missing_rule";

export interface FlagshipActionPolicyEvaluationV4 {
  readonly status: FlagshipActionPolicyEvaluationStatusV4;
  readonly allowed: boolean;
  readonly eventTemplateId: string;
  readonly reasons: readonly string[];
}

type PolicyRecord = Pick<
  SimulationSessionRecord,
  "queue" | "currentSnapshot"
>;

function compare(
  actual: number,
  operator: "gte" | "lte" | "eq",
  expected: number,
): boolean {
  switch (operator) {
    case "gte":
      return actual >= expected;
    case "lte":
      return actual <= expected;
    case "eq":
      return Math.abs(actual - expected) <= 0.000_001;
  }
}

function conditionMatches(
  condition: FlagshipRuntimeActionConditionV4,
  record: PolicyRecord,
): boolean {
  const snapshot = record.currentSnapshot;
  switch (condition.kind) {
    case "event_status":
      return record.queue.some((event) => (
        event.eventType === condition.eventType
        && condition.statuses.includes(event.status)
      ));
    case "entity_status":
      return snapshot.entities.some((entity) => (
        entity.entityId === condition.entityId
        && condition.statuses.includes(entity.status)
      ));
    case "fact_status":
      return snapshot.facts.some((fact) => (
        fact.factId === condition.factId
        && condition.statuses.includes(fact.status)
      ));
    case "variable_threshold": {
      const variable = snapshot.variables.find((item) => (
        item.variableId === condition.variableId
      ));
      return variable !== undefined
        && compare(variable.after, condition.operator, condition.value);
    }
    case "resource_threshold": {
      const resource = snapshot.resources.find((item) => (
        item.resourceId === condition.resourceId
      ));
      return resource !== undefined
        && compare(resource.amount, condition.operator, condition.value);
    }
    case "time_threshold": {
      const actual = condition.metric === "elapsed_minutes"
        ? snapshot.virtualTime.elapsedMinutes
        : snapshot.virtualTime.remainingMinutes;
      return compare(actual, condition.operator, condition.value);
    }
  }
}

function conditionDescription(
  condition: FlagshipRuntimeActionConditionV4,
): string {
  switch (condition.kind) {
    case "event_status":
      return `需要事件 ${condition.eventType} 处于${condition.statuses.join("/")}状态`;
    case "entity_status":
      return `需要人物 ${condition.entityId} 处于${condition.statuses.join("/")}状态`;
    case "fact_status":
      return `需要事实 ${condition.factId} 处于${condition.statuses.join("/")}状态`;
    case "variable_threshold":
      return `需要变量 ${condition.variableId} ${condition.operator} ${condition.value}`;
    case "resource_threshold":
      return `需要资源 ${condition.resourceId} ${condition.operator} ${condition.value}`;
    case "time_threshold":
      return `需要${condition.metric === "elapsed_minutes" ? "已用" : "剩余"}时间 ${condition.operator} ${condition.value} 分钟`;
  }
}

function failedConditions(
  conditions: readonly FlagshipRuntimeActionConditionV4[],
  record: PolicyRecord,
): string[] {
  return conditions
    .filter((condition) => !conditionMatches(condition, record))
    .map(conditionDescription);
}

export function evaluateFlagshipRuntimeActionPolicyV4(
  policy: FlagshipRuntimeActionPolicyV4 | null | undefined,
  eventTemplateId: string,
  record: PolicyRecord,
): FlagshipActionPolicyEvaluationV4 {
  if (!policy) {
    return {
      status: "legacy",
      allowed: true,
      eventTemplateId,
      reasons: ["旧发布未声明 actionPolicy，沿用旧事件校验"],
    };
  }

  const rule = policy.actions.find((candidate) => (
    candidate.eventTemplateId === eventTemplateId
  ));
  if (!rule) {
    return {
      status: "missing_rule",
      allowed: false,
      eventTemplateId,
      reasons: [`当前发布的动作策略未声明事件模板：${eventTemplateId}`],
    };
  }

  const allFailures = failedConditions(rule.requirements.all, record);
  const anyMatched = rule.requirements.any.length === 0
    || rule.requirements.any.some((condition) => conditionMatches(condition, record));
  const noneFailures = rule.requirements.none.filter((condition) => (
    conditionMatches(condition, record)
  ));
  if (allFailures.length === 0 && anyMatched && noneFailures.length === 0) {
    return {
      status: "allowed",
      allowed: true,
      eventTemplateId,
      reasons: [],
    };
  }

  const reasons = [
    ...allFailures,
    ...(anyMatched
      ? []
      : [`至少满足一个条件：${rule.requirements.any.map(conditionDescription).join("；")}`]),
    ...noneFailures.map((condition) => `禁止条件已满足：${conditionDescription(condition)}`),
    rule.unavailableReason,
  ];
  return {
    status: "blocked",
    allowed: false,
    eventTemplateId,
    reasons: [...new Set(reasons.filter((reason) => reason.length > 0))],
  };
}
