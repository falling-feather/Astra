import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ScenarioCatalog,
  createSeedRelease,
} from "@ronggang/scenario-catalog";
import { demoScenario } from "@ronggang/world-core";
import { JsonlScenarioCatalogStore } from "../src/file-scenario-catalog.js";

describe("JsonlScenarioCatalogStore", () => {
  it("persists immutable releases and repairs a torn final frame", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "ronggang-scenario-catalog-"));
    const path = resolve(directory, "scenario-catalog.jsonl");
    try {
      const seed = createSeedRelease({
        releaseId: "release-demo-baseline",
        package: demoScenario,
      });
      const catalog = new ScenarioCatalog(new JsonlScenarioCatalogStore(path));
      await catalog.initialize([seed]);
      await catalog.copyRelease({
        releaseId: seed.ref.releaseId,
        actorId: "teacher-main",
        draftId: "draft-persisted",
      });
      await appendFile(path, "{\"kind\":\"draft_snapshot\"", "utf8");

      const recovered = new ScenarioCatalog(new JsonlScenarioCatalogStore(path));
      await recovered.initialize();
      expect(recovered.getRelease(seed.ref.releaseId).ref.contentHash).toBe(seed.ref.contentHash);
      expect(recovered.getDraft("draft-persisted").sourceRef?.releaseId).toBe(seed.ref.releaseId);
      expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
