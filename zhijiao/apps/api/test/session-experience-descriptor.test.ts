import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSessionExperienceDescriptor,
  InMemorySessionExperienceDescriptorStore,
  JsonlSessionExperienceDescriptorStore,
  SessionExperienceDescriptorError,
  SessionExperienceDescriptorService,
  type SessionExperienceRuntimeSnapshot,
} from "../src/session-experience-descriptor.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

function runtime(
  generation: SessionExperienceRuntimeSnapshot["experienceGeneration"] = "flagship_v4",
): SessionExperienceRuntimeSnapshot {
  return {
    sessionId: `session-${generation}`,
    courseReleaseRef: generation === "standard_v2"
      ? null
      : {
          courseId: "course-xunpu-intangible-media",
          releaseId: "course-xunpu-r4",
          version: 4,
          contentHash: "a".repeat(64),
        },
    scenarioReleaseRef: {
      scenarioId: generation === "standard_v2"
        ? "scenario-village-super"
        : "scenario-xunpu-living-world",
      version: generation === "standard_v2" ? "2.0.0" : "4.0.0",
      contentHash: "b".repeat(64),
    },
    experienceGeneration: generation,
  };
}

function descriptor(snapshot: SessionExperienceRuntimeSnapshot) {
  return buildSessionExperienceDescriptor({
    ...snapshot,
    compatibility: snapshot.experienceGeneration === "flagship_v3"
      ? "historical"
      : "current",
    frozenAt: "2026-09-01T00:00:00.000Z",
  });
}

describe("SessionExperienceDescriptorService", () => {
  it.each(["flagship_v4", "flagship_v3", "standard_v2"] as const)(
    "freezes and reads the explicit %s runtime without naming inference",
    async (generation) => {
      const snapshot = runtime(generation);
      const service = new SessionExperienceDescriptorService(
        new InMemorySessionExperienceDescriptorStore(),
        async () => snapshot,
      );
      await expect(service.freeze(descriptor(snapshot))).resolves.toMatchObject({
        sessionId: snapshot.sessionId,
        experienceGeneration: generation,
      });
      await expect(service.get(snapshot.sessionId)).resolves.toMatchObject({
        experienceGeneration: generation,
      });
    },
  );

  it("fails closed when a frozen release hash drifts", async () => {
    let snapshot = runtime();
    const service = new SessionExperienceDescriptorService(
      new InMemorySessionExperienceDescriptorStore(),
      async () => snapshot,
    );
    await service.freeze(descriptor(snapshot));
    snapshot = {
      ...snapshot,
      scenarioReleaseRef: {
        ...snapshot.scenarioReleaseRef,
        contentHash: "f".repeat(64),
      },
    };
    await expect(service.get(snapshot.sessionId)).rejects.toMatchObject({
      code: "version_hash_drift",
    });
  });

  it("rejects an immutable generation rewrite for the same session", async () => {
    const snapshot = runtime();
    const store = new InMemorySessionExperienceDescriptorStore();
    const service = new SessionExperienceDescriptorService(store, async () => snapshot);
    await service.freeze(descriptor(snapshot));
    const rewritten = {
      ...descriptor(snapshot),
      frozenAt: "2026-09-01T01:00:00.000Z",
    };
    await expect(service.freeze(rewritten)).rejects.toBeInstanceOf(
      SessionExperienceDescriptorError,
    );
    await expect(service.freeze(rewritten)).rejects.toMatchObject({
      code: "immutable_conflict",
    });
  });

  it("recovers the exact descriptor from an append-only JSONL store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-descriptor-"));
    temporaryPaths.push(directory);
    const path = join(directory, "session-experience-descriptors.jsonl");
    const snapshot = runtime("standard_v2");
    const first = new SessionExperienceDescriptorService(
      new JsonlSessionExperienceDescriptorStore(path),
      async () => snapshot,
    );
    await first.freeze(descriptor(snapshot));

    const restarted = new SessionExperienceDescriptorService(
      new JsonlSessionExperienceDescriptorStore(path),
      async () => snapshot,
    );
    await expect(restarted.get(snapshot.sessionId)).resolves.toEqual(descriptor(snapshot));
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
  });
});
