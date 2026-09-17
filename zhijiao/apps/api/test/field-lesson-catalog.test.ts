import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { hashCanonical, xunpuExplorationLesson } from "@ronggang/course-content";
import { loadFieldLessonCatalog } from "../src/field-lesson-catalog.js";

describe("immutable field lesson publications", () => {
  it("retains the old lesson when a new lesson is published and does not rewrite either snapshot", async () => {
    const root = fileURLToPath(new URL("../../../.local/", import.meta.url));
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "field-lesson-catalog-"));
    try {
      const { contentHash: _hash, ...draft } = structuredClone(xunpuExplorationLesson);
      draft.version = "1.1.0";
      const coordinator = draft.people.find(person => person.id === "entity-gatekeeper")!;
      coordinator.topics = coordinator.topics.filter(topic => topic.id !== "lin-boundary");
      draft.materials = draft.materials.filter(material => material.id !== "material-resident-consent");
      draft.choices.find(choice => choice.id === "ahuan-scope")!.materialIds = ["material-license-note"];
      const previous = { ...draft, contentHash: hashCanonical(draft) };
      await loadFieldLessonCatalog(directory, previous);
      const before = await readFile(join(directory, `${previous.contentHash}.json`), "utf8");
      const versions = await loadFieldLessonCatalog(directory, xunpuExplorationLesson);
      expect(versions).toHaveLength(2);
      expect(versions.find(lesson => lesson.contentHash === previous.contentHash)?.version).toBe("1.1.0");
      expect(versions.find(lesson => lesson.contentHash === previous.contentHash)?.choices.find(choice => choice.id === "ahuan-scope")?.materialIds).toEqual(["material-license-note"]);
      expect(await readFile(join(directory, `${previous.contentHash}.json`), "utf8")).toBe(before);
      expect(await loadFieldLessonCatalog(directory, xunpuExplorationLesson)).toHaveLength(2);
    } finally {
      const child = relative(root, directory);
      if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("test cleanup outside workspace");
      await rm(directory, { recursive: true, force: true });
    }
  });
});
