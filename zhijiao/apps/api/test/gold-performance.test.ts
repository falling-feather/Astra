import { performance } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import { expect, test } from "vitest";
import type { RoleBinding } from "@ronggang/contracts";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import { UnifiedIflytekAdapter } from "@ronggang/iflytek-adapter";
import type { DemoAuthContext } from "../src/identity.js";
import {
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";

async function createPerformanceApp(): Promise<FastifyInstance> {
  const scenario = structuredClone(demoScenario);
  const engine = new WorldEngine({
    store: new InMemoryEventStore(),
    bus: new InProcessMessageBus(),
    scenario,
  });
  return createMemoryTestApp({
    engine,
    adapter: new UnifiedIflytekAdapter({
      mode: "mock",
      environment: {},
    }),
    initializeSecondaryDemo: false,
  });
}

function percentile(values: readonly number[], proportion: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1),
  );
  return sorted[index] ?? 0;
}

test("QA-002 本地世界行动确认P95不高于500ms", async () => {
  const samples = 12;
  const latencies: number[] = [];

  const app = await createPerformanceApp();
  try {
    for (let index = 0; index < samples; index += 1) {
      const loginResponse = await app.inject({
        method: "POST",
        url: "/api/auth/demo-session",
        headers: { origin: localOrigin },
        payload: {},
      });
      expect(loginResponse.statusCode).toBe(200);
      const auth = loginResponse.json() as DemoAuthContext;
      const setCookie = Array.isArray(loginResponse.headers["set-cookie"])
        ? loginResponse.headers["set-cookie"][0]
        : loginResponse.headers["set-cookie"];
      if (!setCookie) throw new Error("性能测试登录没有返回Cookie");
      const student = auth.bindings.find(
        (binding): binding is RoleBinding => (
          binding.actorId === "student-reporter"
        ),
      );
      if (!student) throw new Error("性能测试缺少记者岗位绑定");
      const cookie = setCookie.split(";")[0];
      if (index > 0) {
        const teacher = auth.bindings.find(binding => binding.actorKind === "teacher");
        if (!teacher) throw new Error("性能测试缺少重置所需教师绑定");
        const reset = await app.inject({ method: "POST", url: "/api/sessions/demo/reset", headers: {
          cookie, origin: localOrigin, "x-csrf-token": auth.csrfToken,
        }, payload: { bindingId: teacher.bindingId } });
        expect(reset.statusCode, reset.body).toBe(200);
      }
      const projection = await app.inject({
        method: "GET",
        url:
          `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${student.bindingId}`,
        headers: { cookie },
      });
      expect(projection.statusCode).toBe(200);

      const startedMs = performance.now();
      const command = await app.inject({
        method: "POST",
        url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
        headers: {
          cookie,
          origin: localOrigin,
          "x-csrf-token": auth.csrfToken,
        },
        payload: {
          bindingId: student.bindingId,
          name: "send_role_interaction",
          expectedStateVersion: projection.json().stateVersion,
          sourceMode: "world_interaction",
          surfaceId: "student-world",
          interactionId: `gold-performance-${index}`,
          actionId: `gold-performance-action-${index}`,
          idempotencyKey: `gold-performance-idempotency-${index}`,
          payload: { optionId: "reporter-interview-process" },
        },
      });
      latencies.push(performance.now() - startedMs);
      expect(command.statusCode).toBe(200);
    }
  } finally {
    await app.close();
  }

  const summary = {
    schemaVersion: "gold-local-action-performance/1.0.0",
    environment: "fastify-inject-memory-test",
    samples,
    p50Ms: Number(percentile(latencies, 0.5).toFixed(3)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...latencies).toFixed(3)),
    targetP95Ms: 500,
  };
  console.info(`GOLD_PERFORMANCE_METRIC ${JSON.stringify(summary)}`);
  expect(summary.p95Ms).toBeLessThanOrEqual(summary.targetP95Ms);
}, 30_000);
