import {
  ScenarioPackageSchema,
  type ScenarioPackage,
} from "@ronggang/contracts";
import { canonicalJson } from "./canonical.js";

export const TransferReuseMethod =
  "canonical-json-pointer-leaf-equality/target-pointer-universe" as const;

export interface TransferReuseReport {
  method: typeof TransferReuseMethod;
  reusedLeafCount: number;
  comparableLeafCount: number;
  ratio: number;
  changedJsonPointers: string[];
  reusedJsonPointers: string[];
}

export interface TransferStructureReport {
  status: "passed" | "failed";
  studentRoleCount: number;
  privateNpcCount: number;
  nodeCount: number;
  hasStructuredMaterialTask: boolean;
  hasStudentTriggeredEvent: boolean;
  hasTeacherGate: boolean;
  hasFixedEvaluation: boolean;
}

export interface TransferScenarioInspection {
  reuse: TransferReuseReport;
  structure: TransferStructureReport;
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectLeaves(
  value: unknown,
  pointer: string,
  leaves: Map<string, unknown>,
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      leaves.set(pointer || "/", []);
      return;
    }
    value.forEach((item, index) => {
      collectLeaves(item, `${pointer}/${index}`, leaves);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    if (entries.length === 0) {
      leaves.set(pointer || "/", {});
      return;
    }
    for (const [key, item] of entries) {
      collectLeaves(
        item,
        `${pointer}/${escapeJsonPointerSegment(key)}`,
        leaves,
      );
    }
    return;
  }
  leaves.set(pointer || "/", value);
}

export function compareTransferScenarioReuse(input: {
  template: ScenarioPackage;
  target: ScenarioPackage;
}): TransferReuseReport {
  const template = ScenarioPackageSchema.parse(input.template);
  const target = ScenarioPackageSchema.parse(input.target);
  const templateLeaves = new Map<string, unknown>();
  const targetLeaves = new Map<string, unknown>();
  collectLeaves(template, "", templateLeaves);
  collectLeaves(target, "", targetLeaves);

  const reusedJsonPointers: string[] = [];
  const changedJsonPointers: string[] = [];
  for (const [pointer, value] of [...targetLeaves.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const sourceValue = templateLeaves.get(pointer);
    if (
      templateLeaves.has(pointer)
      && canonicalJson(sourceValue) === canonicalJson(value)
    ) {
      reusedJsonPointers.push(pointer);
    } else {
      changedJsonPointers.push(pointer);
    }
  }
  const comparableLeafCount = targetLeaves.size;
  if (comparableLeafCount === 0) {
    throw new Error("迁移情境必须至少包含一个可比较配置叶子");
  }
  return {
    method: TransferReuseMethod,
    reusedLeafCount: reusedJsonPointers.length,
    comparableLeafCount,
    ratio: reusedJsonPointers.length / comparableLeafCount,
    changedJsonPointers,
    reusedJsonPointers,
  };
}

export function inspectTransferScenarioStructure(
  rawScenario: ScenarioPackage,
): TransferStructureReport {
  const scenario = ScenarioPackageSchema.parse(rawScenario);
  const studentRoleCount = scenario.roles.filter(
    (role) => role.actorKind === "student",
  ).length;
  const privateNpcCount = new Set(
    scenario.experienceDesign?.npcInstances
      .filter((npc) => npc.privatePerspective)
      .map((npc) => npc.actorId)
      ?? scenario.bootstrap.openingMessages
        .filter((message) => message.visibility.includes("role_private"))
        .map((message) => message.actorId),
  ).size;
  const nodeMappings = scenario.experienceDesign?.nodeMappings ?? [];
  const hasStructuredMaterialTask = nodeMappings.some((mapping) =>
    mapping.agentContributions.some((contribution) =>
      contribution.templateId === "assistant/material-understanding"
      || contribution.templateId === "assistant/interview-structuring"
    )
  );
  const hasStudentTriggeredEvent = nodeMappings.some((mapping) =>
    mapping.dynamicEvents.some(
      (event) => event.triggerKind === "student_action",
    )
  );
  const teacherApprovalPolicyIds = new Set(
    scenario.approvalPolicies
      .filter((policy) => policy.reviewMode === "teacher_required")
      .map((policy) => policy.approvalPolicyId),
  );
  const hasTeacherGate = scenario.eventPolicies.some((policy) =>
    teacherApprovalPolicyIds.has(policy.approvalPolicyId)
  );
  const hasFixedEvaluation = Boolean(
    scenario.experienceDesign?.fixedEvaluation.teacherFinalRequired
    && scenario.rubric.length > 0,
  );
  const nodeCount = scenario.nodes.length;
  const status = (
    studentRoleCount >= 2
    && privateNpcCount >= 2
    && nodeCount >= 3
    && hasStructuredMaterialTask
    && hasStudentTriggeredEvent
    && hasTeacherGate
    && hasFixedEvaluation
  )
    ? "passed"
    : "failed";

  return {
    status,
    studentRoleCount,
    privateNpcCount,
    nodeCount,
    hasStructuredMaterialTask,
    hasStudentTriggeredEvent,
    hasTeacherGate,
    hasFixedEvaluation,
  };
}

export function inspectTransferScenario(input: {
  template: ScenarioPackage;
  target: ScenarioPackage;
}): TransferScenarioInspection {
  const template = ScenarioPackageSchema.parse(input.template);
  const target = ScenarioPackageSchema.parse(input.target);
  if (target.scenarioId === template.scenarioId) {
    throw new Error("前瞻迁移目标必须使用全新scenarioId");
  }
  if (target.title === template.title) {
    throw new Error("前瞻迁移目标必须形成与模板不同的主题标题");
  }
  return {
    reuse: compareTransferScenarioReuse({ template, target }),
    structure: inspectTransferScenarioStructure(target),
  };
}
