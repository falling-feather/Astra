import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("world-core dependency boundary", () => {
  it("does not import runtime, model gateway, or provider adapters", async () => {
    const packageJson = await readFile(resolve(process.cwd(), "package.json"), "utf8");
    const engineSource = await readFile(resolve(process.cwd(), "src/engine.ts"), "utf8");
    for (const forbidden of [
      "@ronggang/agent-runtime",
      "@ronggang/agent-orchestrator",
      "@ronggang/model-gateway",
      "@ronggang/iflytek-adapter",
    ]) {
      expect(packageJson).not.toContain(forbidden);
      expect(engineSource).not.toContain(forbidden);
    }
  });
});
