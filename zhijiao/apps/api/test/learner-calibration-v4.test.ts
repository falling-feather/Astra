import { describe, expect, it } from "vitest";
import {
  calibrationWindowPlanForVariantV4,
  evaluateLearnerCalibrationV4,
} from "../src/learner-calibration-v4.js";
import type { SimulationSessionRecord } from "@ronggang/world-core";

const sourceVariant = "variant-xunpu-source-triangulation" as const;
const consentVariant = "variant-xunpu-consent-negotiation" as const;
const deadlineVariant = "variant-xunpu-deadline-service" as const;
const editorialVariant = "variant-xunpu-editorial-independence" as const;
const allVariants = [
  sourceVariant,
  consentVariant,
  deadlineVariant,
  editorialVariant,
] as const;

const variableIds = [
  "evidence_confidence",
  "copyright_risk",
  "community_trust",
  "public_safety_risk",
  "public_trust",
  "editorial_independence",
  "correction_debt",
] as const;

function action(
  id: string,
  verb: string,
  eventId: string,
  payload: Record<string, unknown> = {},
) {
  return {
    workActionId: id,
    sessionId: "training-adaptive-v4-test",
    bindingId: "binding-student",
    actorId: "student-reporter",
    action: { verb, ...payload },
    sourceWorldEventIds: [eventId],
    submissionStatus: verb === "draft" ? "draft" : "accepted",
  };
}

function event(
  eventId: string,
  eventType: string,
  sourceRef: string,
  sequence: number,
) {
  return {
    eventId,
    eventType,
    sourceKind: eventType.startsWith("student_") ? "student_action" : "npc_intent",
    sourceRef,
    sequence,
    status: "committed",
    resolutionId: `resolution-${eventId}`,
  };
}

function consequence(eventId: string, index: number) {
  return {
    eventId: `consequence-${index}`,
    sourceWorldEventId: eventId,
    resolutionId: `resolution-${eventId}`,
    evidenceIds: [`evidence-${index}`],
  };
}

function resolution(
  eventId: string,
  index: number,
  teacherGate: { status?: string; gateId?: string; teacherDecisionRef?: string | null } | null = null,
) {
  return {
    resolutionId: `resolution-${eventId}`,
    sourceWorldEventId: eventId,
    status: teacherGate?.status === "pending"
      ? "pending_teacher_gate"
      : teacherGate?.status === "rejected" ? "rejected" : "committed",
    teacherGate,
    variableDeltas: [],
    emittedWorldEventIds: [eventId],
    emittedEvidenceIds: [`evidence-${index}`],
  };
}

function record(input: {
  variant: typeof allVariants[number];
  elapsedMinutes: number;
  stateVersion: number;
  endingStatus?: "active" | "completed" | "recoverable_failure";
  eventRows: readonly ReturnType<typeof event>[];
  actions?: readonly ReturnType<typeof action>[];
  consequences?: ReturnType<typeof consequence>[];
  resolutions?: ReturnType<typeof resolution>[];
  pendingGate?: boolean;
  values?: Partial<Record<typeof variableIds[number], number>>;
  facts?: Array<{ factId: string; status: string; sourceRefs: string[] }>;
}): SimulationSessionRecord {
  const initialValues: Record<string, number> = {
    evidence_confidence: 25,
    copyright_risk: 20,
    community_trust: 50,
    public_safety_risk: 10,
    public_trust: 50,
    editorial_independence: 60,
    correction_debt: 0,
  };
  const values = { ...initialValues, ...input.values };
  return {
    sessionId: "training-adaptive-v4-test",
    release: {
      expectedDurationMinutes: calibrationWindowPlanForVariantV4(input.variant).endVirtualMinute,
      variableDefinitions: variableIds.map((variableId) => ({
        variableId,
        initialValue: initialValues[variableId],
      })),
    },
    currentSnapshot: {
      stateVersion: input.stateVersion,
      virtualTime: { elapsedMinutes: input.elapsedMinutes },
      endingState: { status: input.endingStatus ?? "active" },
      variables: variableIds.map((variableId) => ({
        variableId,
        before: initialValues[variableId],
        delta: values[variableId]! - initialValues[variableId]!,
        after: values[variableId],
      })),
      facts: input.facts ?? [],
    },
    queue: input.eventRows,
    studentActions: input.actions ?? [],
    consequences: input.consequences ?? input.eventRows.map((row, index) => consequence(row.eventId, index + 1)),
    resolutions: input.resolutions ?? input.eventRows.map((row, index) => resolution(row.eventId, index + 1)),
    pendingGate: input.pendingGate ? { eventId: input.eventRows.at(-1)?.eventId ?? "event-pending" } : null,
  } as unknown as SimulationSessionRecord;
}

describe("learner calibration V4 task outcomes", () => {
  it("keeps one inspect observing and does not calibrate before the frozen window closes", () => {
    const inspect = event("event-inspect", "student_inspects_source", "action-inspect", 1);
    const result = evaluateLearnerCalibrationV4({
      variantRef: sourceVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: sourceVariant,
        elapsedMinutes: 20,
        stateVersion: 1,
        eventRows: [inspect],
        actions: [action("action-inspect", "inspect", inspect.eventId)],
      }),
    });
    expect(result.status).toBe("observing");
    expect(result.result).toBeNull();
    expect(result.observedBehaviorAlignment).toBeGreaterThan(0);
    expect(result.unmetRequirements).toEqual(expect.arrayContaining([
      expect.stringContaining("三角核验"),
    ]));
  });

  it("uses committed consequences and final evidence state, not an action verb, for success", () => {
    const inspect = event("event-inspect", "student_inspects_source", "action-inspect", 1);
    const compare = event("event-compare", "student_compares_sources", "action-compare", 2);
    const rows = [inspect, compare];
    const result = evaluateLearnerCalibrationV4({
      variantRef: sourceVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: sourceVariant,
        elapsedMinutes: 52,
        stateVersion: 2,
        eventRows: rows,
        actions: [
          action("action-inspect", "inspect", inspect.eventId),
          action("action-compare", "compare", compare.eventId),
        ],
        values: { evidence_confidence: 33 },
        facts: [{ factId: "fact-source-confirmed", status: "corroborated", sourceRefs: [compare.eventId] }],
      }),
    });
    expect(result.status).toBe("completed");
    expect(result.result).toMatchObject({
      outcome: "success",
      observedBehaviorAlignment: expect.any(Number),
      observationWindow: {
        policyVersion: "learner-calibration-v4/task-outcome-v1",
        closedBy: "window_elapsed",
      },
      evidence: {
        committedWorldEventRefs: [inspect.eventId, compare.eventId],
        consequenceRefs: expect.arrayContaining(["consequence-1", "consequence-2"]),
        variableRefs: expect.arrayContaining(["evidence_confidence"]),
        factRefs: ["fact-source-confirmed"],
      },
    });
  });

  it("keeps a failed first path and later recovery in the same final observation", () => {
    const contact = event("event-contact", "student_asks_community_source", "action-contact", 1);
    const withdrawal = event("event-withdrawal", "tourist_withdraws_consent", "npc-tourist", 2);
    const recovery = event("event-rights-recovery", "student_inspects_rights", "action-rights", 3);
    const result = evaluateLearnerCalibrationV4({
      variantRef: consentVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: consentVariant,
        elapsedMinutes: 50,
        stateVersion: 3,
        eventRows: [contact, withdrawal, recovery],
        actions: [
          action("action-contact", "ask", contact.eventId),
          action("action-rights", "inspect", recovery.eventId),
        ],
        values: { copyright_risk: 20, community_trust: 50 },
      }),
    });
    expect(result.status).toBe("completed");
    expect(result.result?.outcome).toBe("success");
    expect(result.result?.evidence.committedWorldEventRefs).toEqual([
      contact.eventId,
      withdrawal.eventId,
      recovery.eventId,
    ]);
    expect(result.result?.completionBasis.join(" ")).toContain("撤回");
  });

  it("keeps a consent task incomplete while its real teacher gate is pending, then resolves it after approval", () => {
    const contact = event("event-contact", "student_asks_community_source", "action-contact", 1);
    const withdrawal = event("event-withdrawal", "tourist_withdraws_consent", "npc-tourist", 2);
    const recovery = event("event-rights-recovery", "student_inspects_rights", "action-rights", 3);
    const pendingGate = {
      gateId: "gate-interview-rights",
      status: "pending",
      teacherDecisionRef: null,
    } as const;
    const pending = evaluateLearnerCalibrationV4({
      variantRef: consentVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: consentVariant,
        elapsedMinutes: 50,
        stateVersion: 3,
        eventRows: [contact, withdrawal, recovery],
        actions: [
          action("action-contact", "ask", contact.eventId),
          action("action-rights", "inspect", recovery.eventId),
        ],
        values: { copyright_risk: 20, community_trust: 50 },
        resolutions: [
          resolution(contact.eventId, 1),
          resolution(withdrawal.eventId, 2),
          resolution(recovery.eventId, 3, pendingGate),
        ],
        pendingGate: true,
      }),
    });
    expect(pending.result?.outcome).toBe("failure");
    expect(pending.result?.unmetRequirements).toEqual(expect.arrayContaining([
      expect.stringContaining("教师门"),
    ]));

    const approved = evaluateLearnerCalibrationV4({
      variantRef: consentVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: consentVariant,
        elapsedMinutes: 50,
        stateVersion: 4,
        eventRows: [contact, withdrawal, recovery],
        actions: [
          action("action-contact", "ask", contact.eventId),
          action("action-rights", "inspect", recovery.eventId),
        ],
        values: { copyright_risk: 20, community_trust: 50 },
        resolutions: [
          resolution(contact.eventId, 1),
          resolution(withdrawal.eventId, 2),
          resolution(recovery.eventId, 3, {
            gateId: "gate-interview-rights",
            status: "approved",
            teacherDecisionRef: "teacher-decision-rights",
          }),
        ],
      }),
    });
    expect(approved.result?.outcome).toBe("success");
  });

  it("keeps a rejected teacher gate as a final failure and does not close before the window", () => {
    const contact = event("event-contact", "student_asks_community_source", "action-contact", 1);
    const rights = event("event-rights", "student_inspects_rights", "action-rights", 2);
    const base = {
      variant: consentVariant,
      stateVersion: 2,
      eventRows: [contact, rights],
      actions: [
        action("action-contact", "ask", contact.eventId),
        action("action-rights", "inspect", rights.eventId),
      ],
      values: { copyright_risk: 20, community_trust: 50 },
    } as const;
    const beforeWindow = evaluateLearnerCalibrationV4({
      variantRef: consentVariant,
      learnerActorId: "student-reporter",
      record: record({ ...base, elapsedMinutes: 49 }),
    });
    expect(beforeWindow.status).toBe("observing");

    const rejected = evaluateLearnerCalibrationV4({
      variantRef: consentVariant,
      learnerActorId: "student-reporter",
      record: record({
        ...base,
        elapsedMinutes: 50,
        resolutions: [
          resolution(contact.eventId, 1),
          resolution(rights.eventId, 2, {
            gateId: "gate-interview-rights",
            status: "rejected",
            teacherDecisionRef: "teacher-decision-rejected",
          }),
        ],
      }),
    });
    expect(rejected.result?.outcome).toBe("failure");
    expect(rejected.result?.unmetRequirements).toEqual(expect.arrayContaining([
      expect.stringContaining("教师门"),
    ]));
  });

  it("requires a real service result for the deadline variant", () => {
    const request = event("event-official", "student_requests_official_data", "action-official", 1);
    const wait = event("event-wait", "student_waits_for_verification", "action-wait", 2);
    const draft = event("event-draft", "student_drafts_story", "action-draft", 3);
    const result = evaluateLearnerCalibrationV4({
      variantRef: deadlineVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: deadlineVariant,
        elapsedMinutes: 45,
        stateVersion: 3,
        eventRows: [request, wait, draft],
        actions: [
          action("action-official", "ask", request.eventId),
          action("action-wait", "wait", wait.eventId),
          action("action-draft", "draft", draft.eventId, {
            artifactId: "artifact-service-update",
            revisionId: "revision-service-update",
          }),
        ],
        values: { public_safety_risk: 5, public_trust: 55 },
      }),
    });
    expect(result.result?.outcome).toBe("success");
    expect(result.result?.evidence.workRefs).toEqual(expect.arrayContaining([
      "action-draft",
      "artifact-service-update",
    ]));
  });

  it("records a failure at the window boundary even when no student action exists", () => {
    const result = evaluateLearnerCalibrationV4({
      variantRef: deadlineVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: deadlineVariant,
        elapsedMinutes: 45,
        stateVersion: 0,
        eventRows: [],
      }),
    });
    expect(result.status).toBe("completed");
    expect(result.result?.outcome).toBe("failure");
    expect(result.result?.evidence.studentActionRefs).toEqual([]);
  });

  it("requires the commercial trigger, independent response and final state for editorial independence", () => {
    const offer = event("event-offer", "shopkeeper_requests_placement", "npc-shopkeeper", 1);
    const response = event("event-response", "student_resolves_commercial_exchange", "action-response", 2);
    const draft = event("event-editorial-draft", "student_drafts_story", "action-editorial-draft", 3);
    const result = evaluateLearnerCalibrationV4({
      variantRef: editorialVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: editorialVariant,
        elapsedMinutes: 48,
        stateVersion: 3,
        eventRows: [offer, response, draft],
        actions: [
          action("action-response", "negotiate", response.eventId),
          action("action-editorial-draft", "draft", draft.eventId, {
            artifactId: "artifact-editorial-story",
            revisionId: "revision-editorial-story",
          }),
        ],
        values: { editorial_independence: 65 },
      }),
    });
    expect(result.result?.outcome).toBe("success");
    expect(result.result?.observationWindow.endVirtualMinute).toBe(48);
  });

  it("does not turn a completed world into an early success when the task requirements are missing", () => {
    const onlyAction = event("event-action", "student_resolves_commercial_exchange", "action-commercial", 1);
    const result = evaluateLearnerCalibrationV4({
      variantRef: editorialVariant,
      learnerActorId: "student-reporter",
      record: record({
        variant: sourceVariant,
        elapsedMinutes: 1,
        stateVersion: 1,
        endingStatus: "completed",
        eventRows: [onlyAction],
        actions: [action("action-commercial", "negotiate", onlyAction.eventId)],
      }),
    });
    expect(result.status).toBe("completed");
    expect(result.result?.outcome).toBe("failure");
    expect(result.result?.unmetRequirements.length).toBeGreaterThan(0);
  });
});
