import { describe, expect, it } from "vitest";
import {
  FlagshipRuntimeActionPolicyV4Schema,
  FlagshipWorldRuntimeDefinitionV4Schema,
  FlagshipWorldRuntimeDefinitionV4SchemaVersion,
} from "../src/index.js";
import { flagshipContentReferenceV4Fixture } from "./v4-flagship.fixture.js";

function fixture() {
  return {
    schemaVersion: FlagshipWorldRuntimeDefinitionV4SchemaVersion,
    definitionId: "runtime-fixture-v4",
    contentRef: flagshipContentReferenceV4Fixture(),
    externalObjectRefs: [],
    phases: [{
      phaseId: "phase-opening",
      priority: 0,
      worldStateRef: "state-opening",
      locationId: "loc-opening",
      environmentAssetId: "asset-opening",
      npcRefs: [],
      objectRefs: [],
      prompt: "开始岗位行动。",
      activation: {
        terminal: false,
        allHandledEventTypes: [],
        anyHandledEventTypes: [],
      },
    }],
    intentBindings: [{
      bindingId: "binding-opening",
      priority: 0,
      verbs: ["ask"],
      targetRefs: [],
      eventTemplateCandidates: ["event-template-opening"],
      workspaceOnly: false,
    }],
    eventActions: [{
      eventTemplateId: "event-template-opening",
      action: {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-source" },
      },
    }],
    groundedBindings: [],
    autonomyBindings: [],
    portraits: [],
  };
}

describe("FlagshipWorldRuntimeDefinitionV4Schema", () => {
  it("accepts a strict content-bound runtime definition", () => {
    expect(FlagshipWorldRuntimeDefinitionV4Schema.parse(fixture()))
      .toMatchObject({ definitionId: "runtime-fixture-v4" });
  });

  it("rejects extra fields and contradictory workspace bindings", () => {
    expect(() => FlagshipWorldRuntimeDefinitionV4Schema.parse({
      ...fixture(),
      browserActor: "forged",
    })).toThrow();

    const contradictory = fixture();
    contradictory.intentBindings[0]!.workspaceOnly = true;
    expect(() => FlagshipWorldRuntimeDefinitionV4Schema.parse(contradictory))
      .toThrow(/工作台意图不得绑定世界事件/u);
  });

  it("serializes alternate-path conditions as one immutable action policy", () => {
    const policy = FlagshipRuntimeActionPolicyV4Schema.parse({
      schemaVersion: "flagship-action-policy/4.0.0",
      policyId: "runtime-policy-fixture",
      actions: [{
        eventTemplateId: "event-template-opening",
        requirements: {
          all: [{
            kind: "time_threshold",
            metric: "remaining_minutes",
            operator: "gte",
            value: 10,
          }],
          any: [],
          none: [],
        },
        unavailableReason: "剩余时间不足。",
      }],
    });
    expect(policy.actions[0]?.requirements.all[0]).toMatchObject({
      kind: "time_threshold",
      value: 10,
    });
    expect(() => FlagshipRuntimeActionPolicyV4Schema.parse({
      ...policy,
      actions: [policy.actions[0], policy.actions[0]],
    })).toThrow(/不得重复声明/u);
  });
});
