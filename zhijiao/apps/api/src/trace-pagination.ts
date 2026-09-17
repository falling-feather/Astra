import { createHash } from "node:crypto";
import type {
  SessionTraceProjection,
  TraceLink,
  TraceRecord,
} from "@ronggang/contracts";

export const DEFAULT_TRACE_PAGE_LIMIT = 50;
export const MAX_TRACE_PAGE_LIMIT = 200;

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 4_096;

export type TracePaginationCursorErrorCode =
  | "TRACE_CURSOR_INVALID"
  | "TRACE_CURSOR_SESSION_MISMATCH"
  | "TRACE_CURSOR_WATERMARK_EXPIRED";

export class TracePaginationCursorError extends Error {
  readonly name = "TracePaginationCursorError";

  constructor(
    readonly code: TracePaginationCursorErrorCode,
    message: string,
    readonly statusCode: 400 | 409,
  ) {
    super(message);
  }

  toJSON(): { code: TracePaginationCursorErrorCode; message: string } {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

export interface PaginateSessionTraceOptions {
  cursor?: string | null;
  limit?: number;
}

export interface SessionTracePage {
  sessionId: string;
  generatedAt: string;
  stateVersion: number;
  records: TraceRecord[];
  /**
   * A safe one-hop causal view: every returned link has both endpoints in the
   * authorized snapshot and at least one endpoint in this page. This includes
   * internal page links and boundary links needed to continue causal context,
   * while excluding unrelated off-page links.
   */
  links: TraceLink[];
  nextCursor: string | null;
  hasMore: boolean;
  watermark: string;
}

interface TraceCursorV1 {
  v: 1;
  s: string;
  w: string;
  t: string;
  id: string;
}

function compareString(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRecords(left: TraceRecord, right: TraceRecord): number {
  const timestampDifference = Date.parse(left.timestamp)
    - Date.parse(right.timestamp);
  return timestampDifference || compareString(left.traceId, right.traceId);
}

function compareRecordToCursor(
  record: TraceRecord,
  cursor: TraceCursorV1,
): number {
  const timestampDifference = Date.parse(record.timestamp)
    - Date.parse(cursor.t);
  return timestampDifference || compareString(record.traceId, cursor.id);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_TRACE_PAGE_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_TRACE_PAGE_LIMIT;
  return Math.min(MAX_TRACE_PAGE_LIMIT, Math.max(1, Math.floor(limit)));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareString)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sessionFingerprint(sessionId: string): string {
  return hash(`trace-session.v1:${sessionId}`);
}

function createWatermark(
  snapshot: SessionTraceProjection,
  records: readonly TraceRecord[],
): string {
  const links = [...snapshot.links].sort(
    (left, right) => compareString(left.linkId, right.linkId),
  );
  const digest = hash(stableJson({
    sessionId: snapshot.sessionId,
    stateVersion: snapshot.stateVersion,
    records,
    links,
    summary: snapshot.summary,
  }));
  return `trace-watermark.v1.${digest}`;
}

function encodeCursor(cursor: TraceCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function invalidCursor(): TracePaginationCursorError {
  return new TracePaginationCursorError(
    "TRACE_CURSOR_INVALID",
    "The trace cursor is invalid.",
    400,
  );
}

function decodeCursor(encoded: string): TraceCursorV1 {
  if (
    encoded.length === 0
    || encoded.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw invalidCursor();
  }
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw invalidCursor();
    }
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input).sort(compareString);
    if (
      keys.join(",") !== "id,s,t,v,w"
      || input.v !== CURSOR_VERSION
      || typeof input.s !== "string"
      || input.s.length !== 43
      || typeof input.w !== "string"
      || !input.w.startsWith("trace-watermark.v1.")
      || typeof input.t !== "string"
      || !Number.isFinite(Date.parse(input.t))
      || typeof input.id !== "string"
      || input.id.length === 0
    ) {
      throw invalidCursor();
    }
    return {
      v: CURSOR_VERSION,
      s: input.s,
      w: input.w,
      t: input.t,
      id: input.id,
    };
  } catch (error) {
    if (error instanceof TracePaginationCursorError) throw error;
    throw invalidCursor();
  }
}

/**
 * Deterministically pages an already authorized session trace snapshot.
 *
 * Sorting is exclusively timestamp + traceId. The cursor contains only the
 * version, a one-way session fingerprint, the snapshot watermark, and the last
 * stable sort key; it never contains record content or an array offset.
 */
export function paginateSessionTrace(
  snapshot: SessionTraceProjection,
  options: PaginateSessionTraceOptions = {},
): SessionTracePage {
  const records = [...snapshot.records].sort(compareRecords);
  const watermark = createWatermark(snapshot, records);
  const limit = normalizeLimit(options.limit);
  let start = 0;

  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    if (cursor.s !== sessionFingerprint(snapshot.sessionId)) {
      throw new TracePaginationCursorError(
        "TRACE_CURSOR_SESSION_MISMATCH",
        "The trace cursor belongs to another session.",
        400,
      );
    }
    if (cursor.w !== watermark) {
      throw new TracePaginationCursorError(
        "TRACE_CURSOR_WATERMARK_EXPIRED",
        "The trace snapshot changed; restart pagination from the first page.",
        409,
      );
    }
    const cursorIndex = records.findIndex((record) => (
      record.timestamp === cursor.t && record.traceId === cursor.id
    ));
    if (cursorIndex < 0 || compareRecordToCursor(records[cursorIndex]!, cursor) !== 0) {
      throw invalidCursor();
    }
    start = cursorIndex + 1;
  }

  const pageRecords = records.slice(start, start + limit);
  const hasMore = start + pageRecords.length < records.length;
  const lastRecord = pageRecords.at(-1);
  const nextCursor = hasMore && lastRecord
    ? encodeCursor({
      v: CURSOR_VERSION,
      s: sessionFingerprint(snapshot.sessionId),
      w: watermark,
      t: lastRecord.timestamp,
      id: lastRecord.traceId,
    })
    : null;

  const snapshotRecordIds = new Set(records.map((record) => record.traceId));
  const pageRecordIds = new Set(pageRecords.map((record) => record.traceId));
  const links = snapshot.links
    .filter((link) => (
      snapshotRecordIds.has(link.fromTraceId)
      && snapshotRecordIds.has(link.toTraceId)
      && (
        pageRecordIds.has(link.fromTraceId)
        || pageRecordIds.has(link.toTraceId)
      )
    ))
    .sort((left, right) => compareString(left.linkId, right.linkId));

  return {
    sessionId: snapshot.sessionId,
    generatedAt: snapshot.generatedAt,
    stateVersion: snapshot.stateVersion,
    records: pageRecords,
    links,
    nextCursor,
    hasMore,
    watermark,
  };
}
