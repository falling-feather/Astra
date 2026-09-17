import { createHash } from "node:crypto";
import {verifyPngTeachingDisclosure} from '@ronggang/media-processing';
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FlagshipContentReferenceV4SchemaVersion,
  type FlagshipContentReferenceV4,
} from "@ronggang/contracts";
import { xunpuFlagshipContentV4 } from "@ronggang/course-content";
import {
  FlagshipMediaServiceV4,
  JsonFileFlagshipMediaRevisionStoreV4,
} from "../src/flagship-media-v4.js";
import { registerFlagshipMediaV4Routes } from "../src/flagship-media-v4-routes.js";

const apps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];
const fixedNow = new Date("2026-08-28T13:00:00.000Z");
const assetDirectory = fileURLToPath(new URL(
  "../../web/public/assets/flagship-world/v4/",
  import.meta.url,
));

const contentRef: FlagshipContentReferenceV4 = {
  schemaVersion: FlagshipContentReferenceV4SchemaVersion,
  contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
  courseReleaseRef: {
    courseId: xunpuFlagshipContentV4.courseId,
    releaseId: "course-xunpu-media-test-r4",
    version: 4,
    contentHash: "a".repeat(64),
  },
  scenarioReleaseRef: {
    scenarioId: xunpuFlagshipContentV4.scenarioId,
    version: "4.0.0",
    contentHash: "b".repeat(64),
  },
  simulationReleaseRef: {
    simulationId: "simulation-xunpu-living-world",
    releaseId: "simulation-xunpu-media-test-r4",
    version: 4,
    contentHash: "c".repeat(64),
  },
  contentHash: xunpuFlagshipContentV4.contentHash,
};

async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "ronggang-media-v4-"));
  temporaryDirectories.push(root);
  const recordsDirectory = resolve(root, "records");
  const outputDirectory = resolve(root, "outputs");
  const service = new FlagshipMediaServiceV4({
    store: new JsonFileFlagshipMediaRevisionStoreV4(recordsDirectory),
    flagshipContentRef: contentRef,
    assetDirectory,
    outputDirectory,
    now: () => fixedNow,
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  let authorizeCalls = 0;
  await registerFlagshipMediaV4Routes(app, {
    media: service,
    authorize: ({ bindingId }) => {
      authorizeCalls += 1;
      const audience = bindingId === "binding-teacher" ? "teacher" as const : "student" as const;
      return {
        audience,
        principalId: audience === "student" ? "principal-student" : "principal-teacher",
        actorId: audience === "student" ? "student-reporter" : "teacher-main",
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    void reply.status(error instanceof z.ZodError ? 400 : 409).send({
      error: error instanceof Error ? error.message : "unknown",
    });
  });
  return {
    app,
    service,
    recordsDirectory,
    outputDirectory,
    authorizeCalls: () => authorizeCalls,
  };
}

function cropRequest(requestId: string, expectedRevisionNumber = 0) {
  return {
    bindingId: "binding-student",
    artifactRef: "artifact-multiplatform-package",
    requestId,
    expectedRevisionNumber,
    status: "draft",
    sourceAssetRefs: ["asset-photo-alley-overview-01"],
    operations: [{
      operationKind: "crop",
      inputAssetRef: "asset-photo-alley-overview-01",
      region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      rationale: "裁去边缘无关区域，保留公共巷道的环境信息。",
    }],
    supportingEvidenceRefs: ["evidence-public-alley-boundary"],
    studentEditorialRationale: "使用无可识别人物的项目原创宽景，让首图保留现场感又不越过私人边界。",
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("V4 real media revision routes", () => {
  it("creates an actual cropped file, hashes it and serves immutable preview bytes", async () => {
    const { app, outputDirectory } = await setup();
    const empty = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-media-v4/media-workspace?bindingId=binding-student",
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().workspace).toMatchObject({
      schemaVersion: "flagship-media-workspace/4.0.0",
      processingMode: "actual_file_transform",
      revisions: [],
    });
    expect(empty.json().workspace.catalog).toHaveLength(11);

    const response = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-media-v4/media-revisions",
      payload: cropRequest("request-media-crop-v4"),
    });
    expect(response.statusCode, response.body).toBe(200);
    const revision = response.json().workspace.revisions[0];
    expect(revision).toMatchObject({
      schemaVersion: "media-work-revision/4.0.0",
      revisionNumber: 1,
      parentRevisionRef: null,
      status: "draft",
      transformations: [{ operationKind: "crop", operatorKind: "student" }],
      derivedAssets: [{ mediaKind: "image", mimeType: "image/png" }],
    });
    expect(revision.derivedAssets[0].width).toBeGreaterThan(0);
    expect(revision.derivedAssets[0].height).toBeGreaterThan(0);
    expect(revision.derivedAssets[0].durationMs).toBeNull();
    const asset = revision.derivedAssets[0];
    const outputPath = resolve(outputDirectory, `${asset.assetRef}.png`);
    const bytes = await readFile(outputPath);
    expect(()=>verifyPngTeachingDisclosure(bytes)).not.toThrow();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.contentHash);

    const preview = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/session-media-v4/media-assets/${asset.assetRef}?bindingId=binding-student`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toContain("image/png");
    expect(preview.headers.etag).toBe(`\"${asset.contentHash}\"`);
    expect(createHash("sha256").update(preview.rawPayload).digest("hex"))
      .toBe(asset.contentHash);
  });

  it("preserves immutable revisions across restart and idempotently replays one request", async () => {
    const {
      app,
      recordsDirectory,
      outputDirectory,
    } = await setup();
    const first = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-media-restart/media-revisions",
      payload: cropRequest("request-media-restart-v4"),
    });
    expect(first.statusCode, first.body).toBe(200);
    const firstRevision = first.json().workspace.revisions[0];
    const replay = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-media-restart/media-revisions",
      payload: cropRequest("request-media-restart-v4"),
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().workspace.revisions).toHaveLength(1);
    expect(replay.json().workspace.revisions[0].mediaRevisionId)
      .toBe(firstRevision.mediaRevisionId);

    const restarted = new FlagshipMediaServiceV4({
      store: new JsonFileFlagshipMediaRevisionStoreV4(recordsDirectory),
      flagshipContentRef: contentRef,
      assetDirectory,
      outputDirectory,
      now: () => fixedNow,
    });
    const workspace = await restarted.getWorkspace({
      sessionId: "session-media-restart",
      bindingId: "binding-student",
    });
    expect(workspace.revisions).toHaveLength(1);
    expect(workspace.revisions[0]?.mediaRevisionId).toBe(firstRevision.mediaRevisionId);
    const derived = await restarted.readDerivedAsset({
      sessionId: "session-media-restart",
      bindingId: "binding-student",
      assetRef: firstRevision.derivedAssets[0].assetRef,
    });
    expect(derived.contentHash).toBe(firstRevision.derivedAssets[0].contentHash);
  });

  it("scopes derived previews to the authorized session and learner binding", async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-media-scope/media-revisions",
      payload: cropRequest("request-media-scope-v4"),
    });
    expect(created.statusCode, created.body).toBe(200);
    const assetRef = created.json().workspace.revisions[0].derivedAssets[0].assetRef;

    const sameOwner = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/session-media-scope/media-assets/${assetRef}?bindingId=binding-student`,
    });
    expect(sameOwner.statusCode).toBe(200);

    const otherSession = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/session-media-other/media-assets/${assetRef}?bindingId=binding-student`,
    });
    expect(otherSession.statusCode).toBe(409);
    expect(otherSession.json().error).toContain("派生媒体不存在");

    const otherLearner = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/session-media-scope/media-assets/${assetRef}?bindingId=binding-other`,
    });
    expect(otherLearner.statusCode).toBe(409);
    expect(otherLearner.json().error).toContain("派生媒体不存在");
  });

  it("refuses stale, forged and non-student writes without producing a second revision", async () => {
    const { app, authorizeCalls } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-media-denied/media-revisions",
      payload: cropRequest("request-media-created-v4"),
    });
    expect(created.statusCode).toBe(200);

    const stale = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-media-denied/media-revisions",
      payload: cropRequest("request-media-stale-v4", 0),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toContain("过期版本");

    const beforeExtra = authorizeCalls();
    const extra = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-media-denied/media-revisions",
      payload: { ...cropRequest("request-media-extra-v4", 1), actorId: "forged-admin" },
    });
    expect(extra.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(beforeExtra);

    const teacher = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-media-denied/media-workspace?bindingId=binding-teacher",
    });
    expect(teacher.statusCode).toBe(409);
    const current = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-media-denied/media-workspace?bindingId=binding-student",
    });
    expect(current.json().workspace.revisions).toHaveLength(1);
  });
});
