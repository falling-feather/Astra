import { expect, it } from "vitest";
import { LearnerCalibrationFieldPolicyVersionV4 } from "@ronggang/contracts";
import { xunpuExplorationLesson } from "@ronggang/course-content";
import { createV3WorldTestRuntime } from "./world-simulation-v3.fixture.js";
import { calibrationWindowPlanForVariantV4, evaluateLearnerCalibrationV4 } from "../src/learner-calibration-v4.js";

it("waits for the frozen field window and does not report success from visits without submitted work", async () => {
  const sessionId = "field-calibration-window";
  const { engine } = await createV3WorldTestRuntime(sessionId);
  engine.registerFieldLesson(xunpuExplorationLesson);
  let count = 0;
  const wait = async (minutes: number) => engine.commitFieldInterview({ actorId: "student-field", lessonHash: xunpuExplorationLesson.contentHash,
    request: { schemaVersion: "field-interview-action/1.0.0", sessionId, bindingId: "binding-field", requestId: `field-window-${++count}`,
      expectedWorldStateVersion: (await engine.getRecord(sessionId)).currentSnapshot.stateVersion, action: { kind: "wait", minutes } } });
  await wait(1);
  const plan = calibrationWindowPlanForVariantV4("variant-xunpu-source-triangulation", true);
  expect(plan.policyVersion).toBe(LearnerCalibrationFieldPolicyVersionV4);
  const evaluate = async () => evaluateLearnerCalibrationV4({ variantRef: "variant-xunpu-source-triangulation", learnerActorId: "student-field", record: await engine.getRecord(sessionId), observationWindow: plan });
  expect((await evaluate()).status).toBe("observing");
  for (let i = 0; i < 10; i++) await wait(5);
  await wait(1);
  const completed = await evaluate();
  expect(completed.result?.outcome).toBe("failure");
  expect(completed.result?.evidence.studentActionRefs).toEqual([]);
  expect(completed.result?.unmetRequirements.some(item => item.includes("送审"))).toBe(true);
});
