import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateExplorationLesson, type ExplorationLesson } from "@ronggang/course-content";

/** Immutable teaching data, separate from source history: running sessions retain their published lesson hash. */
export async function loadFieldLessonCatalog(directory: string, current: ExplorationLesson): Promise<ExplorationLesson[]> {
  await mkdir(directory, { recursive: true });
  const lessons: ExplorationLesson[] = [];
  for (const file of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/u.test(file)) continue;
    const value: unknown = JSON.parse(await readFile(join(directory, file), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`课程发布快照格式无效：${file}`);
    const lesson = value as ExplorationLesson;
    let errors: string[];
    try { errors = validateExplorationLesson(lesson); }
    catch { throw new Error(`课程发布快照结构不完整：${file}`); }
    if (errors.length || lesson.contentHash !== file.slice(0, -5)) throw new Error(`课程发布快照校验失败：${file}`);
    lessons.push(lesson);
  }
  if (!lessons.some(lesson => lesson.contentHash === current.contentHash)) {
    if (validateExplorationLesson(current).length) throw new Error("当前课程发布内容未通过校验");
    const temporary = join(directory, `${current.contentHash}-${randomUUID()}.tmp`);
    const target = join(directory, `${current.contentHash}.json`);
    try {
      const handle = await open(temporary, "wx");
      try { await handle.writeFile(JSON.stringify(current) + "\n", "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
    lessons.push(structuredClone(current));
  }
  return lessons;
}
