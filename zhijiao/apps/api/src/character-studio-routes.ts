import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CharacterBlueprintV3Schema } from '@ronggang/contracts';
import type { ContentStore } from '@ronggang/content-store';
import { CharacterStudio } from './character-studio.js';
import { TeachingTaskError, type TeachingTaskActor } from './teaching-task-service.js';
const id = z.string().trim().min(1).max(240), author = z.object({ bindingId: id, authorizationSessionId: id, classroomId: id.optional() }).strict();
const mutation = author.extend({ requestId: id, expectedRevision: z.number().int().nonnegative() });
export type TeachingAuthorizer = (request: FastifyRequest, mutation: boolean, context?: z.infer<typeof author>) => Promise<TeachingTaskActor & { profileId: string; teamId: string | null }>;
export async function registerCharacterStudioRoutes(app: FastifyInstance, dependencies: {
  studio: CharacterStudio; authorize: TeachingAuthorizer; store(): Promise<ContentStore>; artDirectory?: string;
}) {
  const memoryArt = new Map<string, Buffer>();
  app.get('/api/v3/character-studio', async request => {
    const query = z.object({ courseId: id, classroomId: id.optional() }).strict().parse(request.query);
    return dependencies.studio.workspace(await dependencies.authorize(request, false), query.courseId);
  });
  app.post('/api/v3/character-studio/:courseId/draft', async request => {
    const { courseId } = z.object({ courseId: id }).strict().parse(request.params);
    const body = mutation.extend({ characters: z.array(CharacterBlueprintV3Schema).max(30) }).strict().parse(request.body);
    return dependencies.studio.save(await dependencies.authorize(request, true, body), courseId, { requestId: body.requestId, expectedRevision: body.expectedRevision, characters: body.characters });
  });
  app.post('/api/v3/character-studio/:courseId/publish', async request => {
    const { courseId } = z.object({ courseId: id }).strict().parse(request.params);
    const body = mutation.extend({ contentHash: z.string().length(64) }).strict().parse(request.body);
    return dependencies.studio.publish(await dependencies.authorize(request, true, body), courseId, { requestId: body.requestId, expectedRevision: body.expectedRevision, contentHash: body.contentHash });
  });
  app.post('/api/v3/character-studio/:courseId/art', { bodyLimit: 3_000_000 }, async request => {
    const { courseId } = z.object({ courseId: id }).strict().parse(request.params);
    const body = author.extend({ dataUrl: z.string().max(2_800_000), name: z.string().trim().min(1).max(120), rightsStatement: z.string().trim().min(5).max(800) }).strict().parse(request.body);
    const actor = await dependencies.authorize(request, true, body);
    await dependencies.studio.workspace(actor, courseId);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(body.dataUrl)) throw new TeachingTaskError('invalid_task', '请上传带透明背景的 PNG 立绘');
    const bytes = Buffer.from(body.dataUrl.split(',')[1]!, 'base64');
    if (bytes.length < 33 || bytes.length > 2_000_000 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || ![4,6].includes(bytes[25]!)) throw new TeachingTaskError('invalid_task', 'PNG 立绘须含透明通道，且不超过 2MB');
    const hash = createHash('sha256').update(bytes).digest('hex'), assetId = `character-art-${createHash('sha256').update(JSON.stringify([courseId,actor.classroomId,hash])).digest('hex').slice(0,32)}`;
    const store = await dependencies.store(), existing = await store.getAsset(assetId);
    if (!existing) {
      if (dependencies.artDirectory) {
        await mkdir(dependencies.artDirectory,{recursive:true});
        try { await writeFile(join(dependencies.artDirectory,`${assetId}.png`),bytes,{flag:'wx'}); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const prior = await readFile(join(dependencies.artDirectory,`${assetId}.png`)); if (!prior.equals(bytes)) throw new Error('人物素材原件校验失败'); }
      } else memoryArt.set(assetId, bytes);
      await store.createAsset({ assetId, courseId, objectKey: `character-art/${assetId}.png`, assetKind:'image',mimeType:'image/png',byteSize:bytes.length,sourceByteHash:hash,
        rightsStatus:'granted', aiDisclosure:'not_applicable', metadata:{kind:'character_studio_art',classroomId:actor.classroomId,principalId:actor.principalId,name:body.name,rightsStatement:body.rightsStatement} });
    }
    return { image:`/api/v3/character-art/${assetId}` };
  });
  app.get('/api/v3/character-art/:assetId', async (request, reply) => {
    const { assetId }=z.object({assetId:z.string().regex(/^character-art-[a-f0-9]{32}$/u)}).strict().parse(request.params);
    const actor = await dependencies.authorize(request,false), asset=await (await dependencies.store()).getAsset(assetId);
    if (!asset || asset.metadata?.kind!=='character_studio_art' || asset.metadata.classroomId!==actor.classroomId || asset.rightsStatus!=='granted') throw new TeachingTaskError('access_denied','人物图片不属于当前班级');
    const bytes=dependencies.artDirectory?await readFile(join(dependencies.artDirectory,`${assetId}.png`)):memoryArt.get(assetId);
    if (!bytes || createHash('sha256').update(bytes).digest('hex')!==asset.sourceByteHash) throw new TeachingTaskError('source_drift','人物图片原件缺失或变化');
    return reply.type('image/png').header('Cache-Control','private, max-age=3600').send(bytes);
  });
}
