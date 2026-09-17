import { describe, expect, it } from "vitest";
import { StrategyReuseExplanationSchema } from "../src/strategy-reuse.js";
import {
  strategyReuseDriftFixture,
  strategyReuseExplanationFixture,
  strategyReuseNoMatchFixture,
} from "./strategy-reuse.fixture.js";

describe("strategy reuse explanation schemas", () => {
  it("accepts reused, explicit no-reuse and drift-safe fixtures", () => {
    expect(StrategyReuseExplanationSchema.parse(
      strategyReuseExplanationFixture(),
    ).status).toBe("reused");
    expect(StrategyReuseExplanationSchema.parse(
      strategyReuseNoMatchFixture(),
    ).status).toBe("not_reused");
    expect(StrategyReuseExplanationSchema.parse(
      strategyReuseDriftFixture(),
    ).status).toBe("error");
  });

  it("accepts only the single preset similar event identifiers", () => {
    expect(() => StrategyReuseExplanationSchema.parse({
      ...strategyReuseExplanationFixture(),
      currentEventId: "another-event",
    })).toThrow();
  });

  it("requires the actual path to cite the source event and task anchor", () => {
    const invalid = structuredClone(strategyReuseExplanationFixture());
    invalid.actualPath.eventIds = ["event-unrelated"];
    invalid.actualPath.taskIds = ["task-unrelated"];
    expect(() => StrategyReuseExplanationSchema.parse(invalid)).toThrow();
  });

  it("makes the alternative path explicitly write-free", () => {
    const fixture = strategyReuseExplanationFixture();
    expect(fixture.alternativePath).toMatchObject({
      occurred: false,
      writesWorldEvents: false,
      writesTasks: false,
      writesEvidence: false,
    });

    const invalid = {
      ...fixture,
      alternativePath: {
        ...fixture.alternativePath,
        writesTasks: true,
      },
    };
    expect(() => StrategyReuseExplanationSchema.parse(invalid)).toThrow();
  });

  it("does not attach actual or alternative paths to no-match and drift", () => {
    for (const fixture of [
      strategyReuseNoMatchFixture(),
      strategyReuseDriftFixture(),
    ]) {
      expect(fixture.actualPath).toBeNull();
      expect(fixture.alternativePath).toBeNull();
    }
  });

  it("binds non-approved reason codes to their exact governance status", () => {
    expect(() => StrategyReuseExplanationSchema.parse({
      ...strategyReuseNoMatchFixture(),
      reasonCode: "strategy_disabled",
      strategyRef: {
        strategyId: "strategy-rain-collaboration",
        version: 1,
        contentHash: "a".repeat(64),
      },
      strategyStatus: "retired",
    })).toThrow();
  });
});
