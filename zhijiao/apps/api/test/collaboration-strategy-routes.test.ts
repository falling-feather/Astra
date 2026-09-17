import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  registerCollaborationStrategyRoutes,
  type CollaborationStrategyRouteOptions,
} from "../src/collaboration-strategy-routes.js";
import {
  CollaborationStrategyError,
  CollaborationStrategyService,
  InMemoryCollaborationStrategyStore,
} from "../src/collaboration-strategy-store.js";
import { collaborationStrategyContent } from "./collaboration-strategy.fixture.js";

const now = "2026-07-30T16:30:00.000Z";

async function buildApp(
  authorizeTeacher: CollaborationStrategyRouteOptions["authorizeTeacher"] = (
    { bindingId },
  ) => {
    if (bindingId !== "binding-teacher") {
      throw new CollaborationStrategyError(
        "permission_denied",
        "只有教师岗位绑定可以访问协作策略治理 API",
      );
    }
    return {
      actorId: "teacher-main",
      actorKind: "teacher",
    };
  },
) {
  const app = Fastify();
  const service = new CollaborationStrategyService(
    new InMemoryCollaborationStrategyStore(),
    { now: () => now },
  );
  await registerCollaborationStrategyRoutes(app, {
    service,
    authorizeTeacher,
  });
  await app.ready();
  return app;
}

describe("collaboration strategy routes", () => {
  it("creates, queries and approves a strategy through teacher-only endpoints", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        payload: {
          bindingId: "binding-teacher",
          authorizationSessionId: "demo-local-tourism",
          strategy: {
            strategyId: "strategy-rain-collaboration",
            version: 1,
            content: collaborationStrategyContent(),
          },
        },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().strategy).toMatchObject({
        strategyId: "strategy-rain-collaboration",
        version: 1,
        governance: { status: "draft", revision: 0 },
      });
      const contentHash = created.json().strategy.contentHash as string;

      const approved = await app.inject({
        method: "POST",
        url: [
          "/api/collaboration-strategies",
          "strategy-rain-collaboration",
          "versions",
          "1",
          "governance",
        ].join("/"),
        payload: {
          bindingId: "binding-teacher",
          authorizationSessionId: "demo-local-tourism",
          transition: {
            expectedStatus: "draft",
            expectedGovernanceRevision: 0,
            expectedContentHash: contentHash,
            action: "approve",
            reason: "教师确认该策略只服务旗舰暴雨事件。",
          },
        },
      });
      expect(approved.statusCode).toBe(200);
      expect(approved.json().strategy.governance).toMatchObject({
        status: "approved",
        revision: 1,
        latestReview: {
          action: "approve",
          teacherActorId: "teacher-main",
        },
      });

      const list = await app.inject({
        method: "GET",
        url: [
          "/api/collaboration-strategies",
          "?bindingId=binding-teacher",
          "&authorizationSessionId=demo-local-tourism",
          "&status=approved",
          "&triggerEventId=flagship-event-rain-escalation",
        ].join(""),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().strategies).toHaveLength(1);

      const detail = await app.inject({
        method: "GET",
        url: "/api/collaboration-strategies/strategy-rain-collaboration/versions/1"
          + "?bindingId=binding-teacher"
          + "&authorizationSessionId=demo-local-tourism",
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().strategy.contentHash).toBe(contentHash);
    } finally {
      await app.close();
    }
  });

  it("rejects student governance, forged actor fields and stale state", async () => {
    const app = await buildApp();
    try {
      const forged = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        payload: {
          bindingId: "binding-teacher",
          authorizationSessionId: "demo-local-tourism",
          strategy: {
            strategyId: "strategy-rain-collaboration",
            version: 1,
            content: collaborationStrategyContent(),
            createdBy: "forged-teacher",
          },
        },
      });
      expect(forged.statusCode).toBe(400);
      expect(forged.json().code).toBe("invalid_request");

      const created = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        payload: {
          bindingId: "binding-teacher",
          authorizationSessionId: "demo-local-tourism",
          strategy: {
            strategyId: "strategy-rain-collaboration",
            version: 1,
            content: collaborationStrategyContent(),
          },
        },
      });
      const contentHash = created.json().strategy.contentHash as string;

      const denied = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies/strategy-rain-collaboration/versions/1/governance",
        payload: {
          bindingId: "binding-student",
          authorizationSessionId: "demo-local-tourism",
          transition: {
            expectedStatus: "draft",
            expectedGovernanceRevision: 0,
            expectedContentHash: contentHash,
            action: "approve",
            reason: "学生不能批准策略。",
          },
        },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe("permission_denied");

      const stale = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies/strategy-rain-collaboration/versions/1/governance",
        payload: {
          bindingId: "binding-teacher",
          authorizationSessionId: "demo-local-tourism",
          transition: {
            expectedStatus: "approved",
            expectedGovernanceRevision: 1,
            expectedContentHash: contentHash,
            action: "disable",
            reason: "陈旧状态必须失败。",
          },
        },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().code).toBe("governance_conflict");
    } finally {
      await app.close();
    }
  });

  it("rejects a non-teacher identity returned by a faulty authorization adapter", async () => {
    const app = await buildApp(() => ({
      actorId: "student-editor",
      actorKind: "student",
    }));
    try {
      const response = await app.inject({
        method: "GET",
        url: [
          "/api/collaboration-strategies",
          "?bindingId=binding-student",
          "&authorizationSessionId=demo-local-tourism",
        ].join(""),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("permission_denied");
    } finally {
      await app.close();
    }
  });
});
