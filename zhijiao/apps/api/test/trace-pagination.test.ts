import { describe, expect, it } from "vitest";
import type {
  SessionTraceProjection,
  TraceLink,
  TraceRecord,
} from "@ronggang/contracts";
import {
  DEFAULT_TRACE_PAGE_LIMIT,
  MAX_TRACE_PAGE_LIMIT,
  TracePaginationCursorError,
  paginateSessionTrace,
} from "../src/trace-pagination.js";

const baseTime = Date.parse("2026-07-26T08:00:00.000Z");

function traceRecord(
  traceId: string,
  offsetMs: number,
  title = `Record ${traceId}`,
): TraceRecord {
  const timestamp = new Date(baseTime + offsetMs).toISOString();
  return {
    traceId,
    kind: "world_event",
    lane: "world",
    sourceId: `source:${traceId}`,
    timestamp,
    completedAt: timestamp,
    status: "completed",
    title,
    summary: `Summary ${traceId}`,
    correlationId: null,
    stateVersion: offsetMs,
    actorId: null,
    roleId: null,
    agentId: null,
    eventType: null,
    eventId: null,
    outboxId: null,
    taskId: null,
    agentRunId: null,
    nodeId: null,
    invocationId: null,
    toolTaskId: null,
    stepId: null,
    errorCode: null,
    durationMs: null,
    tokenTotal: null,
    attempts: null,
    provider: null,
    providerMode: null,
    model: null,
    details: [],
  };
}

function traceLink(
  linkId: string,
  fromTraceId: string,
  toTraceId: string,
): TraceLink {
  return {
    linkId,
    fromTraceId,
    toTraceId,
    relation: "produces",
  };
}

function snapshot(
  records: TraceRecord[],
  links: TraceLink[] = [],
  overrides: Partial<SessionTraceProjection> = {},
): SessionTraceProjection {
  return {
    sessionId: "session-a",
    generatedAt: "2026-07-26T08:30:00.000Z",
    stateVersion: 12,
    records,
    links,
    summary: {
      worldRecordCount: records.length,
      executionRecordCount: 0,
      eventCount: records.length,
      outboxCount: 0,
      taskCount: 0,
      runCount: 0,
      modelInvocationCount: 0,
      toolStepCount: 0,
      failedCount: 0,
      degradedCount: 0,
      pendingCount: 0,
      totalTokens: 0,
    },
    ...overrides,
  };
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

describe("trace pagination", () => {
  it("walks every record once without omissions or duplicates", () => {
    const input = snapshot([
      traceRecord("trace-5", 50),
      traceRecord("trace-1", 10),
      traceRecord("trace-4", 40),
      traceRecord("trace-2", 20),
      traceRecord("trace-3", 30),
    ]);
    const visited: string[] = [];
    let cursor: string | null = null;
    do {
      const page = paginateSessionTrace(input, { cursor, limit: 2 });
      visited.push(...page.records.map((record) => record.traceId));
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
    } while (cursor);

    expect(visited).toEqual([
      "trace-1",
      "trace-2",
      "trace-3",
      "trace-4",
      "trace-5",
    ]);
    expect(new Set(visited).size).toBe(input.records.length);
  });

  it("orders equal timestamps solely by traceId", () => {
    const input = snapshot([
      traceRecord("trace-z", 0),
      traceRecord("trace-a", 0),
      traceRecord("trace-m", 0),
    ]);

    expect(
      paginateSessionTrace(input).records.map((record) => record.traceId),
    ).toEqual(["trace-a", "trace-m", "trace-z"]);
  });

  it("keeps watermark and cursor stable across reconstruction timestamps", () => {
    const records = [traceRecord("trace-a", 0), traceRecord("trace-b", 1)];
    const first = paginateSessionTrace(snapshot(records), { limit: 1 });
    const restarted = paginateSessionTrace(snapshot(
      structuredClone(records),
      [],
      { generatedAt: "2026-07-26T09:45:00.000Z" },
    ), { limit: 1 });

    expect(restarted.watermark).toBe(first.watermark);
    expect(restarted.nextCursor).toBe(first.nextCursor);
    expect(
      paginateSessionTrace(snapshot(records), {
        cursor: first.nextCursor,
        limit: 1,
      }).records[0]?.traceId,
    ).toBe("trace-b");
  });

  it("uses a 50-record default and converges every numeric limit to 1..200", () => {
    const input = snapshot(
      Array.from(
        { length: 250 },
        (_, index) => traceRecord(`trace-${String(index).padStart(3, "0")}`, index),
      ),
    );

    expect(DEFAULT_TRACE_PAGE_LIMIT).toBe(50);
    expect(MAX_TRACE_PAGE_LIMIT).toBe(200);
    expect(paginateSessionTrace(input).records).toHaveLength(50);
    expect(paginateSessionTrace(input, { limit: 20_000 }).records).toHaveLength(200);
    expect(paginateSessionTrace(input, { limit: 0 }).records).toHaveLength(1);
    expect(paginateSessionTrace(input, { limit: -9 }).records).toHaveLength(1);
    expect(paginateSessionTrace(input, { limit: 2.9 }).records).toHaveLength(2);
    expect(paginateSessionTrace(input, { limit: Number.NaN }).records).toHaveLength(50);
  });

  it("returns internal and authorized one-hop boundary links only", () => {
    const records = [
      traceRecord("a", 0),
      traceRecord("b", 1),
      traceRecord("c", 2),
      traceRecord("d", 3),
    ];
    const input = snapshot(records, [
      traceLink("internal", "a", "b"),
      traceLink("next-boundary", "b", "c"),
      traceLink("remote-boundary", "d", "a"),
      traceLink("off-page", "c", "d"),
      traceLink("dangling", "a", "unknown-record"),
    ]);

    expect(
      paginateSessionTrace(input, { limit: 2 }).links.map((link) => link.linkId),
    ).toEqual(["internal", "next-boundary", "remote-boundary"]);
  });

  it("reports malformed, cross-session, and stale-watermark cursors distinctly", () => {
    const input = snapshot([
      traceRecord("trace-a", 0),
      traceRecord("trace-b", 1),
      traceRecord("trace-c", 2),
    ]);
    const first = paginateSessionTrace(input, { limit: 1 });
    expect(first.nextCursor).not.toBeNull();

    expect(() => paginateSessionTrace(input, {
      cursor: "not+base64url",
    })).toThrowError(expect.objectContaining({
      code: "TRACE_CURSOR_INVALID",
      statusCode: 400,
    }));

    expect(() => paginateSessionTrace(snapshot(
      structuredClone(input.records),
      [],
      { sessionId: "session-b" },
    ), {
      cursor: first.nextCursor,
    })).toThrowError(expect.objectContaining({
      code: "TRACE_CURSOR_SESSION_MISMATCH",
      statusCode: 400,
    }));

    const changed = snapshot(input.records.map((record) => (
      record.traceId === "trace-c"
        ? { ...record, status: "failed" as const }
        : record
    )));
    expect(() => paginateSessionTrace(changed, {
      cursor: first.nextCursor,
    })).toThrowError(expect.objectContaining({
      code: "TRACE_CURSOR_WATERMARK_EXPIRED",
      statusCode: 409,
    }));
  });

  it("keeps cursor payload versioned, offset-free, and content-free", () => {
    const secret = "PRIVATE_TRACE_SUMMARY_MUST_NOT_LEAK";
    const input = snapshot([
      traceRecord("trace-a", 0, secret),
      traceRecord("trace-b", 1),
    ]);
    const cursor = paginateSessionTrace(input, { limit: 1 }).nextCursor;
    expect(cursor).not.toBeNull();
    const decoded = decodeCursor(cursor!);
    const serializedCursor = JSON.stringify(decoded);

    expect(Object.keys(decoded).sort()).toEqual(["id", "s", "t", "v", "w"]);
    expect(decoded.v).toBe(1);
    expect(serializedCursor).not.toContain(secret);
    expect(serializedCursor).not.toContain("summary");
    expect(serializedCursor).not.toContain("details");
    expect(serializedCursor).not.toContain("sourceId");
    expect(serializedCursor).not.toContain("index");
    expect(serializedCursor).not.toContain("offset");
  });

  it("exposes a safe structured error body", () => {
    const error = new TracePaginationCursorError(
      "TRACE_CURSOR_INVALID",
      "The trace cursor is invalid.",
      400,
    );

    expect(error.toJSON()).toEqual({
      code: "TRACE_CURSOR_INVALID",
      message: "The trace cursor is invalid.",
    });
  });
});
