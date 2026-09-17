import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  GoldPilotStudyStateSchema,
  InMemoryGoldPilotStudyStore,
  type GoldPilotStudyState,
  type GoldPilotStudyStore,
} from "@ronggang/agent-runtime";
import {
  GoldPilotAnalysisReportSchema,
  GoldPilotRunReceiptSchema,
  GoldPilotWorkloadSegmentSchema,
} from "@ronggang/contracts";
import { z } from "zod";

const IsoDateSchema = z.string().datetime();

const GoldPilotStudyFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("study_created"),
    state: GoldPilotStudyStateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("workload_segment_started"),
    studyId: z.string().regex(/^gps_[a-f0-9]{24}$/u),
    expectedRevision: z.number().int().positive(),
    segment: GoldPilotWorkloadSegmentSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("workload_segment_finished"),
    studyId: z.string().regex(/^gps_[a-f0-9]{24}$/u),
    expectedRevision: z.number().int().positive(),
    segment: GoldPilotWorkloadSegmentSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("run_finalized"),
    studyId: z.string().regex(/^gps_[a-f0-9]{24}$/u),
    expectedRevision: z.number().int().positive(),
    receipt: GoldPilotRunReceiptSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("analysis_report_frozen"),
    studyId: z.string().regex(/^gps_[a-f0-9]{24}$/u),
    expectedRevision: z.number().int().positive(),
    report: GoldPilotAnalysisReportSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
]);

type GoldPilotStudyFrame = z.infer<typeof GoldPilotStudyFrameSchema>;

const pathLocks = new Map<string, Promise<void>>();
const pathRevisions = new Map<string, number>();

async function appendAndSync(
  path: string,
  frame: GoldPilotStudyFrame,
): Promise<void> {
  const parsed = GoldPilotStudyFrameSchema.parse(frame);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendNewlineAndSync(path: string): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile("\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function truncateAndSync(path: string, byteLength: number): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.truncate(byteLength);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes: Uint8Array, lineNumber: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(
      `教学试点日志第 ${lineNumber} 行损坏：不是有效 UTF-8`,
      { cause: error },
    );
  }
}

function parseFrame(line: string, lineNumber: number): GoldPilotStudyFrame {
  try {
    return GoldPilotStudyFrameSchema.parse(JSON.parse(line));
  } catch (error) {
    throw new Error(`教学试点日志第 ${lineNumber} 行损坏`, {
      cause: error,
    });
  }
}

async function readFrames(path: string): Promise<GoldPilotStudyFrame[]> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (body.length === 0) return [];
  const frames: GoldPilotStudyFrame[] = [];
  let lineStart = 0;
  let lineNumber = 1;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== 0x0a) continue;
    let lineEnd = index;
    if (lineEnd > lineStart && body[lineEnd - 1] === 0x0d) lineEnd -= 1;
    const line = decodeUtf8(body.subarray(lineStart, lineEnd), lineNumber);
    if (line.length === 0) {
      throw new Error(
        `教学试点日志第 ${lineNumber} 行损坏：不允许空帧`,
      );
    }
    frames.push(parseFrame(line, lineNumber));
    lineStart = index + 1;
    lineNumber += 1;
  }
  if (lineStart === body.length) return frames;
  let tailFrame: GoldPilotStudyFrame;
  try {
    const tail = decodeUtf8(body.subarray(lineStart), lineNumber);
    tailFrame = parseFrame(tail, lineNumber);
  } catch {
    await truncateAndSync(path, lineStart);
    return frames;
  }
  frames.push(tailFrame);
  await appendNewlineAndSync(path);
  return frames;
}

async function replayFrame(
  store: InMemoryGoldPilotStudyStore,
  frame: GoldPilotStudyFrame,
): Promise<void> {
  switch (frame.kind) {
    case "study_created":
      await store.create(frame.state);
      return;
    case "workload_segment_started":
      await store.startWorkloadSegment({
        studyId: frame.studyId,
        expectedRevision: frame.expectedRevision,
        segment: frame.segment,
        updatedAt: frame.updatedAt,
      });
      return;
    case "workload_segment_finished":
      await store.finishWorkloadSegment({
        studyId: frame.studyId,
        expectedRevision: frame.expectedRevision,
        segment: frame.segment,
        updatedAt: frame.updatedAt,
      });
      return;
    case "run_finalized":
      await store.finalizeRun({
        studyId: frame.studyId,
        expectedRevision: frame.expectedRevision,
        receipt: frame.receipt,
        updatedAt: frame.updatedAt,
      });
      return;
    case "analysis_report_frozen":
      await store.freezeAnalysisReport({
        studyId: frame.studyId,
        expectedRevision: frame.expectedRevision,
        report: frame.report,
        updatedAt: frame.updatedAt,
      });
  }
}

/**
 * Append-only, fsync-backed adapter for the deidentified pilot-study state.
 *
 * Only the creation frame contains the full preregistration. Later frames
 * carry one workload segment or one frozen aggregate receipt, so raw world
 * events and free-text participant material never enter this journal.
 */
export class JsonlGoldPilotStudyStore implements GoldPilotStudyStore {
  readonly #path: string;
  #cachedStore: InMemoryGoldPilotStudyStore | null = null;
  #cachedRevision = -1;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  create(state: GoldPilotStudyState): Promise<GoldPilotStudyState> {
    return this.#withStore(async (store) => {
      const result = await store.create(state);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "study_created",
        state,
      });
      return result;
    }, true);
  }

  get(studyId: string): Promise<GoldPilotStudyState | null> {
    return this.#withStore((store) => store.get(studyId));
  }

  list(sessionId: string): Promise<GoldPilotStudyState[]> {
    return this.#withStore((store) => store.list(sessionId));
  }

  startWorkloadSegment(input: {
    studyId: string;
    expectedRevision: number;
    segment: Parameters<
      GoldPilotStudyStore["startWorkloadSegment"]
    >[0]["segment"];
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    return this.#withStore(async (store) => {
      const result = await store.startWorkloadSegment(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "workload_segment_started",
        ...input,
      });
      return result;
    }, true);
  }

  finishWorkloadSegment(input: {
    studyId: string;
    expectedRevision: number;
    segment: Parameters<
      GoldPilotStudyStore["finishWorkloadSegment"]
    >[0]["segment"];
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    return this.#withStore(async (store) => {
      const result = await store.finishWorkloadSegment(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "workload_segment_finished",
        ...input,
      });
      return result;
    }, true);
  }

  finalizeRun(input: {
    studyId: string;
    expectedRevision: number;
    receipt: Parameters<GoldPilotStudyStore["finalizeRun"]>[0]["receipt"];
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    return this.#withStore(async (store) => {
      const result = await store.finalizeRun(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "run_finalized",
        ...input,
      });
      return result;
    }, true);
  }

  freezeAnalysisReport(input: {
    studyId: string;
    expectedRevision: number;
    report: Parameters<
      GoldPilotStudyStore["freezeAnalysisReport"]
    >[0]["report"];
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    return this.#withStore(async (store) => {
      const result = await store.freezeAnalysisReport(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "analysis_report_frozen",
        ...input,
      });
      return result;
    }, true);
  }

  async #withStore<T>(
    operation: (store: InMemoryGoldPilotStudyStore) => Promise<T>,
    mutation = false,
  ): Promise<T> {
    const previous = pathLocks.get(this.#path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    pathLocks.set(this.#path, queued);
    await previous;
    try {
      const revision = pathRevisions.get(this.#path) ?? 0;
      if (!this.#cachedStore || this.#cachedRevision !== revision) {
        const store = new InMemoryGoldPilotStudyStore();
        for (const frame of await readFrames(this.#path)) {
          await replayFrame(store, frame);
        }
        this.#cachedStore = store;
        this.#cachedRevision = revision;
      }
      try {
        const result = await operation(this.#cachedStore);
        if (mutation) {
          const nextRevision = (pathRevisions.get(this.#path) ?? 0) + 1;
          pathRevisions.set(this.#path, nextRevision);
          this.#cachedRevision = nextRevision;
        }
        return result;
      } catch (error) {
        if (mutation) {
          this.#cachedStore = null;
          this.#cachedRevision = -1;
        }
        throw error;
      }
    } finally {
      release();
      if (pathLocks.get(this.#path) === queued) {
        pathLocks.delete(this.#path);
      }
    }
  }
}
