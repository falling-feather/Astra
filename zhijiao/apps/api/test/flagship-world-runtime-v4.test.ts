import { describe, expect, it } from "vitest";
import { ChallengeAssignmentSchemaVersion } from "@ronggang/contracts";
import {
  buildXunpuFlagshipRuntimeReleaseV3R2,
  createXunpuFlagshipRuntimeDefinitionV4,
  getXunpuWorldSimulationReleaseV3,
  xunpuFlagshipContentV4,
} from "@ronggang/course-content";
import {
  InMemorySimulationSessionStore,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";
import { flagshipContentReferenceV4Of } from "../src/flagship-experience-v4.js";
import { compileFlagshipWorldRuntimeV4 } from "../src/flagship-world-runtime-v4.js";

function fixture() {
  const release = buildXunpuFlagshipRuntimeReleaseV3R2(
    getXunpuWorldSimulationReleaseV3().courseReleaseRef,
  );
  const contentRef = flagshipContentReferenceV4Of(release);
  const definition = createXunpuFlagshipRuntimeDefinitionV4(contentRef);
  return { contentRef, definition };
}

async function recordFixture() {
  const release = buildXunpuFlagshipRuntimeReleaseV3R2(
    getXunpuWorldSimulationReleaseV3().courseReleaseRef,
  );
  const sessionId = "session-runtime-policy";
  const variant = release.challengeVariants.find((item) => item.challengeLevel === 5)!;
  const engine = new WorldSimulationEngineV3({
    store: new InMemorySimulationSessionStore(),
    now: () => "2026-08-26T03:30:00.000Z",
    idFactory: (() => {
      let value = 0;
      return (prefix: string) => `${prefix}-runtime-policy-${++value}`;
    })(),
  });
  await engine.startSession({
    sessionId,
    release,
    challengeAssignment: {
      schemaVersion: ChallengeAssignmentSchemaVersion,
      challengeAssignmentId: "challenge-runtime-policy",
      learnerTwinRef: "learner-twin-runtime-policy",
      sessionId,
      simulationReleaseRef: release.simulationReleaseRef,
      worldVariantRef: variant.worldVariantId,
      previousChallengeLevel: 4,
      challengeLevel: 5,
      scoreCeiling: 90,
      pressureDimensions: [
        { dimensionId: "time", intensity: 5 },
        { dimensionId: "source_access", intensity: 5 },
      ],
      assignmentReason: "evidence_progression",
      basisEvidenceRefs: ["evidence-prior-session"],
      forecastRef: "forecast-runtime-policy",
      teacherOverride: null,
      policyVersion: "challenge-policy/1.0.0",
      policyContentHash: "d".repeat(64),
      assignedAt: "2026-08-26T03:29:00.000Z",
    },
    targetCompetencyRefs: ["competency-source-verification"],
    scaffoldingLevel: 1,
    startedAt: "2026-08-26T03:30:00.000Z",
  });
  return engine.getRecord(sessionId);
}

function acceptedDecision(input: {
  verb: "ask" | "compare" | "negotiate" | "draft";
  targetId: string;
}) {
  return {
    canonicalAction: {
      verb: input.verb,
      targetRefs: [{ objectId: input.targetId }],
    },
  } as never;
}

describe("compiled flagship world runtime v4", () => {
  it("compiles content-owned phases, actions, collaboration and autonomy bindings", () => {
    const { contentRef, definition } = fixture();
    const runtime = compileFlagshipWorldRuntimeV4({
      definition,
      contentRef,
      content: xunpuFlagshipContentV4,
    });
    expect(runtime.definitionId).toBe("xunpu-flagship-world-runtime-v4");
    expect(runtime.definitionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(runtime.actionForEvent(
      "event-template-rights-inspection",
      "核对当前授权范围",
    )).toMatchObject({
      verb: "inspect",
      evidenceQuestion: "核对当前授权范围",
    });
    expect(runtime.groundedBindingForEvent(
      "event-template-rights-inspection",
    )).toMatchObject({ episodeTemplateRef: "episode-media-rights-challenge" });
    expect(runtime.autonomyActorForEvent("student_asks_inheritor"))
      .toBe("entity-inheritor");
  });

  it("rejects dangling content references before the service starts", () => {
    const { contentRef, definition } = fixture();
    const invalid = structuredClone(definition);
    invalid.phases[0]!.locationId = "loc-does-not-exist";
    expect(() => compileFlagshipWorldRuntimeV4({
      definition: invalid,
      contentRef,
      content: xunpuFlagshipContentV4,
    })).toThrow(/引用未知地点/u);
  });

  it("rejects duplicate bindings and missing action mappings", () => {
    const { contentRef, definition } = fixture();
    const duplicate = structuredClone(definition);
    duplicate.intentBindings.push(structuredClone(duplicate.intentBindings[0]!));
    expect(() => compileFlagshipWorldRuntimeV4({
      definition: duplicate,
      contentRef,
      content: xunpuFlagshipContentV4,
    })).toThrow(/存在重复引用/u);

    const missingAction = structuredClone(definition);
    missingAction.eventActions = missingAction.eventActions.filter((item) => (
      item.eventTemplateId !== "event-template-gatekeeper"
    ));
    expect(() => compileFlagshipWorldRuntimeV4({
      definition: missingAction,
      contentRef,
      content: xunpuFlagshipContentV4,
    })).toThrow(/缺少事件动作/u);
  });

  it("rejects a validly shaped definition whose frozen content reference drifted", () => {
    const { contentRef, definition } = fixture();
    const drifted = structuredClone(definition);
    drifted.contentRef.contentHash = "f".repeat(64);
    expect(() => compileFlagshipWorldRuntimeV4({
      definition: drifted,
      contentRef,
      content: xunpuFlagshipContentV4,
    })).toThrow(/内容引用漂移/u);
  });

  it("resolves source-first and interview-first paths without opening fallback", async () => {
    const { contentRef, definition } = fixture();
    const runtime = compileFlagshipWorldRuntimeV4({
      definition,
      contentRef,
      content: xunpuFlagshipContentV4,
    });
    const initial = await recordFixture();
    const initialPhase = runtime.phaseFor(initial);
    const initialOptions = runtime.actionWindowOptions(initial, initialPhase);
    expect(initialOptions.objectRefs).toEqual(expect.arrayContaining([
      "obj-source-packet-a",
      "obj-source-packet-b",
    ]));
    expect(initialOptions.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventTemplateId: "event-template-compare-sources",
        status: "available",
      }),
    ]));
    expect(runtime.resolveAction(
      initial,
      acceptedDecision({ verb: "compare", targetId: "obj-source-packet-a" }),
    )).toMatchObject({
      kind: "event",
      eventTemplateId: "event-template-compare-sources",
    });

    const afterSource = structuredClone(initial);
    afterSource.queue.push({
      eventId: "world-event-source-first",
      sessionId: afterSource.sessionId,
      eventTemplateId: "event-template-compare-sources",
      eventType: "student_compares_sources",
      sourceKind: "student_action",
      sourceRef: "work-action-source-first",
      requestId: "request-source-first",
      requestHash: "a".repeat(64),
      enqueuedAtStateVersion: afterSource.currentSnapshot.stateVersion,
      sequence: afterSource.nextEventSequence,
      notBeforeVirtualMinute: 0,
      affectedObjectRefs: [],
      status: "committed",
      resolutionId: "resolution-source-first",
      occurredAt: "2026-08-26T03:30:00.000Z",
    });
    const afterSourceOptions = runtime.actionWindowOptions(
      afterSource,
      runtime.phaseFor(afterSource),
    );
    expect(afterSourceOptions.objectRefs).toContain("entity-community-source");
    expect(runtime.resolveAction(
      afterSource,
      acceptedDecision({ verb: "negotiate", targetId: "entity-community-source" }),
    )).toMatchObject({
      kind: "event",
      eventTemplateId: "event-template-community-source",
    });

    expect(runtime.resolveAction(
      initial,
      acceptedDecision({ verb: "ask", targetId: "entity-unknown" }),
    )).toMatchObject({ kind: "unavailable", bindingId: null });
    expect(runtime.resolveAction(
      initial,
      acceptedDecision({ verb: "draft", targetId: "obj-story-workbench" }),
    )).toMatchObject({ kind: "workspace", bindingId: "binding-workspace-only" });
  });
});
