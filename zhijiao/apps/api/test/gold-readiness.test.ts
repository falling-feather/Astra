import { afterEach, describe, expect, it } from "vitest";
import {
  GoldReadinessWorkbenchSchema,
  type RoleBinding,
} from "@ronggang/contracts";
import type { FastifyInstance } from "fastify";
import type { DemoAuthContext } from "../src/identity.js";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
  flagshipScenarioV111ContentHash,
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

describe("gold-readiness API", () => {
  it("returns a teacher-only, schema-validated evidence workbench", async () => {
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
        `/api/sessions/${DEMO_SESSION_ID}/gold-readiness?bindingId=${teacher.bindingId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const workbench = GoldReadinessWorkbenchSchema.parse(response.json());

    expect(workbench.technicalEvidencePlan.goldenDemo.steps).toHaveLength(10);
    expect(workbench.technicalEvidencePlan.crossSurfaceCausality)
      .toHaveLength(5);
    expect(workbench.technicalEvidencePlan.technicalGates).toHaveLength(10);
    expect(workbench.technicalEvidencePlan.scenarioBindings.map(
      (item) => item.role,
    )).toEqual(["flagship", "transfer"]);
    expect(workbench.technicalEvidencePlan.scenarioBindings[0]).toMatchObject({
      version: "1.1.1",
      contentHash: flagshipScenarioV111ContentHash,
    });
    expect(workbench.controlledAblationPreregistration.status)
      .toBe("sealed_before_live");
    expect(
      workbench.controlledAblationPreregistration.reviewProtocol.scoreSemantics,
    ).toBe("candidate_adoption_readiness");
    expect(new Set(
      workbench.controlledAblationPreregistration.caseSuite.map(
        (item) => item.expectedDisposition,
      ),
    )).toEqual(new Set([
      "accept_candidate",
      "reject_candidate",
      "request_more_evidence",
    ]));
    expect(workbench.capabilityMatrix.rows).toHaveLength(6);
    expect(workbench.protocol.profiles.map((profile) => profile.conditionCode))
      .toEqual(["A", "B", "C"]);
    expect(workbench.contractReplay.observations).toHaveLength(30);
    expect(workbench.contractReplay.groups.every(
      (group) => group.runCount === 10 && group.failedCount === 1,
    )).toBe(true);
    expect(workbench.contractReplay.conclusion)
      .toBe("engineering_contract_passed");
    expect(workbench.observedSessionReport).toBeNull();
    expect(workbench.evaluationExport.cases).toEqual([]);
    expect(workbench.manifest.gitCommit).toBeNull();
    expect(workbench.manifest.artifactHashes.contractReplay)
      .toBe(workbench.contractReplay.reportHash);
    expect(
      workbench.manifest.artifactHashes.controlledAblationPreregistration,
    ).toBe(
      workbench.controlledAblationPreregistration.preregistrationHash,
    );

    const denied = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-readiness?bindingId=${student.bindingId}`,
      headers: { cookie },
    });
    expect(denied.statusCode).toBe(403);
  });
});
