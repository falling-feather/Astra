import { describe, expect, it } from "vitest";
import {
  DialogueEpisodeEnvelopeV4Schema,
  DialogueEpisodeV4Schema,
  DialogueEpisodeViewV4Schema,
  DialogueSceneDefinitionV4Schema,
  DialogueStartResponseV4Schema,
  DialogueStartResponseV4SchemaVersion,
  DialogueTurnRequestV4Schema,
} from "../src/index.js";
import {
  dialogueEpisodeV4Fixture,
  dialogueEpisodeViewV4Fixture,
  dialogueSceneDefinitionV4Fixture,
  dialogueTurnRequestV4Fixture,
} from "./dialogue-episode-v4.fixture.js";

describe("DialogueSceneDefinition/4.0.0", () => {
  it("accepts a multi-round scene with refusal, recovery and authoritative resolution", () => {
    expect(DialogueSceneDefinitionV4Schema.parse(dialogueSceneDefinitionV4Fixture()))
      .toEqual(dialogueSceneDefinitionV4Fixture());
  });

  it.each([
    ["unknown signal", (scene: ReturnType<typeof dialogueSceneDefinitionV4Fixture>) => {
      scene.rules[0]!.requiredAllSignalRefs = ["signal-forged"];
    }],
    ["unknown issue", (scene: ReturnType<typeof dialogueSceneDefinitionV4Fixture>) => {
      scene.rules[0]!.issueUpdates[0]!.issueRef = "issue-forged";
    }],
    ["unknown fact", (scene: ReturnType<typeof dialogueSceneDefinitionV4Fixture>) => {
      scene.rules[2]!.disclosedFactRefs = ["fact-private-forged"];
    }],
  ])("rejects a rule that references an %s", (_label, mutate) => {
    const scene = structuredClone(dialogueSceneDefinitionV4Fixture());
    mutate(scene);
    expect(DialogueSceneDefinitionV4Schema.safeParse(scene).success).toBe(false);
  });

  it("rejects a resolved rule without a route or world-event template", () => {
    const scene = structuredClone(dialogueSceneDefinitionV4Fixture());
    scene.rules[2]!.eventTemplateRef = null;
    expect(DialogueSceneDefinitionV4Schema.safeParse(scene).success).toBe(false);
  });

  it("rejects unauthorized fact disclosure and a resolution that skips required issues", () => {
    const unauthorizedFact = structuredClone(dialogueSceneDefinitionV4Fixture());
    unauthorizedFact.facts[0]!.disclosureRuleRefs = ["rule-clarify-boundary"];
    expect(DialogueSceneDefinitionV4Schema.safeParse(unauthorizedFact).success).toBe(false);

    const skippedIssue = structuredClone(dialogueSceneDefinitionV4Fixture());
    const resolved = skippedIssue.rules.find((rule) => rule.outcome === "resolved")!;
    resolved.issueUpdates = [];
    expect(DialogueSceneDefinitionV4Schema.safeParse(skippedIssue).success).toBe(false);
  });

  it("requires a signal-independent fallback for every allowed intent and turn", () => {
    const scene = structuredClone(dialogueSceneDefinitionV4Fixture());
    scene.rules = scene.rules.filter((rule) => rule.ruleRef !== "rule-clarify-boundary");
    expect(DialogueSceneDefinitionV4Schema.safeParse(scene).success).toBe(false);
  });

  it.each(["refusal", "recovery", "resolved", "exited"] as const)(
    "requires a reachable %s branch",
    (outcome) => {
      const scene = structuredClone(dialogueSceneDefinitionV4Fixture());
      scene.rules = scene.rules.filter((rule) => rule.outcome !== outcome);
      expect(DialogueSceneDefinitionV4Schema.safeParse(scene).success).toBe(false);
    },
  );
});

describe("DialogueEpisode/4.0.0", () => {
  it("accepts active and fully committed multi-round episodes", () => {
    expect(DialogueEpisodeV4Schema.parse(dialogueEpisodeV4Fixture("active")).status)
      .toBe("active");
    expect(DialogueEpisodeV4Schema.parse(dialogueEpisodeV4Fixture("resolved")).status)
      .toBe("resolved");
  });

  it("rejects inconsistent turn, runtime and request receipts", () => {
    const missingRuntime = structuredClone(dialogueEpisodeV4Fixture("resolved"));
    missingRuntime.runtimeReceipts.pop();
    expect(DialogueEpisodeV4Schema.safeParse(missingRuntime).success).toBe(false);

    const missingRequest = structuredClone(dialogueEpisodeV4Fixture("resolved"));
    missingRequest.requestReceipts.pop();
    expect(DialogueEpisodeV4Schema.safeParse(missingRequest).success).toBe(false);

    const outsideCandidate = structuredClone(dialogueEpisodeV4Fixture("resolved"));
    outsideCandidate.runtimeReceipts[0]!.candidateRuleRefs = ["rule-refuse-demand"];
    expect(DialogueEpisodeV4Schema.safeParse(outsideCandidate).success).toBe(false);

    const mismatchedRequest = structuredClone(dialogueEpisodeV4Fixture("resolved"));
    mismatchedRequest.requestReceipts[2]!.resultTurnRef = "dialogue-turn-forged";
    expect(DialogueEpisodeV4Schema.safeParse(mismatchedRequest).success).toBe(false);
  });

  it("rejects a false resolved status and a terminal prompt", () => {
    const missingWorldCommit = structuredClone(dialogueEpisodeV4Fixture("resolved"));
    missingWorldCommit.worldCommit = null;
    expect(DialogueEpisodeV4Schema.safeParse(missingWorldCommit).success).toBe(false);

    const terminalPrompt = structuredClone(dialogueEpisodeV4Fixture("resolved"));
    terminalPrompt.currentPrompt = "伪造的下一问";
    expect(DialogueEpisodeV4Schema.safeParse(terminalPrompt).success).toBe(false);
  });
});

describe("DialogueTurnRequest and role-safe views", () => {
  it("accepts only the strict, revision-bound turn request", () => {
    expect(DialogueTurnRequestV4Schema.parse(dialogueTurnRequestV4Fixture()))
      .toEqual(dialogueTurnRequestV4Fixture());
    expect(DialogueTurnRequestV4Schema.safeParse({
      ...dialogueTurnRequestV4Fixture(),
      npcRef: "npc-forged",
    }).success).toBe(false);
  });

  it.each(["student", "teacher", "admin"] as const)(
    "accepts the %s disclosure tier",
    (audience) => {
      expect(DialogueEpisodeViewV4Schema.parse(dialogueEpisodeViewV4Fixture(audience)).audience)
        .toBe(audience);
    },
  );

  it("keeps exact rules, learner hash and runtime receipts out of student and teacher views", () => {
    const admin = dialogueEpisodeViewV4Fixture("admin");
    if (admin.audience !== "admin") {
      throw new Error("admin fixture must use the admin disclosure tier");
    }
    const student = dialogueEpisodeViewV4Fixture("student");
    expect(DialogueEpisodeViewV4Schema.safeParse({
      ...student,
      runtime: admin.runtime,
    }).success).toBe(false);

    const teacher = dialogueEpisodeViewV4Fixture("teacher");
    if (teacher.audience !== "teacher") {
      throw new Error("teacher fixture must use the teacher disclosure tier");
    }
    expect(DialogueEpisodeViewV4Schema.safeParse({
      ...teacher,
      runtime: admin.runtime,
    }).success).toBe(false);
    expect(DialogueEpisodeViewV4Schema.safeParse({
      ...teacher,
      causalSummary: {
        ...teacher.causalSummary,
        selectedRuleRefs: ["rule-private-runtime"],
      },
    }).success).toBe(false);
  });

  it("never issues a mutation token to teacher or admin", () => {
    expect(DialogueEpisodeEnvelopeV4Schema.safeParse({
      audience: "teacher",
      episode: dialogueEpisodeViewV4Fixture("teacher"),
      turnToken: `dialogueturn_${"x".repeat(48)}`,
    }).success).toBe(false);
    expect(DialogueEpisodeEnvelopeV4Schema.parse({
      audience: "student",
      episode: dialogueEpisodeViewV4Fixture("student"),
      turnToken: `dialogueturn_${"x".repeat(48)}`,
    }).audience).toBe("student");
  });

  it("starts only with a student envelope and keeps clarification zero-state", () => {
    expect(DialogueStartResponseV4Schema.parse({
      schemaVersion: DialogueStartResponseV4SchemaVersion,
      status: "opened",
      safeMessage: "人物对话已开始。",
      dialogue: {
        audience: "student",
        episode: dialogueEpisodeViewV4Fixture("student"),
        turnToken: `dialogueturn_${"x".repeat(48)}`,
      },
    }).status).toBe("opened");
    expect(DialogueStartResponseV4Schema.safeParse({
      schemaVersion: DialogueStartResponseV4SchemaVersion,
      status: "clarification_required",
      safeMessage: "请选择一位现场人物并说明来意。",
      dialogue: {
        audience: "student",
        episode: dialogueEpisodeViewV4Fixture("student"),
        turnToken: `dialogueturn_${"x".repeat(48)}`,
      },
    }).success).toBe(false);
  });
});
