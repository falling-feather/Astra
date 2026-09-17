import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { V2IdentifierSchema } from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import type { FlagshipMediaServiceV4 } from "./flagship-media-v4.js";
import type { AuthorizedSimulationWorldActorV3 } from "./world-simulation-v3-routes.js";

const sessionParamsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();

const assetParamsSchema = sessionParamsSchema.extend({
  assetRef: V2IdentifierSchema,
}).strict();

const workspaceQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
  artifactRef: V2IdentifierSchema.optional(),
}).strict();

const derivedQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();

const emptyQuerySchema = z.object({}).strict();

const regionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().superRefine((region, context) => {
  if (region.x + region.width > 1 || region.y + region.height > 1) {
    context.addIssue({
      code: "custom",
      path: ["width"],
      message: "媒体处理区域不得越过画布边界",
    });
  }
});

const operationShared = {
  inputAssetRef: V2IdentifierSchema,
  rationale: z.string().trim().min(1).max(500),
};

const mediaOperationSchema = z.discriminatedUnion("operationKind", [
  z.object({
    ...operationShared,
    operationKind: z.literal("crop"),
    region: regionSchema,
  }).strict(),
  z.object({
    ...operationShared,
    operationKind: z.literal("trim"),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  }).strict().superRefine((operation, context) => {
    if (operation.endMs <= operation.startMs) {
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "媒体裁切结束时间必须晚于开始时间",
      });
    }
  }),
  z.object({
    ...operationShared,
    operationKind: z.literal("redact"),
    region: regionSchema,
    redactionKind: z.enum(["mask", "mute", "remove_metadata"]),
  }).strict(),
  z.object({
    ...operationShared,
    operationKind: z.literal("replace"),
    replacementAssetRef: V2IdentifierSchema,
    replacementReason: z.enum([
      "consent_withdrawn",
      "rights_scope_mismatch",
      "fact_risk",
      "editorial_choice",
    ]),
  }).strict(),
]);

const createRevisionBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  artifactRef: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  expectedRevisionNumber: z.number().int().nonnegative(),
  status: z.enum(["draft", "locked", "submitted"]),
  sourceAssetRefs: z.array(V2IdentifierSchema).min(1).max(12),
  operations: z.array(mediaOperationSchema).min(1).max(20),
  supportingEvidenceRefs: z.array(V2IdentifierSchema).min(1).max(64),
  studentEditorialRationale: z.string().trim().min(1).max(1_500),
}).strict();

export interface FlagshipMediaV4RouteDependencies {
  media: Pick<
    FlagshipMediaServiceV4,
    "getWorkspace" | "createRevision" | "readDerivedAsset"
  >;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

function assertStudent(authorized: AuthorizedSimulationWorldActorV3): void {
  if (authorized.audience !== "student") {
    throw new PermissionDeniedError("只有当前学生记者可以读写本人融媒体作品版本");
  }
}

export async function registerFlagshipMediaV4Routes(
  app: FastifyInstance,
  dependencies: FlagshipMediaV4RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/media-workspace",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = workspaceQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      assertStudent(authorized);
      return {
        workspace: await dependencies.media.getWorkspace({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          ...(query.artifactRef ? { artifactRef: query.artifactRef } : {}),
        }),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/media-revisions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = createRevisionBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      assertStudent(authorized);
      return {
        workspace: await dependencies.media.createRevision({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          artifactRef: body.artifactRef,
          requestId: body.requestId,
          expectedRevisionNumber: body.expectedRevisionNumber,
          status: body.status,
          sourceAssetRefs: body.sourceAssetRefs,
          operations: body.operations,
          supportingEvidenceRefs: body.supportingEvidenceRefs,
          studentEditorialRationale: body.studentEditorialRationale,
        }),
      };
    },
  );

  app.get<{ Params: { sessionId: string; assetRef: string } }>(
    "/api/v4/sessions/:sessionId/media-assets/:assetRef",
    async (request, reply) => {
      const params = assetParamsSchema.parse(request.params);
      const query = derivedQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      assertStudent(authorized);
      const asset = await dependencies.media.readDerivedAsset({
        sessionId: params.sessionId,
        bindingId: authorized.bindingId,
        assetRef: params.assetRef,
      });
      return reply
        .type(asset.mimeType)
        .header("ETag", `\"${asset.contentHash}\"`)
        .header("Cache-Control", "private, max-age=31536000, immutable")
        .send(asset.bytes);
    },
  );
}
