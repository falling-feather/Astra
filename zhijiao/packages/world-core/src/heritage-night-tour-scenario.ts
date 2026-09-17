import {
  ScenarioPackageSchema,
  type ScenarioPackage,
} from "@ronggang/contracts";
import {
  hashContent,
} from "@ronggang/context-engine";
import { transferScenarioV100 } from "./scenario-experience.js";

const scenarioId = "scenario-heritage-night-tour-capacity-v1";
const courseId = "course-converged-media-heritage-night-tour";

const replacements: ReadonlyArray<readonly [string, string]> = [
  ["scenario-rain-closure-briefing-v1", scenarioId],
  ["course-converged-media-transfer", courseId],
  ["transfer-rain-closure", "transfer-heritage-night-tour-capacity"],
  ["rain-closure", "heritage-night-tour-capacity"],
  ["rain-warning", "capacity-threshold"],
  ["shelter-map", "flow-route-map"],
  ["shelter", "flow-route"],
  ["emergency-journalism", "visitor-capacity-journalism"],
  ["emergency", "visitor-capacity"],
  ["古镇暴雨闭园应急融媒通报", "非遗夜游承载量与错峰融媒通报"],
  ["古镇暴雨闭园通报", "非遗夜游承载量与错峰通报"],
  ["属地气象与应急部门", "景区预约与文旅运营调度台"],
  ["橙色暴雨预警", "夜游预约接近承载上限提示"],
  ["最终恢复开放时间", "下一批次放行时段"],
  ["恢复开放时间", "下一批次放行时段"],
  ["最终恢复时间", "下一批次放行时段"],
  ["恢复时间", "下一批次放行时段"],
  ["临时安置点", "错峰候场点"],
  ["临时安置", "错峰候场"],
  ["伤情统计", "分时客流余量"],
  ["未确认伤情", "未确认客流余量"],
  ["伤情", "实时客流余量"],
  ["游客转移", "游客分流"],
  ["景区值班员", "夜游运营员"],
  ["古镇景区值班台", "非遗夜游运营台"],
  ["闭园疏散", "限流分流"],
  ["暴雨闭园", "夜游限流"],
  ["闭园", "限流"],
  ["疏散", "分流"],
  ["暴雨", "夜游客流高峰"],
  ["橙色预警", "承载上限提示"],
  ["预警", "承载提示"],
  ["应急部门", "文旅运营调度台"],
  ["应急", "承载量治理"],
  ["北门", "东牌坊入口"],
  ["游客中心", "非遗工坊等候区"],
  ["东侧停车区", "河畔换乘区"],
  ["古镇", "非遗街区"],
  ["值班员", "运营员"],
];

function rewriteString(value: string): string {
  return replacements.reduce(
    (current, [source, target]) => current.replaceAll(source, target),
    value,
  );
}

function rewriteValue<T>(value: T): T {
  if (typeof value === "string") return rewriteString(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => rewriteValue(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteValue(item),
      ]),
    ) as T;
  }
  return value;
}

const targetDraft = rewriteValue<ScenarioPackage>(
  structuredClone(transferScenarioV100),
);
targetDraft.scenarioId = scenarioId;
targetDraft.courseId = courseId;
targetDraft.version = "1.0.0";
targetDraft.title = "非遗夜游承载量与错峰融媒通报";
targetDraft.description =
  "两个学生岗位在三个连续节点中采访夜游运营员与平台值守，核定预约承载量、入口分流和下一批次放行边界，经教师门形成固定终评。";
targetDraft.startVirtualTime = "18:40";
targetDraft.durationMinutes = 20;

targetDraft.bootstrap.initialFacts[0]!.statement =
  "预约系统显示19:00—20:00时段已达到核定承载量的92%，运营台启动东牌坊入口分流与错峰候场；正式放行频次仍待调度核定。";
targetDraft.bootstrap.initialFacts[1]!.statement =
  "当前尚无经文旅运营调度台确认的各入口实时余量和下一批次放行时段。";
targetDraft.bootstrap.openingMessages[0]!.displayName = "夜游运营员·顾岚";
targetDraft.bootstrap.openingMessages[0]!.content =
  "我能说明东牌坊入口排队、游客分流和非遗工坊候场情况；各入口余量与放行时段请向运营调度台核定。";
targetDraft.bootstrap.openingMessages[1]!.content =
  "错峰通报必须固定时段、入口、候场路线、数据来源和未确认余量，版本冻结后才能申请人工复核。";
targetDraft.bootstrap.memorySeeds[0]!.content =
  "18:38东牌坊入口开始分流，游客被引导至非遗工坊等候区和河畔换乘区；尚未收到各入口实时余量确认。";
targetDraft.bootstrap.memorySeeds[1]!.content =
  "人工复核要求精确版本号、预约承载数据、分流路线和未确认余量标记。";

const sourceMapping = targetDraft.experienceDesign?.nodeMappings.find(
  (mapping) => mapping.nodeId === "source",
);
if (sourceMapping) {
  sourceMapping.dynamicEvents[0]!.eventType = "node_activated";
  sourceMapping.dynamicEvents[0]!.triggerRef =
    sourceMapping.operationTasks[0]!.taskId;
  sourceMapping.dynamicEvents[0]!.approvalPolicyId = null;
}
const releaseMapping = targetDraft.experienceDesign?.nodeMappings.find(
  (mapping) => mapping.nodeId === "release",
);
if (releaseMapping) {
  releaseMapping.dynamicEvents[0]!.triggerRef =
    releaseMapping.operationTasks[0]!.taskId;
}

targetDraft.knowledgeChunks = targetDraft.knowledgeChunks.map((chunk) => ({
  ...chunk,
  courseId,
  contentHash: hashContent(chunk.content),
}));

export const heritageNightTourScenarioV100 =
  ScenarioPackageSchema.parse(targetDraft);

export const heritageNightTourScenarioV100ContentHash =
  "9e3068e126b8df944af7152f0d76dfba7374860335802442e9c161c4a284074d";
