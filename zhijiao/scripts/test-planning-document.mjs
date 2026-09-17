import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlanningReservations } from "./lib/planning-document.mjs";

const plan = [
  "- [ ] PM-020｜清理｜状态：进行中｜目标版本：`V2.5.59`｜关联版本：预留 `V2.5.59`｜",
  "- [ ] QA-014｜交付｜状态：已认领｜目标版本：`V2.6.0`｜关联版本：预留 `V2.6.0`｜",
  "- [ ] DATA-006｜后续迁移｜状态：暂缓｜目标版本：暂无｜关联版本：暂无｜",
  "| 1 | `V2.5.59` | `PM-020` | PM | `V2.5.59 PM chore: 清理（PM-020）` |",
  "| 2 | `V2.6.0` | `QA-014` | QA | `V2.6.0 QA release: 交付（QA-014）` |",
].join("\n");

test("accepts an authorized stage release after development checkpoints and preserves deferred work", () => {
  assert.deepEqual(validatePlanningReservations(plan), { taskCount: 3, summary: "V2.5.59—V2.6.0" });
});
test("rejects reused versions, missing task ownership and a drifting target", () => {
  assert.throws(() => validatePlanningReservations(plan.replaceAll("V2.6.0", "V2.5.59")), /重复/);
  assert.throws(() => validatePlanningReservations(plan.replace("`QA-014` | QA", "`QA-099` | QA")), /缺少任务/);
  assert.throws(() => validatePlanningReservations(plan.replace("目标版本：`V2.6.0`", "目标版本：`V2.6.1`")), /目标版本/);
});
test("a completed task requires an actual commit association, and checkbox state must agree", () => {
  assert.throws(() => validatePlanningReservations(plan.replace("状态：已认领", "状态：已完成")), /勾选/);
  assert.throws(() => validatePlanningReservations(plan.replace("- [ ] QA", "- [x] QA").replace("状态：已认领", "状态：已完成")), /关联版本/);
});
