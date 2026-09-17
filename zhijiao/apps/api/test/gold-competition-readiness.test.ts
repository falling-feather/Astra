import { afterEach, describe, expect, it } from "vitest";
import {
  GoldCompetitionReadinessSnapshotSchema,
  type RoleBinding,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import type { FastifyInstance } from "fastify";
import type { DemoAuthContext } from "../src/identity.js";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import {
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

function binding(
  bindings: readonly RoleBinding[],
  actorKind: "student" | "teacher",
): RoleBinding {
  const value = bindings.find((item) => item.actorKind === actorKind);
  if (!value) throw new Error(`测试登录缺少 ${actorKind} 绑定`);
  return value;
}

describe("gold competition readiness API", () => {
  it("returns a teacher-only, fail-closed, deidentified competition snapshot", async () => {
    app = await createMemoryTestApp({
      engine: new WorldEngine({
        store: new InMemoryEventStore(),
        bus: new InProcessMessageBus(),
        scenario: structuredClone(demoScenario),
      }),
      initializeGoldScenarioRelease: true,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: {},
    });
    expect(login.statusCode).toBe(200);
    const auth = login.json() as DemoAuthContext;
    const setCookie = Array.isArray(login.headers["set-cookie"])
      ? login.headers["set-cookie"][0]
      : login.headers["set-cookie"];
    if (!setCookie) throw new Error("测试登录没有 Cookie");
    const cookie = setCookie.split(";")[0]!;
    const teacher = binding(auth.bindings, "teacher");
    const student = binding(auth.bindings, "student");

    const response = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-competition-readiness?bindingId=${teacher.bindingId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const snapshot = GoldCompetitionReadinessSnapshotSchema.parse(
      response.json(),
    );

    expect(snapshot.sourceArtifacts.map((source) => source.integrity))
      .toEqual([
        "verified",
        "validated",
        "verified",
        "verified",
        "verified",
      ]);
    expect(snapshot.coreClaims).toHaveLength(3);
    expect(snapshot.deliverables).toHaveLength(6);
    expect(snapshot.summary).toMatchObject({
      overallStatus: "insufficient",
      passedDeliverableCount: 2,
      insufficientDeliverableCount: 4,
      readyForCompetitionClaim: false,
    });
    expect(snapshot.deliverables.find(
      (deliverable) => deliverable.deliverableId === "controlled_ablation",
    )).toMatchObject({
      status: "insufficient",
      adverseFinding: true,
    });
    expect(snapshot.officialAlignment).toMatchObject({
      status: "insufficient",
      sourceCount: 2,
      requirementCount: 17,
      mappedRequirementCount: 17,
      passedRequirementCount: 6,
      insufficientRequirementCount: 8,
      unverifiedRequirementCount: 3,
    });
    expect(snapshot.officialAlignment.artifacts.map((artifact) => (
      artifact.integrity
    ))).toEqual(["verified", "verified"]);
    expect(snapshot.officialAlignment.blockingRequirementIds).toContain(
      "registration_receipt",
    );
    expect(snapshot.officialScorecard).toMatchObject({
      status: "insufficient",
      dimensionCount: 3,
      itemCount: 6,
      evidencePassedItemCount: 1,
      evidenceInsufficientItemCount: 5,
      evidenceReadyMaxScore: 10,
      scoredItemCount: 0,
      independentMockScoreTotal: null,
      verifiedMaterialBindingCount: 0,
    });
    expect(snapshot.officialScorecard.artifact.integrity).toBe("verified");
    expect(snapshot.officialScorecard.blockingItemIds).toHaveLength(6);
    expect(snapshot.iflytekFit).toMatchObject({
      status: "unverified",
      mode: "mock",
    });
    const serialized = JSON.stringify(snapshot);
    for (const sensitiveField of [
      "sessionId",
      "participantAlias",
      "reviewerAlias",
      "actorId",
      "runId",
      "evaluationCaseId",
    ]) {
      expect(serialized).not.toContain(sensitiveField);
    }
    const { snapshotHash, ...unsigned } = snapshot;
    expect(snapshotHash).toBe(hashValue(unsigned));

    const denied = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-competition-readiness?bindingId=${student.bindingId}`,
      headers: { cookie },
    });
    expect(denied.statusCode).toBe(403);
  });
});
