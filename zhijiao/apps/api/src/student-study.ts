import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { StudentStudyV3Schema, StudyRunV3Schema, StartStudyV3Schema, CancelStudyV3Schema, CompleteStudyV3Schema, type CompleteStudyV3, type StudentStudyV3, type StudyRunV3, type StartStudyV3, type StartStudyResultV3, type CancelStudyV3 } from "@ronggang/contracts";

export interface StudyOwner { principalId: string; profileId: string; classroomId: string; displayName: string }
const OwnerSchema = z.object({ principalId: z.string().min(1), profileId: z.string().min(1), classroomId: z.string().min(1), displayName: z.string().min(1) }).strict();
const RecordSchema = z.object({ owner: OwnerSchema, state: StudentStudyV3Schema,
  receipts: z.array(z.object({ requestId: z.string(), requestHash: z.string(), sessionId: z.string().nullable() }).strict()).max(300),
}).strict();
type StudyRecord = z.infer<typeof RecordSchema>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class StudyConflictError extends Error {
  constructor(message: string, readonly state: StudentStudyV3) { super(message); }
}

/** One active learning slot per student; progress and submitted work retain their original owners. */
export class StudentStudyStore {
  readonly #memory = new Map<string, StudyRecord>();
  readonly #tails = new Map<string, Promise<void>>();
  constructor(readonly options: { directory?: string; now?: () => string;
    legacyRuns?: (owner: StudyOwner) => Promise<StudyRunV3[]>;
    isCompleted?: (run: StudyRunV3, owner: StudyOwner) => Promise<boolean>;
    canComplete?: (run: StudyRunV3,owner:StudyOwner) => Promise<boolean>;
  } = {}) {}
  #now() { return this.options.now?.() ?? new Date().toISOString(); }
  #key(principalId: string) { return hash(principalId); }
  async #load(owner: StudyOwner): Promise<StudyRecord> {
    const key = this.#key(owner.principalId);
    let saved: StudyRecord | undefined;
    if (!this.options.directory) saved = this.#memory.get(key);
    else {
      try { saved = RecordSchema.parse(JSON.parse(await readFile(resolve(this.options.directory, `${key}.json`), "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (saved) {
      if (saved.owner.principalId !== owner.principalId || saved.owner.classroomId !== owner.classroomId) throw new Error("学习记录的学生归属不一致");
      return structuredClone(saved);
    }
    const legacy = (await this.options.legacyRuns?.(owner) ?? []).map(run => StudyRunV3Schema.parse(run))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const current = legacy.find(run => run.status === "active") ?? null;
    const runs = [...new Map(legacy.map(run => [run.sessionId, run.status === "active" && run !== current ? { ...run, status: "legacy" as const } : run])).values()];
    const safeOwner = { principalId: owner.principalId, profileId: owner.profileId, classroomId: owner.classroomId, displayName: owner.displayName };
    const record: StudyRecord = { owner: safeOwner, state: { schemaVersion: "student-study/3.0.0", revision: 0, currentSessionId: current?.sessionId ?? null, runs }, receipts: [] };
    await this.#write(record);
    return record;
  }
  async #write(raw: StudyRecord) {
    const record = RecordSchema.parse(raw), key = this.#key(record.owner.principalId);
    if (!this.options.directory) { this.#memory.set(key, structuredClone(record)); return; }
    await mkdir(this.options.directory, { recursive: true });
    const temporary = resolve(this.options.directory, `${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
      await rename(temporary, resolve(this.options.directory, `${key}.json`));
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }
  async #serial<T>(owner: StudyOwner, run: () => Promise<T>): Promise<T> {
    const key = this.#key(owner.principalId), prior = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; }), tail = prior.then(() => done);
    this.#tails.set(key, tail); await prior;
    try { return await run(); } finally { release(); if (this.#tails.get(key) === tail) this.#tails.delete(key); }
  }
  async #refreshCompletion(record: StudyRecord) {
    const current = record.state.runs.find(run => run.sessionId === record.state.currentSessionId);
    if (current && await this.options.isCompleted?.(current, record.owner)) {
      current.status = "completed"; current.endedAt = this.#now();
      record.state.currentSessionId = null; record.state.revision += 1; await this.#write(record);
    }
    return record;
  }
  async read(owner: StudyOwner): Promise<StudentStudyV3> {
    return this.#serial(owner, async () => (await this.#refreshCompletion(await this.#load(owner))).state);
  }
  async start(owner: StudyOwner, raw: StartStudyV3, courseId: string, prepare: (context:{practiceOrdinal:number}) => Promise<StudyRunV3>): Promise<StartStudyResultV3> {
    const input = StartStudyV3Schema.parse(raw);
    return this.#serial(owner, async () => {
      const record = await this.#refreshCompletion(await this.#load(owner)), state = record.state;
      const requestHash = hash(input), receipt = record.receipts.find(item => item.requestId === input.requestId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw new StudyConflictError("同一开课请求不能更换课程或放弃确认", state);
        const run = state.runs.find(item => item.sessionId === receipt.sessionId);
        if (!run) throw new Error("开课收据对应的场次不存在");
        return { state, run };
      }
      const current = state.runs.find(run => run.sessionId === state.currentSessionId);
      if (current?.courseRef.courseId === courseId && current.taskReleaseId === input.taskReleaseId && !input.replace) return { state, run: current };
      if (current && (!input.replace || input.replace.sessionId !== current.sessionId || input.replace.expectedRevision !== state.revision)) {
        throw new StudyConflictError(`你还有未完成的课程：${current.title}`, state);
      }
      if (input.replace && (!current || input.replace.sessionId !== current.sessionId || input.replace.expectedRevision !== state.revision)) {
        throw new StudyConflictError("当前课程已发生变化，请重新查看再决定是否放弃", state);
      }
      // Validate and prepare the target first. A failed preparation leaves the old course active.
      const prepared = StudyRunV3Schema.parse(await prepare({practiceOrdinal:state.runs.filter(run=>run.courseRef.courseId===courseId).length}));
      if (prepared.status !== "active" || prepared.courseRef.courseId !== courseId || prepared.courseRef.releaseId !== input.courseReleaseId || prepared.taskReleaseId !== input.taskReleaseId
        || state.runs.some(run => run.sessionId === prepared.sessionId)) throw new Error("准备的学习场次与本次开课请求不一致");
      if (current) { current.status = "cancelled"; current.endedAt = this.#now(); }
      state.runs.unshift(prepared); state.currentSessionId = prepared.sessionId; state.revision += 1;
      record.receipts = [...record.receipts, { requestId: input.requestId, requestHash, sessionId: prepared.sessionId }].slice(-300);
      await this.#write(record);
      return { state, run: prepared };
    });
  }
  async cancel(owner: StudyOwner, raw: CancelStudyV3): Promise<StudentStudyV3> {
    return this.#end(owner, CancelStudyV3Schema.parse(raw), "cancelled");
  }
  async complete(owner: StudyOwner, raw: CompleteStudyV3): Promise<StudentStudyV3> {
    return this.#end(owner, CompleteStudyV3Schema.parse(raw), "completed");
  }
  async #end(owner: StudyOwner, input: CancelStudyV3 | CompleteStudyV3, status: "cancelled" | "completed"): Promise<StudentStudyV3> {
    return this.#serial(owner, async () => {
      const record = await this.#load(owner), state = record.state, requestHash = hash(input);
      const receipt = record.receipts.find(item => item.requestId === input.requestId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw new StudyConflictError("同一放弃请求不能更换内容", state);
        return state;
      }
      const current = state.runs.find(run => run.sessionId === state.currentSessionId);
      if (!current || current.sessionId !== input.sessionId || state.revision !== input.expectedRevision) throw new StudyConflictError("当前课程已变化，请重新确认", state);
      if (status === "completed" && !await this.options.canComplete?.(current,record.owner)) throw new StudyConflictError("请先完成本课程要求的作品并送审，再结束课程", state);
      current.status = status; current.endedAt = this.#now(); state.currentSessionId = null; state.revision += 1;
      record.receipts = [...record.receipts, { requestId: input.requestId, requestHash, sessionId: current.sessionId }].slice(-300);
      await this.#write(record); return state;
    });
  }
  async assertWritable(owner: StudyOwner, sessionId: string): Promise<void> {
    const state = await this.read(owner), known = state.runs.find(run => run.sessionId === sessionId);
    if (known && (known.status !== "active" || state.currentSessionId !== sessionId)) throw new StudyConflictError("该课程已结束或只保留历史记录，可以查看但不能继续现场操作", state);
    if (state.currentSessionId && state.currentSessionId !== sessionId) throw new StudyConflictError("请先完成或放弃当前课程，再进入另一门课程", state);
    if (!known && (sessionId.startsWith("study-session-") || sessionId.startsWith("training-adaptive-v4-"))) throw new StudyConflictError("本场尚未进入在学记录，请先从课程档案或后续训练入口开始", state);
  }
  async students(classroomId: string): Promise<Array<{ owner: StudyOwner; state: StudentStudyV3 }>> {
    let records: StudyRecord[];
    if (!this.options.directory) records = [...this.#memory.values()];
    else {
      let names: string[];
      try { names = await readdir(this.options.directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return []; }
      records = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => RecordSchema.parse(JSON.parse(await readFile(resolve(this.options.directory!, name), "utf8")))));
    }
    return records.filter(record => record.owner.classroomId === classroomId).map(record => ({ owner: structuredClone(record.owner), state: structuredClone(record.state) }));
  }
}
