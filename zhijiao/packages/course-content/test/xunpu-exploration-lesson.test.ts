import { describe, expect, it } from "vitest";
import { xunpuExplorationLesson, validateExplorationLesson } from "../src/xunpu-exploration-lesson.js";
import { xunpuFlagshipContentV4 } from "../src/xunpu-flagship-v4/manifest.js";

describe("published open exploration lesson", () => {
  it("keeps a public investigation possible before any introduction", () => {
    expect(validateExplorationLesson(xunpuExplorationLesson)).toEqual([]);
    const publicNodes = xunpuExplorationLesson.nodes.filter(node => !node.requiresFlag);
    expect(publicNodes.map(node => node.id)).toEqual(expect.arrayContaining([
      "loc-oyster-alley-gate", "loc-waterfront-service-point", "loc-merchant-storefront",
    ]));
    expect(xunpuExplorationLesson.materials.find(material => material.id === "material-notice-board")?.nodeId).toBe("loc-oyster-alley-gate");
  });

  it("gives every existing character a distinct job, knowledge boundary and usable topics", () => {
    for (const npc of xunpuFlagshipContentV4.cast) {
      const person = xunpuExplorationLesson.people.find(person => person.id === npc.entityId);
      expect(person, npc.displayName).toBeDefined();
      expect(person!.topics.length).toBeGreaterThanOrEqual(3);
      expect(person!.unknown.length).toBeGreaterThan(0);
      expect(person!.activity).not.toBe(person!.goal);
    }
    expect(new Set(xunpuExplorationLesson.people.map(person => person.greeting)).size).toBe(10);
  });

  it("rejects unavailable source references and impossible branches before publication", () => {
    const changed = structuredClone(xunpuExplorationLesson);
    changed.people[0]!.topics[0]!.materialIds.push("missing-original");
    changed.nodes[0]!.requiresFlag = "never-established";
    expect(validateExplorationLesson(changed)).toEqual(expect.arrayContaining([
      expect.stringContaining("missing-original"), expect.stringContaining("never-established"),
    ]));
  });
});
