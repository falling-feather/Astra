import { describe, expect, it } from "vitest";
import {
  CourseEnrollmentSchema,
  CourseReleaseSchema,
  LearningActivitySchema,
} from "../src/index.js";
import {
  courseEnrollmentFixture,
  courseReleaseFixture,
  learningActivityFixture,
} from "./v2-learning.fixture.js";

describe("V2 course and learning schemas", () => {
  it("accepts immutable course, reporter-only enrollment and five exclusive activities", () => {
    expect(CourseReleaseSchema.parse(courseReleaseFixture()).chapters).toHaveLength(5);
    for (const status of [
      "claimed",
      "in_progress",
      "awaiting_review",
      "completed",
    ] as const) {
      expect(CourseEnrollmentSchema.parse(
        courseEnrollmentFixture(status),
      ).status).toBe(status);
    }
    for (const status of [
      "empty",
      "ready",
      "active",
      "awaiting_review",
      "completed",
    ] as const) {
      expect(LearningActivitySchema.parse(
        learningActivityFixture(status),
      ).status).toBe(status);
    }
  });

  it("requires continuous chapters, valid sources, complete rubric and one final chapter", () => {
    const duplicateOrder = structuredClone(courseReleaseFixture());
    duplicateOrder.chapters[1]!.order = 1;
    expect(() => CourseReleaseSchema.parse(duplicateOrder)).toThrow();

    const missingSource = structuredClone(courseReleaseFixture());
    missingSource.chapters[0]!.publicSourceRefs = ["source-not-registered"];
    expect(() => CourseReleaseSchema.parse(missingSource)).toThrow();

    const brokenRubric = structuredClone(courseReleaseFixture());
    brokenRubric.chapters[0]!.rubricCriteria[0]!.weight = 50;
    expect(() => CourseReleaseSchema.parse(brokenRubric)).toThrow();

    const duplicateFinal = structuredClone(courseReleaseFixture());
    duplicateFinal.chapters[0]!.finalChapter = true;
    expect(() => CourseReleaseSchema.parse(duplicateFinal)).toThrow();
  });

  it("rejects ordinary-student role escalation and inconsistent lifecycle dates", () => {
    expect(() => CourseEnrollmentSchema.parse({
      ...courseEnrollmentFixture("claimed"),
      primaryRoleId: "responsible_editor",
    })).toThrow();

    expect(() => CourseEnrollmentSchema.parse({
      ...courseEnrollmentFixture("completed"),
      completedAt: "2026-08-09T01:00:00.000Z",
    })).toThrow();
  });

  it("allows a current task only in active and requires exactly three guided steps", () => {
    const active = learningActivityFixture("active");
    expect(active.currentTask).not.toBeNull();

    const readyWithTask = {
      ...learningActivityFixture("ready"),
      currentTask: active.currentTask,
    };
    expect(() => LearningActivitySchema.parse(readyWithTask)).toThrow();

    const activeWithoutTask = {
      ...active,
      currentTask: null,
    };
    expect(() => LearningActivitySchema.parse(activeWithoutTask)).toThrow();

    const duplicateCurrentStep = structuredClone(active);
    duplicateCurrentStep.guideSteps[0]!.status = "current";
    expect(() => LearningActivitySchema.parse(duplicateCurrentStep)).toThrow();
  });

  it("fails closed on course version or content-hash drift", () => {
    const drift = structuredClone(learningActivityFixture("active"));
    if (drift.status !== "active") throw new Error("fixture status drift");
    drift.courseReleaseRef.contentHash = "b".repeat(64);
    expect(() => LearningActivitySchema.parse(drift)).toThrow();

    const versionDrift = structuredClone(learningActivityFixture("active"));
    if (versionDrift.status !== "active") throw new Error("fixture status drift");
    versionDrift.courseReleaseRef.version = 2;
    expect(() => LearningActivitySchema.parse(versionDrift)).toThrow();
  });

  it("rejects raw articles, prompt, private memory and token-shaped extra fields", () => {
    expect(() => CourseReleaseSchema.parse({
      ...courseReleaseFixture(),
      rawArticle: "不应进入不可变课程发布契约的原文",
    })).toThrow();

    expect(() => LearningActivitySchema.parse({
      ...learningActivityFixture("active"),
      prompt: "hidden prompt",
      privateMemory: { namespace: "private" },
      token: "secret-token",
    })).toThrow();
  });
});
