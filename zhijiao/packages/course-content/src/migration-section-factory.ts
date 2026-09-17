import type {
  MigrationActionBlueprint,
  MigrationRubricBlueprint,
  MigrationSectionBlueprint,
} from "./migration-course-builder.js";
import type { CourseSection } from "./types.js";

export interface CompactMigrationAction
  extends Omit<MigrationActionBlueprint, "evidenceKeys"> {
  evidenceKey: "source" | "decision" | "output";
}

export interface CompactMigrationSection
  extends Omit<
    MigrationSectionBlueprint,
    "actions" | "hiddenFacts" | "evidence" | "rubric" | "teacherGate"
  > {
  hiddenFacts: readonly {
    key: string;
    summary: string;
    revealCondition: string;
    evidenceKeys?: readonly ("source" | "decision" | "output")[];
  }[];
  actions: readonly [
    CompactMigrationAction,
    CompactMigrationAction,
    CompactMigrationAction,
  ];
  evidenceFocus: {
    source: string;
    decision: string;
    output: string;
  };
  rubricFocus: {
    accuracy: string;
    reasoning: string;
    deliverable: string;
    transfer: string;
    failClosedWhen: string;
  };
  teacherGate: {
    label: string;
    trigger: CourseSection["teacherGate"]["trigger"];
    checks: readonly string[];
    minimumEvidenceCount: number;
    rejectReturnsToActionKey: string;
  };
}

function rubric(
  key: string,
  label: string,
  weight: number,
  observable: string,
  failClosedWhen: string,
): MigrationRubricBlueprint {
  return { key, label, weight, observable, failClosedWhen };
}

/**
 * Expands compact editorial specifications into a complete, machine-checkable
 * section. The three evidence lanes intentionally mirror the learner journey:
 * verify sources, record the human/agent decision, then submit the artifact.
 */
export function defineMigrationSection(
  seed: CompactMigrationSection,
): MigrationSectionBlueprint {
  return {
    ...seed,
    hiddenFacts: seed.hiddenFacts.map((fact) => ({
      ...fact,
      evidenceKeys: fact.evidenceKeys ?? ["source", "decision"],
    })),
    actions: [
      { ...seed.actions[0], evidenceKeys: [seed.actions[0].evidenceKey] },
      { ...seed.actions[1], evidenceKeys: [seed.actions[1].evidenceKey] },
      { ...seed.actions[2], evidenceKeys: [seed.actions[2].evidenceKey] },
    ],
    evidence: [
      {
        key: "source",
        label: `${seed.title}来源核验记录`,
        description: seed.evidenceFocus.source,
        minimumCount: 1,
        acceptedSourceKinds: ["public_source", "field_observation", "interview_note"],
      },
      {
        key: "decision",
        label: `${seed.title}建议决定记录`,
        description: seed.evidenceFocus.decision,
        minimumCount: 1,
        acceptedSourceKinds: ["agent_decision", "artifact_revision", "teacher_decision"],
      },
      {
        key: "output",
        label: `${seed.title}成果版本`,
        description: seed.evidenceFocus.output,
        minimumCount: 1,
        acceptedSourceKinds: ["artifact_revision", "authorization_record", "teacher_decision"],
      },
    ],
    rubric: [
      rubric(
        "accuracy",
        "事实与来源准确性",
        30,
        seed.rubricFocus.accuracy,
        seed.rubricFocus.failClosedWhen,
      ),
      rubric(
        "reasoning",
        "协作决定与依据",
        25,
        seed.rubricFocus.reasoning,
        "未记录采纳、补证或拒绝及其依据",
      ),
      rubric(
        "deliverable",
        "岗位成果可用性",
        30,
        seed.rubricFocus.deliverable,
        "成果缺少任务要求的关键字段或不可执行",
      ),
      rubric(
        "transfer",
        "迁移反思质量",
        15,
        seed.rubricFocus.transfer,
        "未比较新情境中的事实、平台或风险差异",
      ),
    ],
    teacherGate: seed.teacherGate,
  };
}
