import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  CollaborationStrategyService,
  InMemoryCollaborationStrategyStore,
} from "../src/collaboration-strategy-store.js";
import {
  registerStrategyReuseRoutes,
} from "../src/strategy-reuse-routes.js";
import {
  StrategyReuseService,
  type StrategyReuseStrategyReader,
} from "../src/strategy-reuse.js";
import { collaborationStrategyContent } from "./collaboration-strategy.fixture.js";
import { collaborationReplayForReuse } from "./strategy-reuse.fixture.js";

const teacher = {
  actorId: "teacher-main",
  actorKind: "teacher",
} as const;
const now = "2026-07-31T01:00:00.000Z";

interface AppForOptions {
  expectedHash?: string;
  expectedVersion?: number;
  duplicateApproved?: boolean;
  strategyStatus?: "draft" | "approved" | "disabled" | "retired";
}

async function appFor(options: AppForOptions = {}) {
  const store = new InMemoryCollaborationStrategyStore();
  const governance = new CollaborationStrategyService(
    store,
    { now: () => now },
  );
  const draft = await governance.createDraft({
    strategyId: "strategy-rain-collaboration",
    version: 1,
    content: collaborationStrategyContent(),
  }, teacher);
  const strategyStatus = options.strategyStatus ?? "approved";
  let strategy = draft;
  if (strategyStatus !== "draft") {
    strategy = await governance.transitionGovernance(
      draft.strategyId,
      draft.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: draft.contentHash,
        action: strategyStatus === "retired" ? "retire" : "approve",
        reason: "测试教师治理。",
      },
      teacher,
    );
  }
  if (strategyStatus === "disabled") {
    strategy = await governance.transitionGovernance(
      strategy.strategyId,
      strategy.version,
      {
        expectedStatus: "approved",
        expectedGovernanceRevision: 1,
        expectedContentHash: strategy.contentHash,
        action: "disable",
        reason: "测试教师禁用。",
      },
      teacher,
    );
  }
  const duplicate = structuredClone(strategy);
  duplicate.strategyId = "strategy-rain-collaboration-duplicate";
  const reader: StrategyReuseStrategyReader = options.duplicateApproved
    ? {
        get: store.get.bind(store),
        list: async () => [strategy, duplicate],
      }
    : store;
  const app = Fastify();
  const loadAuthorizedContext = vi.fn(
    async ({ bindingId, sessionId }: {
      bindingId: string;
      sessionId: string;
    }) => {
      if (bindingId !== "binding-student") {
        throw new Error("unauthorized");
      }
      return {
        replay: collaborationReplayForReuse({ sessionId }),
        expectedStrategyRef: {
          strategyId: strategy.strategyId,
          version: options.expectedVersion ?? strategy.version,
          contentHash: options.expectedHash ?? strategy.contentHash,
        },
      };
    },
  );
  await registerStrategyReuseRoutes(app, {
    service: new StrategyReuseService(reader, { now: () => now }),
    loadAuthorizedContext,
  });
  await app.ready();
  return { app, loadAuthorizedContext };
}

describe("strategy reuse routes", () => {
  it("returns the frozen student-safe explanation from the read endpoint", async () => {
    const { app, loadAuthorizedContext } = await appFor();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/sessions/session-student/strategy-reuse-explanation"
          + "?bindingId=binding-student",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schemaVersion: "strategy-reuse-explanation/1.0.0",
        sessionId: "session-student",
        status: "reused",
        reasonCode: "approved_match",
      });
      const body = JSON.stringify(response.json());
      for (const forbidden of [
        "actorId",
        "teacherActorId",
        "idempotencyKey",
        "privateMemory",
        "prompt",
        "lease",
        "provider",
      ]) {
        expect(body).not.toContain(forbidden);
      }
      expect(loadAuthorizedContext).toHaveBeenCalledTimes(1);
      expect(loadAuthorizedContext).toHaveBeenCalledWith(
        expect.objectContaining({
          bindingId: "binding-student",
          sessionId: "session-student",
        }),
      );
    } finally {
      await app.close();
    }
  });

  it.each([
    ["content hash", { expectedHash: "0".repeat(64) }],
    ["version", { expectedVersion: 2 }],
    ["approved uniqueness", { duplicateApproved: true }],
  ] as const)(
    "returns a stable 409 error DTO for %s drift",
    async (_case, options) => {
      const { app } = await appFor(options);
      try {
        const response = await app.inject({
          method: "GET",
          url: "/api/sessions/session-student/strategy-reuse-explanation"
            + "?bindingId=binding-student",
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          status: "error",
          reasonCode: "version_hash_drift",
          strategyStatus: null,
          actualPath: null,
          alternativePath: null,
        });
      } finally {
        await app.close();
      }
    },
  );

  it.each([
    ["draft", "strategy_draft"],
    ["disabled", "strategy_disabled"],
    ["retired", "strategy_retired"],
  ] as const)(
    "maps %s governance to an exact HTTP 200 non-reuse DTO",
    async (strategyStatus, reasonCode) => {
      const { app } = await appFor({ strategyStatus });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/api/sessions/session-student/strategy-reuse-explanation"
            + "?bindingId=binding-student",
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          status: "not_reused",
          reasonCode,
          strategyStatus,
          actualPath: null,
          alternativePath: null,
        });
      } finally {
        await app.close();
      }
    },
  );

  it("does not accept strategy or replay claims from the browser", async () => {
    const { app, loadAuthorizedContext } = await appFor();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/sessions/session-student/strategy-reuse-explanation"
          + "?bindingId=binding-student"
          + "&strategyId=forged"
          + "&contentHash=" + "0".repeat(64)
          + "&replay=forged",
      });
      expect(response.statusCode).toBe(400);
      expect(loadAuthorizedContext).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
