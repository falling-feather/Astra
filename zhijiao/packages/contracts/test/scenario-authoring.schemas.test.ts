import { describe, expect, it } from "vitest";
import {
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  ScenarioActiveAgentTemplateIds,
  ScenarioCollaborationFlagshipScenarioId,
  ScenarioCollaborationConfigPatchSchema,
  ScenarioCollaborationConfigSchema,
  ScenarioCollaborationConfigSchemaVersion,
} from "../src/index.js";

const validConfig = {
  schemaVersion: ScenarioCollaborationConfigSchemaVersion,
  routeId: FlagshipCollaborationRouteId,
  eventId: FlagshipCollaborationEventId,
  enabledAgentTemplateIds: [...ScenarioActiveAgentTemplateIds],
  strategyRef: {
    strategyId: "strategy-rain-collaboration",
    version: 1,
    contentHash: "a".repeat(64),
  },
};

describe("ScenarioCollaborationConfigSchema", () => {
  it("parses the fixed flagship event, three active templates and frozen strategy reference", () => {
    expect(ScenarioCollaborationFlagshipScenarioId).toBe(
      "scenario-local-tourism-media-v0.1",
    );
    expect(ScenarioCollaborationConfigSchema.parse(validConfig)).toEqual(
      validConfig,
    );
  });

  it.each([
    ["non-flagship route", { routeId: "route-anything" }],
    ["non-flagship event", { eventId: "event-anything" }],
    [
      "missing active template",
      { enabledAgentTemplateIds: ScenarioActiveAgentTemplateIds.slice(0, 2) },
    ],
    [
      "extra active template",
      {
        enabledAgentTemplateIds: [
          ...ScenarioActiveAgentTemplateIds,
          ScenarioActiveAgentTemplateIds[0],
        ],
      },
    ],
    [
      "inactive template",
      {
        enabledAgentTemplateIds: [
          ScenarioActiveAgentTemplateIds[0],
          ScenarioActiveAgentTemplateIds[1],
          "assistant/interview-structuring",
        ],
      },
    ],
    [
      "unknown template",
      {
        enabledAgentTemplateIds: [
          ScenarioActiveAgentTemplateIds[0],
          ScenarioActiveAgentTemplateIds[1],
          "assistant/custom-agent",
        ],
      },
    ],
  ])("rejects %s", (_label, patch) => {
    expect(ScenarioCollaborationConfigSchema.safeParse({
      ...validConfig,
      ...patch,
    }).success).toBe(false);
  });

  it("keeps browser patches limited to collaborationConfig references", () => {
    expect(ScenarioCollaborationConfigPatchSchema.parse({
      collaborationConfig: validConfig,
    })).toEqual({
      collaborationConfig: validConfig,
    });
    expect(ScenarioCollaborationConfigPatchSchema.safeParse({
      collaborationConfig: validConfig,
      strategies: [],
    }).success).toBe(false);
    expect(ScenarioCollaborationConfigPatchSchema.safeParse({
      collaborationConfig: validConfig,
      governance: {
        status: "approved",
      },
    }).success).toBe(false);
    expect(ScenarioCollaborationConfigSchema.safeParse({
      ...validConfig,
      governance: {
        status: "approved",
      },
    }).success).toBe(false);
  });
});
