import { describe, expect, it } from "vitest";
import { CurrentTaskAnchorSchema } from "../src/index.js";

describe("CurrentTaskAnchorSchema", () => {
  it("accepts an explicit no-task projection", () => {
    expect(CurrentTaskAnchorSchema.parse({
      taskId: null,
      phase: "no_task",
      stateVersion: 0,
      sourceEventId: null,
      priority: "none",
      worldTarget: null,
      latestFeedbackReason: "当前投影没有可锚定的岗位任务",
    })).toMatchObject({
      phase: "no_task",
      taskId: null,
      stateVersion: 0,
    });
  });

  it("accepts a representative task before its incident is triggered", () => {
    expect(CurrentTaskAnchorSchema.parse({
      taskId: "flagship-task-rain-collaboration",
      phase: "not_triggered",
      stateVersion: 18,
      sourceEventId: null,
      priority: "normal",
      worldTarget: {
        mode: "world_interaction",
        sceneId: "scene-rain-transition",
        taskId: "flagship-task-rain-collaboration",
      },
      latestFeedbackReason: "当前节点任务已开放",
    })).toMatchObject({
      phase: "not_triggered",
      priority: "normal",
    });
  });

  it.each([
    {
      taskId: "unexpected-task",
      phase: "no_task",
      stateVersion: 1,
      sourceEventId: null,
      priority: "normal",
      worldTarget: null,
      latestFeedbackReason: "非法无任务状态",
    },
    {
      taskId: "flagship-task-rain-collaboration",
      phase: "not_triggered",
      stateVersion: 2,
      sourceEventId: "event-rain",
      priority: "normal",
      worldTarget: {
        mode: "world_interaction",
        sceneId: "scene-rain-transition",
        taskId: "flagship-task-rain-collaboration",
      },
      latestFeedbackReason: "尚未触发却声明来源事件",
    },
    {
      taskId: "flagship-task-rain-collaboration",
      phase: "in_progress",
      stateVersion: 3,
      sourceEventId: "event-rain",
      priority: "urgent",
      worldTarget: {
        mode: "world_interaction",
        sceneId: "scene-rain-transition",
        taskId: "different-task",
      },
      latestFeedbackReason: "现场目标漂移",
    },
  ])("rejects inconsistent anchor state", (candidate) => {
    expect(CurrentTaskAnchorSchema.safeParse(candidate).success).toBe(false);
  });
});
