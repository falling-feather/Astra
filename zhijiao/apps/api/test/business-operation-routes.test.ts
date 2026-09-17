import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  BusinessOperationCoordinator,
  InMemoryBusinessOperationReceiptStore,
  computeBusinessOperationRequestHash,
  type CommitBusinessOperationInput,
} from "../src/business-operation-receipt.js";
import { registerBusinessOperationRoutes } from "../src/business-operation-routes.js";
import type { SimulationWorldAudienceV3 } from "../src/world-simulation-v3-routes.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function operation(
  requestId: string,
  sourceSessionId: string,
  targetSessionId: string | null = null,
): CommitBusinessOperationInput {
  return {
    operationKind: "submit_work_revision",
    requestId,
    requestHash: computeBusinessOperationRequestHash({
      requestId,
      rawPayload: "server-only-sensitive-material",
    }),
    scope: {
      sourceSessionId,
      targetSessionId,
      artifactId: `artifact-${requestId}`,
    },
    outboxSteps: ["refresh_assessment_projection"],
  };
}

async function complete(
  operations: BusinessOperationCoordinator,
  input: CommitBusinessOperationInput,
) {
  return operations.execute(
    input,
    async () => ({ commitRef: `commit-${input.requestId}` }),
    {
      refresh_assessment_projection: async () => ({
        resultRef: `projection-${input.requestId}`,
      }),
    },
  );
}

async function appFor(
  operations: BusinessOperationCoordinator,
  audience: SimulationWorldAudienceV3,
) {
  const app = Fastify({ logger: false });
  apps.push(app);
  const authorize = vi.fn(({ bindingId }: { bindingId: string }) => ({
    audience,
    principalId: audience === "student" ? "principal-student" : "principal-staff",
    actorId: audience === "admin" ? "admin-main" : "teacher-main",
    bindingId,
  }));
  await registerBusinessOperationRoutes(app, { operations, authorize });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : 500;
    void reply.status(status).send({
      error: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, authorize };
}

describe("business operation recovery routes", () => {
  it("returns only admin-visible receipts scoped to the requested session", async () => {
    const operations = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
    );
    await complete(operations, operation("scope-source", "session-visible"));
    await complete(operations, operation(
      "scope-target",
      "session-origin",
      "session-visible",
    ));
    await complete(operations, operation("scope-hidden", "session-hidden"));
    const { app } = await appFor(operations, "admin");

    const response = await app.inject({
      method: "GET",
      url: "/api/v4/admin/sessions/session-visible/business-operations?bindingId=binding-admin",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().operations).toHaveLength(2);
    expect(response.json().operations.every((receipt: {
      scope: { sourceSessionId: string; targetSessionId: string | null };
    }) => (
      receipt.scope.sourceSessionId === "session-visible"
      || receipt.scope.targetSessionId === "session-visible"
    ))).toBe(true);
    const serialized = response.body;
    expect(serialized).not.toContain("server-only-sensitive-material");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("providerKey");
  });

  it("denies teachers from the administrator recovery surface", async () => {
    const operations = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
    );
    await complete(operations, operation("teacher-denied", "session-denied"));
    const { app } = await appFor(operations, "teacher");

    const response = await app.inject({
      method: "GET",
      url: "/api/v4/admin/sessions/session-denied/business-operations?bindingId=binding-teacher",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("管理员");
  });

  it("rejects forged recovery query fields before authorization", async () => {
    const operations = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
    );
    const { app, authorize } = await appFor(operations, "admin");

    const response = await app.inject({
      method: "GET",
      url: "/api/v4/admin/sessions/session-forged/business-operations?bindingId=binding-admin&principalId=attacker&includePayload=true",
    });

    expect(response.statusCode).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
  });
});
