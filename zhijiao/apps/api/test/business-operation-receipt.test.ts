import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BusinessOperationOutboxStep,
} from "@ronggang/contracts";
import {
  BusinessOperationCoordinator,
  BusinessOperationError,
  InMemoryBusinessOperationReceiptStore,
  JsonlBusinessOperationReceiptStore,
  businessOperationId,
  computeBusinessOperationRequestHash,
  type CommitBusinessOperationInput,
} from "../src/business-operation-receipt.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function clock() {
  let tick = 0;
  return () => new Date(Date.parse("2026-09-01T08:00:00.000Z") + tick++ * 1_000)
    .toISOString();
}

function input(
  requestHash = computeBusinessOperationRequestHash({ revisionId: "revision-r2" }),
  outboxSteps: BusinessOperationOutboxStep[] = [
    "refresh_assessment_projection",
  ],
): CommitBusinessOperationInput {
  return {
    operationKind: "submit_work_revision",
    requestId: "request-submit-r2",
    requestHash,
    scope: {
      sourceSessionId: "demo-xunpu-v2",
      targetSessionId: null,
      artifactId: "artifact-feature-story",
    },
    outboxSteps,
  };
}

function expectCode(code: BusinessOperationError["code"]) {
  return (error: unknown) => (
    error instanceof BusinessOperationError && error.code === code
  );
}

describe("BusinessOperationCoordinator", () => {
  it("commits authority once and completes ordered outbox exactly once", async () => {
    const coordinator = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
      clock(),
    );
    let authorityWrites = 0;
    let projectionWrites = 0;
    const operation = input();
    const execute = () => coordinator.execute(
      operation,
      async () => {
        authorityWrites += 1;
        return { commitRef: "revision-r2" };
      },
      {
        refresh_assessment_projection: async () => {
          projectionWrites += 1;
          return { resultRef: "assessment-projection-r2" };
        },
      },
    );

    const first = await execute();
    const replay = await execute();
    expect(first.phase).toBe("completed");
    expect(first.revision).toBe(2);
    expect(replay).toEqual(first);
    expect(authorityWrites).toBe(1);
    expect(projectionWrites).toBe(1);
  });

  it("rejects one request id reused with a different payload hash", async () => {
    const coordinator = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
      clock(),
    );
    await coordinator.commitAuthority(input(), async () => ({ commitRef: "revision-r2" }));
    await expect(coordinator.commitAuthority(
      input("b".repeat(64)),
      async () => ({ commitRef: "must-not-run" }),
    )).rejects.toSatisfy(expectCode("request_replay_conflict"));
  });

  it("recovers after restart when authority succeeded before its receipt was saved", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-business-ops-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "receipts.jsonl");
    let durableAuthorityWrites = 0;
    let authorityExists = false;
    const first = new BusinessOperationCoordinator(
      new JsonlBusinessOperationReceiptStore(path),
      clock(),
    );
    await expect(first.commitAuthority(input(), async () => {
      if (!authorityExists) {
        authorityExists = true;
        durableAuthorityWrites += 1;
      }
      throw new Error("simulated-process-loss-after-authority");
    })).rejects.toSatisfy(expectCode("recovery_required"));

    const operationId = businessOperationId(input());
    expect((await first.get(operationId))?.phase).toBe("recovery_required");
    const restarted = new BusinessOperationCoordinator(
      new JsonlBusinessOperationReceiptStore(path),
      clock(),
    );
    const committed = await restarted.commitAuthority(input(), async () => {
      if (!authorityExists) {
        authorityExists = true;
        durableAuthorityWrites += 1;
      }
      return { commitRef: "revision-r2" };
    });
    const completed = await restarted.deliverOutbox(committed.operationId, {
      refresh_assessment_projection: async () => ({
        resultRef: "assessment-projection-r2",
      }),
    });
    expect(completed.phase).toBe("completed");
    expect(durableAuthorityWrites).toBe(1);
  });

  it("retries an outbox effect after restart without repeating durable work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-business-ops-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "receipts.jsonl");
    let projectionExists = false;
    let durableProjectionWrites = 0;
    const first = new BusinessOperationCoordinator(
      new JsonlBusinessOperationReceiptStore(path),
      clock(),
    );
    const committed = await first.commitAuthority(
      input(),
      async () => ({ commitRef: "revision-r2" }),
    );
    await expect(first.deliverOutbox(committed.operationId, {
      refresh_assessment_projection: async () => {
        if (!projectionExists) {
          projectionExists = true;
          durableProjectionWrites += 1;
        }
        throw new Error("simulated-process-loss-after-projection");
      },
    })).rejects.toSatisfy(expectCode("recovery_required"));

    const restarted = new BusinessOperationCoordinator(
      new JsonlBusinessOperationReceiptStore(path),
      clock(),
    );
    const completed = await restarted.deliverOutbox(committed.operationId, {
      refresh_assessment_projection: async () => {
        if (!projectionExists) {
          projectionExists = true;
          durableProjectionWrites += 1;
        }
        return { resultRef: "assessment-projection-r2" };
      },
    });
    expect(completed.phase).toBe("completed");
    expect(completed.outbox[0]?.attempts).toBe(2);
    expect(durableProjectionWrites).toBe(1);
  });

  const secondSessionSteps: BusinessOperationOutboxStep[] = [
    "start_second_world",
    "freeze_experience_descriptor",
    "create_learner_membership",
    "create_teacher_membership",
    "activate_control_session",
    "materialize_runtime_bindings",
  ];

  it.each(secondSessionSteps)(
    "recovers every second-session outbox stage after an effect-before-receipt interruption: %s",
    async (failedStep) => {
      const store = new InMemoryBusinessOperationReceiptStore();
      const first = new BusinessOperationCoordinator(store, clock());
      const effects = new Map<BusinessOperationOutboxStep, number>();
      let interrupted = false;
      const operation: CommitBusinessOperationInput = {
        operationKind: "provision_second_session",
        requestId: "teacher-authorization-stage-test",
        requestHash: computeBusinessOperationRequestHash({
          targetSessionId: "session-adaptive-stage-test",
        }),
        scope: {
          sourceSessionId: "session-source-stage-test",
          targetSessionId: "session-adaptive-stage-test",
          artifactId: null,
        },
        outboxSteps: secondSessionSteps,
      };
      const committed = await first.commitAuthority(
        operation,
        async () => ({ commitRef: "session-adaptive-stage-test" }),
      );
      const handlers = Object.fromEntries(secondSessionSteps.map((step) => [
        step,
        async () => {
          if (!effects.has(step)) effects.set(step, 1);
          if (step === failedStep && !interrupted) {
            interrupted = true;
            throw new Error(`interrupted-after-${step}`);
          }
          return { resultRef: `result-${step}` };
        },
      ])) as Record<BusinessOperationOutboxStep, () => Promise<{ resultRef: string }>>;
      await expect(first.deliverOutbox(committed.operationId, handlers))
        .rejects.toSatisfy(expectCode("recovery_required"));

      const restarted = new BusinessOperationCoordinator(store, clock());
      const completed = await restarted.deliverOutbox(
        committed.operationId,
        handlers,
      );
      expect(completed.phase).toBe("completed");
      expect(completed.outbox).toHaveLength(secondSessionSteps.length);
      expect([...effects.values()]).toEqual(secondSessionSteps.map(() => 1));
      expect(completed.outbox.find((item) => item.step === failedStep)?.attempts)
        .toBe(2);
    },
  );

  it("serializes concurrent replays", async () => {
    const coordinator = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
      clock(),
    );
    let authorityWrites = 0;
    let projectionWrites = 0;
    const execute = () => coordinator.execute(
      input(),
      async () => {
        authorityWrites += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { commitRef: "revision-r2" };
      },
      {
        refresh_assessment_projection: async () => {
          projectionWrites += 1;
          return { resultRef: "assessment-projection-r2" };
        },
      },
    );
    const [left, right] = await Promise.all([execute(), execute()]);
    expect(left).toEqual(right);
    expect(authorityWrites).toBe(1);
    expect(projectionWrites).toBe(1);
  });

  it("refuses outbox delivery before authority and missing recovery handlers", async () => {
    const store = new InMemoryBusinessOperationReceiptStore();
    const coordinator = new BusinessOperationCoordinator(store, clock());
    const definition = input();
    const operationId = businessOperationId(definition);
    const failing = new BusinessOperationCoordinator(store, clock());
    await expect(failing.deliverOutbox(operationId, {}))
      .rejects.toSatisfy(expectCode("not_found"));
    const committed = await coordinator.commitAuthority(
      definition,
      async () => ({ commitRef: "revision-r2" }),
    );
    await expect(coordinator.deliverOutbox(committed.operationId, {}))
      .rejects.toSatisfy(expectCode("definition_drift"));
  });

  it("records handler failures even when a nested service uses a business error", async () => {
    const coordinator = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
      clock(),
    );
    const committed = await coordinator.commitAuthority(
      input(),
      async () => ({ commitRef: "revision-r2" }),
    );

    await expect(coordinator.deliverOutbox(committed.operationId, {
      refresh_assessment_projection: async () => {
        throw new BusinessOperationError(
          "definition_drift",
          "simulated nested projection drift",
        );
      },
    })).rejects.toSatisfy(expectCode("recovery_required"));

    expect(await coordinator.get(committed.operationId)).toMatchObject({
      phase: "recovery_required",
      recovery: {
        reasonCode: "definition_drift",
        nextSafeAction: "resume_outbox",
      },
      outbox: [{
        status: "pending",
        attempts: 1,
        lastErrorCode: "definition_drift",
      }],
    });
  });

  it("does not let a restarted clock move durable receipt time backwards", async () => {
    const store = new InMemoryBusinessOperationReceiptStore();
    const future = "2026-09-02T08:00:00.000Z";
    const first = new BusinessOperationCoordinator(
      store,
      () => future,
    );
    const committed = await first.commitAuthority(
      { ...input(), requestedAt: future },
      async () => ({ commitRef: "revision-r2" }),
    );
    const restarted = new BusinessOperationCoordinator(
      store,
      () => "2026-09-01T08:00:00.000Z",
    );
    const completed = await restarted.deliverOutbox(committed.operationId, {
      refresh_assessment_projection: async () => ({
        resultRef: "assessment-projection-r2",
      }),
    });

    expect(completed.updatedAt).toBe(future);
    expect(completed.completedAt).toBe(future);
    expect(completed.outbox[0]?.deliveredAt).toBe(future);
  });

  it("rejects torn and non-append-only receipt logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-business-ops-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "receipts.jsonl");
    await writeFile(path, "{\"kind\":\"business_operation_created\"}", "utf8");
    await expect(new JsonlBusinessOperationReceiptStore(path).list())
      .rejects.toThrow("末尾帧不完整");

    await writeFile(path, `${JSON.stringify({
      kind: "business_operation_revised",
      formatVersion: 1,
      expectedRevision: 0,
      receipt: {},
    })}\n`, "utf8");
    await expect(new JsonlBusinessOperationReceiptStore(path).list())
      .rejects.toThrow("第 1 行损坏");
    expect((await readFile(path, "utf8")).length).toBeGreaterThan(0);
  });
});
