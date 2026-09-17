import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  StudentNotebookV1Schema, StudentNotebookMutationV1Schema,
  type StudentNotebookV1, type StudentNotebookMutationV1, type SubmittedStudentNoteV1,
} from "@ronggang/contracts";

const RecordSchema = z.object({
  principalId: z.string().min(1),
  notebook: StudentNotebookV1Schema,
  receipts: z.array(z.object({ requestId: z.string(), requestHash: z.string() }).strict()).max(120),
}).strict();
type NotebookRecord = z.infer<typeof RecordSchema>;
export class NotebookConflictError extends Error {}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Course-scoped private notes. Only explicitly selected copies leave this store. */
export class StudentNotebookStore {
  readonly #memory = new Map<string, NotebookRecord>();
  readonly #tails = new Map<string, Promise<void>>();
  constructor(readonly options: { directory?: string; now?: () => string } = {}) {}

  #key(principalId: string, courseId: string) { return digest([principalId, courseId]); }
  #empty(principalId: string, courseId: string): NotebookRecord {
    return { principalId, notebook: { schemaVersion: "student-notebook/1.0.0", courseId, revision: 0, notes: [] }, receipts: [] };
  }
  async #load(principalId: string, courseId: string): Promise<NotebookRecord> {
    const key = this.#key(principalId, courseId);
    let record: NotebookRecord;
    if (!this.options.directory) record = this.#memory.get(key) ?? this.#empty(principalId, courseId);
    else {
      try { record = RecordSchema.parse(JSON.parse(await readFile(resolve(this.options.directory, `${key}.json`), "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        record = this.#empty(principalId, courseId);
      }
    }
    if (record.principalId !== principalId || record.notebook.courseId !== courseId) throw new Error("笔记归属与存储位置不一致");
    return structuredClone(record);
  }
  async #save(record: NotebookRecord) {
    const valid = RecordSchema.parse(record), key = this.#key(valid.principalId, valid.notebook.courseId);
    if (!this.options.directory) { this.#memory.set(key, structuredClone(valid)); return; }
    await mkdir(this.options.directory, { recursive: true });
    const temporary = resolve(this.options.directory, `${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(valid), { encoding: "utf8", flag: "wx" });
      await rename(temporary, resolve(this.options.directory, `${key}.json`));
    } finally {
      await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    }
  }
  async read(principalId: string, courseId: string): Promise<StudentNotebookV1> {
    return (await this.#load(principalId, courseId)).notebook;
  }
  async mutate(principalId: string, courseId: string, raw: StudentNotebookMutationV1): Promise<StudentNotebookV1> {
    const input = StudentNotebookMutationV1Schema.parse(raw), key = this.#key(principalId, courseId);
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = previous.then(() => new Promise<void>(done => { release = done; }));
    this.#tails.set(key, tail);
    await previous;
    try {
      const record = await this.#load(principalId, courseId);
      const requestHash = digest({ expectedRevision: input.expectedRevision, action: input.action });
      const prior = record.receipts.find(item => item.requestId === input.requestId);
      if (prior) {
        if (prior.requestHash !== requestHash) throw new NotebookConflictError("同一保存请求不能更换笔记内容");
        return record.notebook;
      }
      if (input.expectedRevision !== record.notebook.revision) throw new NotebookConflictError("笔记已在其他窗口更新，请保留当前草稿并重新同步");
      const now = this.options.now?.() ?? new Date().toISOString(), action = input.action;
      if (action.kind === "remove") record.notebook.notes = record.notebook.notes.filter(note => note.noteId !== action.noteId);
      else {
        const existing = record.notebook.notes.find(note => note.noteId === action.noteId);
        if (existing) Object.assign(existing, { title: action.title, body: action.body, updatedAt: now });
        else {
          if (record.notebook.notes.length >= 120) throw new NotebookConflictError("本课笔记已达120页，请整理现有内容后继续");
          record.notebook.notes.push({ noteId: action.noteId, title: action.title, body: action.body, createdAt: now, updatedAt: now });
        }
      }
      record.notebook.revision += 1;
      record.receipts = [...record.receipts, { requestId: input.requestId, requestHash }].slice(-120);
      await this.#save(record);
      return record.notebook;
    } finally { release(); if (this.#tails.get(key) === tail) this.#tails.delete(key); }
  }
  async selectedCopies(principalId: string, courseId: string, noteIds: readonly string[], expectedRevision?: number): Promise<SubmittedStudentNoteV1[]> {
    if (new Set(noteIds).size !== noteIds.length || noteIds.length > 30) throw new NotebookConflictError("请选择不重复的笔记页");
    const notebook = await this.read(principalId, courseId), submittedAt = this.options.now?.() ?? new Date().toISOString();
    if (expectedRevision !== undefined && notebook.revision !== expectedRevision) throw new NotebookConflictError("笔记已发生修改，请关闭提交窗口并重新查看要附上的内容");
    return noteIds.map(noteId => {
      const note = notebook.notes.find(item => item.noteId === noteId);
      if (!note) throw new NotebookConflictError("所选笔记已不存在，请重新选择");
      return { ...note, submittedAt };
    });
  }
}
