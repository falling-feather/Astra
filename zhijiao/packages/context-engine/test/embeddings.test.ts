import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LocalFastEmbedProvider } from "../src/embeddings.js";

describe("AI-025 local embeddings", () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const python = resolve(repositoryRoot, ".local/ai025-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  it.skipIf(!existsSync(python))("generates a persistent-model Chinese query vector", async () => {
    const provider = new LocalFastEmbedProvider({
      pythonExecutable: python,
      workerPath: resolve(repositoryRoot, "packages/context-engine/worker/embedding_worker.py"),
    });
    const result = await provider.embedQuery("如何核验来源并保留页码定位");
    expect(result.modelVersion).toBe("BAAI/bge-small-zh-v1.5");
    expect(result.dimension).toBe(512);
    expect(result.vector).toHaveLength(512);
    expect(result.vector.every((value) => Number.isFinite(value))).toBe(true);
  }, 30_000);
});
