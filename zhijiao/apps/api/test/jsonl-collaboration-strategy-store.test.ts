import {
  appendFile,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CollaborationStrategyService,
  sha256Canonical,
} from "../src/collaboration-strategy-store.js";
import {
  JsonlCollaborationStrategyStore,
} from "../src/jsonl-collaboration-strategy-store.js";
import { collaborationStrategyContent } from "./collaboration-strategy.fixture.js";

const teacher = {
  actorId: "teacher-main",
  actorKind: "teacher",
} as const;
const now = "2026-07-30T16:30:00.000Z";

async function makePath(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "ronggang-collaboration-strategy-")),
    "strategies.jsonl",
  );
}

function service(path: string): CollaborationStrategyService {
  return new CollaborationStrategyService(
    new JsonlCollaborationStrategyStore(path),
    { now: () => now },
  );
}

describe("JsonlCollaborationStrategyStore", () => {
  it("persists and recovers an immutable strategy plus teacher governance", async () => {
    const path = await makePath();
    const first = service(path);
    const draft = await first.createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: collaborationStrategyContent(),
    }, teacher);
    await first.transitionGovernance(
      draft.strategyId,
      draft.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: draft.contentHash,
        action: "approve",
        reason: "教师确认固定暴雨切片的策略依据和权限。",
      },
      teacher,
    );

    const reopened = service(path);
    const recovered = await reopened.get(draft.strategyId, draft.version);
    expect(recovered).toMatchObject({
      strategyId: draft.strategyId,
      version: 1,
      contentHash: draft.contentHash,
      governance: {
        status: "approved",
        revision: 1,
        latestReview: {
          action: "approve",
          teacherActorId: "teacher-main",
        },
      },
    });
    expect(await reopened.list({ status: "approved" })).toHaveLength(1);

    const frames = (await readFile(path, "utf8")).trimEnd().split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.sequence)).toEqual([1, 2]);
    expect(frames[0]?.previousFrameHash).toBeNull();
    expect(frames[1]?.previousFrameHash).toBe(frames[0]?.frameHash);
  });

  it("serializes competing writers and stores only one version", async () => {
    const path = await makePath();
    const first = service(path);
    const second = service(path);
    const results = await Promise.allSettled([
      first.createDraft({
        strategyId: "strategy-rain-collaboration",
        version: 1,
        content: collaborationStrategyContent(),
      }, teacher),
      second.createDraft({
        strategyId: "strategy-rain-collaboration",
        version: 1,
        content: collaborationStrategyContent({
          recommendationSummary: "冲突写入不得覆盖第一条不可变版本。",
        }),
      }, teacher),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await service(path).list()).toHaveLength(1);
    expect((await readFile(path, "utf8")).trimEnd().split("\n")).toHaveLength(1);
  });

  it("fails closed on content-hash drift even when the frame hash is valid", async () => {
    const path = await makePath();
    await service(path).createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: collaborationStrategyContent(),
    }, teacher);
    const frames = (await readFile(path, "utf8")).trimEnd().split("\n");
    const firstFrame = JSON.parse(frames[0]!) as {
      frameHash: string;
      record: {
        content: { recommendationSummary: string };
      };
    };
    firstFrame.record.content.recommendationSummary = "被外部篡改的合法 JSON";
    const { frameHash: _frameHash, ...unsignedFrame } = firstFrame;
    firstFrame.frameHash = sha256Canonical(unsignedFrame);
    const corrupted = `${JSON.stringify(firstFrame)}\n`;
    await writeFile(path, corrupted, "utf8");

    await expect(service(path).list()).rejects.toMatchObject({
      code: "corrupted_log",
    });
    expect(await readFile(path, "utf8")).toBe(corrupted);
  });

  it("fails closed on a torn final frame instead of truncating it", async () => {
    const path = await makePath();
    await service(path).createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: collaborationStrategyContent(),
    }, teacher);
    await appendFile(
      path,
      '{"schemaVersion":1,"sequence":2,"kind":"governance_changed"',
      "utf8",
    );
    const corrupted = await readFile(path, "utf8");

    await expect(service(path).list()).rejects.toMatchObject({
      code: "corrupted_log",
    });
    expect(await readFile(path, "utf8")).toBe(corrupted);
  });
});
