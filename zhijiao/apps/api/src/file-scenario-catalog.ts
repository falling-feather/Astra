import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PublishedScenarioPackageSchema,
  ScenarioDraftSchema,
} from "@ronggang/contracts";
import {
  type ScenarioCatalogFrame,
  type ScenarioCatalogStore,
} from "@ronggang/scenario-catalog";
import { z } from "zod";

const ScenarioCatalogFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("draft_snapshot"),
    draft: ScenarioDraftSchema,
  }).strict(),
  z.object({
    kind: z.literal("release_published"),
    release: PublishedScenarioPackageSchema,
  }).strict(),
]);

async function appendAndSync(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(content, "utf8");
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

const catalogLocks = new Map<string, Promise<void>>();

export class JsonlScenarioCatalogStore implements ScenarioCatalogStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async load(): Promise<ScenarioCatalogFrame[]> {
    return this.withLock(async () => {
      let body: string;
      try {
        body = await readFile(this.#path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const lines = body.split(/\r?\n/u).filter((line) => line.trim().length > 0);
      const frames: ScenarioCatalogFrame[] = [];
      let repaired = false;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        try {
          frames.push(ScenarioCatalogFrameSchema.parse(JSON.parse(line)));
        } catch (error) {
          if (index === lines.length - 1 && !body.endsWith("\n")) {
            const prefix = body.slice(0, body.lastIndexOf(line));
            await truncateAndSync(this.#path, Buffer.byteLength(prefix, "utf8"));
            repaired = true;
            break;
          }
          throw new Error(`情境目录日志第 ${index + 1} 行损坏`, { cause: error });
        }
      }
      if (body.length > 0 && !body.endsWith("\n") && !repaired) {
        await appendAndSync(this.#path, "\n");
      }
      return frames;
    });
  }

  async append(frame: ScenarioCatalogFrame): Promise<void> {
    return this.withLock(async () => {
      const parsed = ScenarioCatalogFrameSchema.parse(frame);
      await appendAndSync(this.#path, `${JSON.stringify(parsed)}\n`);
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = catalogLocks.get(this.#path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    catalogLocks.set(this.#path, next);
    try {
      return await result;
    } finally {
      if (catalogLocks.get(this.#path) === next) catalogLocks.delete(this.#path);
    }
  }
}
