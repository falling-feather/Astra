import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export const ChineseContentEmbeddingModel = "BAAI/bge-small-zh-v1.5" as const;

export interface EmbeddingBatch {
  modelVersion: string;
  dimension: number;
  vectors: number[][];
}

export interface TextEmbeddingProvider {
  embedDocuments(texts: readonly string[], modelVersion?: string): Promise<EmbeddingBatch>;
  embedQuery(query: string, modelVersion?: string): Promise<{
    modelVersion: string;
    dimension: number;
    vector: number[];
  }>;
}

export class LocalEmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalEmbeddingUnavailableError";
  }
}

function runWorker(
  executable: string,
  workerPath: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [workerPath], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const onAbort = () => {
      child.kill();
      fail(new LocalEmbeddingUnavailableError("embedding worker cancelled"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>;
          const error = parsed.error && typeof parsed.error === "object" ? parsed.error as Record<string, unknown> : {};
          reject(new LocalEmbeddingUnavailableError(
            typeof error.message === "string" ? error.message : (stderr.trim() || `embedding worker exited with ${code}`),
          ));
        } catch {
          reject(new LocalEmbeddingUnavailableError(stderr.trim() || `embedding worker exited with ${code}`));
        }
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (!parsed || typeof parsed !== "object") throw new Error("embedding worker returned a non-object");
        const record = parsed as Record<string, unknown>;
        if (record.ok !== true) {
          const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
          throw new Error(typeof error.message === "string" ? error.message : "embedding worker failed");
        }
        resolvePromise(record);
      } catch (error) {
        reject(new LocalEmbeddingUnavailableError(error instanceof Error ? error.message : String(error)));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export class LocalFastEmbedProvider implements TextEmbeddingProvider {
  readonly #pythonExecutable: string;
  readonly #workerPath: string;
  readonly #modelDir: string;
  #workerQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    pythonExecutable?: string;
    workerPath?: string;
    modelDir?: string;
  } = {}) {
    this.#pythonExecutable = options.pythonExecutable
      ?? process.env.RONGGANG_AI025_PYTHON
      ?? "python";
    this.#workerPath = resolve(
      options.workerPath ?? join(process.cwd(), "packages/context-engine/worker/embedding_worker.py"),
    );
    this.#modelDir = resolve(
      options.modelDir
        ?? process.env.RONGGANG_AI025_MODEL_DIR
        ?? join(process.env.LOCALAPPDATA ?? tmpdir(), "ronggang-ai025-models"),
    );
  }

  async embedDocuments(texts: readonly string[], modelVersion = ChineseContentEmbeddingModel): Promise<EmbeddingBatch> {
    if (texts.length === 0) return { modelVersion, dimension: 0, vectors: [] };
    const payload = {
      modelVersion,
      cacheDir: this.#modelDir,
      texts: [...texts],
    };
    // Queries and indexing share one model worker so concurrent requests do not multiply model memory.
    const operation = this.#workerQueue.then(() => runWorker(this.#pythonExecutable, this.#workerPath, payload));
    // Keep the queue usable after failure; the caller still receives the original rejected operation.
    this.#workerQueue = operation.then(() => undefined, () => undefined);
    const record = await operation;
    const vectors = Array.isArray(record.vectors)
      ? record.vectors.map((vector) => Array.isArray(vector) ? vector.map(Number) : [])
      : [];
    const dimension = Number(record.dimension ?? vectors[0]?.length ?? 0);
    if (vectors.length !== texts.length || dimension <= 0 || vectors.some((vector) => vector.length !== dimension)) {
      throw new LocalEmbeddingUnavailableError("embedding worker returned an invalid vector batch");
    }
    return {
      modelVersion: String(record.modelVersion ?? modelVersion),
      dimension,
      vectors,
    };
  }

  async embedQuery(query: string, modelVersion = ChineseContentEmbeddingModel): Promise<{
    modelVersion: string;
    dimension: number;
    vector: number[];
  }> {
    const batch = await this.embedDocuments([query], modelVersion);
    return {
      modelVersion: batch.modelVersion,
      dimension: batch.dimension,
      vector: batch.vectors[0]!,
    };
  }
}
