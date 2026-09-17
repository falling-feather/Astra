import {
  StrategyReuseExplanationSchema,
  StrategyReuseExplanationSchemaVersion,
  type StrategyReuseAppliedExplanation,
  type StrategyReuseErrorExplanation,
  type StrategyReuseNotAppliedExplanation,
} from "../src/strategy-reuse.js";

const strategyRef = {
  strategyId: "strategy-rain-collaboration",
  version: 1,
  contentHash: "a".repeat(64),
};

const shared = {
  schemaVersion: StrategyReuseExplanationSchemaVersion,
  sessionId: "session-collaboration",
  scenarioId: "scenario-local-tourism-media-v0.1",
  routeId: "route-rain-escalation",
  sourceEventId: "flagship-event-rain-escalation",
  currentEventId: "flagship-event-rain-followup",
  taskId: "flagship-task-rain-collaboration",
  stateVersion: 48,
  generatedAt: "2026-07-31T01:00:00.000Z",
} as const;

export function strategyReuseExplanationFixture(): StrategyReuseAppliedExplanation {
  return StrategyReuseExplanationSchema.parse({
    ...shared,
    status: "reused",
    reasonCode: "approved_match",
    strategyRef,
    strategyStatus: "approved",
    applicability: {
      reason: "目标事件仍位于旗舰暴雨路线和同一任务锚点，且既有因果引用完整。",
      notApplicableWhen: [
        "策略不再是唯一 approved 版本时不复用。",
        "缺少既有协作回放或因果引用时不复用。",
      ],
      currentDifferences: [
        "原事件是首次突发暴雨升级，本次是后续降雨预警。",
        "本次材料更新时间更晚，需要重新核验来源时效。",
      ],
    },
    actualPath: {
      source: "collaboration_replay",
      occurred: true,
      summary: "既有回放显示学生先采纳证据核验建议，再由教师复核并完成任务与证据写回。",
      eventIds: [
        "flagship-event-rain-escalation",
        "event-agent-contribution",
        "action-rain-collaboration",
        "event-teacher-review",
        "consequence-rain-priority-updated",
      ],
      taskIds: [
        "flagship-task-rain-collaboration",
        "task-agent-evidence",
      ],
      evidenceIds: ["evidence-rain-source-check"],
      consequences: [
        "交付顺序调整为先核验来源，再继续双岗协作。",
      ],
    },
    alternativePath: {
      occurred: false,
      writesWorldEvents: false,
      writesTasks: false,
      writesEvidence: false,
      summary: "如果学生没有先采纳证据核验建议，可能维持原交付顺序。",
      possibleConsequences: [
        "交付速度可能暂时更快，但来源风险会在后续集中暴露。",
      ],
    },
  }) as StrategyReuseAppliedExplanation;
}

export function strategyReuseNoMatchFixture(): StrategyReuseNotAppliedExplanation {
  return StrategyReuseExplanationSchema.parse({
    ...shared,
    status: "not_reused",
    reasonCode: "no_match",
    strategyRef: null,
    strategyStatus: null,
    applicability: {
      reason: "不复用：当前没有满足治理与因果约束的 approved 协作策略。",
      notApplicableWhen: [
        "没有唯一 approved 策略时不复用。",
      ],
      currentDifferences: [],
    },
    actualPath: null,
    alternativePath: null,
  }) as StrategyReuseNotAppliedExplanation;
}

export function strategyReuseDriftFixture(): StrategyReuseErrorExplanation {
  return StrategyReuseExplanationSchema.parse({
    ...shared,
    status: "error",
    reasonCode: "version_hash_drift",
    strategyRef,
    strategyStatus: null,
    applicability: {
      reason: "策略版本或内容哈希与冻结引用不一致，复用失败关闭。",
      notApplicableWhen: [
        "冻结版本或内容哈希发生漂移时不复用。",
      ],
      currentDifferences: [],
    },
    actualPath: null,
    alternativePath: null,
  }) as StrategyReuseErrorExplanation;
}
