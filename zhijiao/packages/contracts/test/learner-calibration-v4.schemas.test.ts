import { describe, expect, it } from "vitest";
import {
  LearnerCalibrationObservationWindowPlanV4Schema,
  LearnerCalibrationResultV4Schema,
} from "../src/index.js";

const plan = {
  policyVersion: "learner-calibration-v4/task-outcome-v1",
  startVirtualMinute: 0,
  endVirtualMinute: 45,
  minimumCommittedWorldEvents: 3,
} as const;

describe("learner calibration V4 contracts", () => {
  it("freezes a task-outcome observation window and rejects reversed bounds", () => {
    expect(LearnerCalibrationObservationWindowPlanV4Schema.parse(plan)).toEqual(plan);
    expect(() => LearnerCalibrationObservationWindowPlanV4Schema.parse({
      ...plan,
      startVirtualMinute: 46,
    })).toThrow(/观察窗口/u);
  });

  it("stores a non-scoring final outcome with traceable evidence and unmet requirements", () => {
    const result = LearnerCalibrationResultV4Schema.parse({
      policyVersion: plan.policyVersion,
      outcome: "failure",
      observedBehaviorAlignment: 0.4,
      observationWindow: {
        policyVersion: plan.policyVersion,
        startVirtualMinute: 0,
        endVirtualMinute: 45,
        startWorldStateVersion: 0,
        endWorldStateVersion: 2,
        closedBy: "window_elapsed",
      },
      evidence: {
        committedWorldEventRefs: ["event-1"],
        studentActionRefs: ["action-1"],
        consequenceRefs: ["consequence-1"],
        variableRefs: ["public_safety_risk"],
        factRefs: [],
        workRefs: [],
        teacherGateRefs: [],
      },
      completionBasis: ["冻结观察窗口已结束。"],
      unmetRequirements: ["尚未形成真实作品版本。"],
    });
    expect(result.outcome).toBe("failure");
    expect(result.evidence.studentActionRefs).toEqual(["action-1"]);
  });
});
