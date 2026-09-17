import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StartStudyV3Schema, CancelStudyV3Schema, CompleteStudyV3Schema, StudentStudyV3Schema, StartStudyResultV3Schema, EnterPreparedStudyV3Schema, TeacherSubmittedWorksV3Schema, type TeacherSubmittedWorksV3, type EnterPreparedStudyV3, type StudyRunV3 } from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import type { CourseLearningRouteDependencies } from "./course-learning-routes.js";
import type { PublishedStudyActor, PublishedCourseRuntime } from "./published-course-runtime.js";
import { StudentStudyStore, StudyConflictError } from "./student-study.js";

export async function registerStudentStudyRoutes(app: FastifyInstance, dependencies: {
  store: StudentStudyStore; runtime: PublishedCourseRuntime;
  authorize: CourseLearningRouteDependencies["authorizePrincipal"];
  actorFor: (principal: Awaited<ReturnType<CourseLearningRouteDependencies["authorizePrincipal"]>>) => PublishedStudyActor;
  preparedRun?: (actor:PublishedStudyActor,input:EnterPreparedStudyV3)=>Promise<StudyRunV3>;
  submittedWorks?:(actor:PublishedStudyActor,sessionId:string)=>Promise<TeacherSubmittedWorksV3>;
}) {
  const empty = z.object({}).strict();
  app.get<{Params:{sessionId:string}}>('/api/v3/me/study/:sessionId/works',async request=>{
    empty.parse(request.query);const {sessionId}=z.object({sessionId:z.string().min(1).max(256)}).strict().parse(request.params);
    const principal=await dependencies.authorize({request,mutation:false});
    if(principal.subject.role!=='student'||!dependencies.submittedWorks)throw new PermissionDeniedError('只有学生本人可以读取自己的作品');
    const actor=dependencies.actorFor(principal),state=await dependencies.store.read(actor);
    if(!state.runs.some(run=>run.sessionId===sessionId&&run.runtimeKind!=='legacy_course'))throw new PermissionDeniedError('该作品不在当前学生的个人课程记录中');
    return TeacherSubmittedWorksV3Schema.parse(await dependencies.submittedWorks(actor,sessionId));
  });
  app.post('/api/v3/me/study/enter-prepared',async(request,reply)=>{
    empty.parse(request.query);const input=EnterPreparedStudyV3Schema.parse(request.body);
    const principal=await dependencies.authorize({request,mutation:true});
    if(principal.subject.role!=='student'||!dependencies.preparedRun)throw new PermissionDeniedError('只有学生本人可以进入已获授权的后续训练');
    const actor=dependencies.actorFor(principal);
    try{
      const state=await dependencies.store.read(actor);
      if(state.currentSessionId&&state.currentSessionId!==input.sessionId)throw new StudyConflictError('请先回到课程档案，完成或主动放弃当前课程，再进入后续训练。',state);
      if(state.revision!==input.expectedRevision)throw new StudyConflictError('当前课程记录已经变化，请重新读取后继续。',state);
      const prepared=await dependencies.preparedRun(actor,input);
      const result=await dependencies.store.start(actor,{requestId:input.requestId,courseReleaseId:prepared.courseRef.releaseId},prepared.courseRef.courseId,async()=>prepared);
      if(result.run.sessionId!==input.sessionId||result.run.status!=='active')throw new StudyConflictError('该后续训练已结束或在学记录已变化，请回到课程档案查看。',result.state);
      return StartStudyResultV3Schema.parse(result);
    }catch(error){if(!(error instanceof StudyConflictError))throw error;return reply.code(409).send({error:error.message,state:error.state});}
  });
  app.get("/api/v3/me/study", async request => {
    empty.parse(request.query);
    const principal = await dependencies.authorize({ request, mutation: false });
    if (principal.subject.role !== "student") throw new PermissionDeniedError("当前课程仅供学生本人读取");
    return StudentStudyV3Schema.parse(await dependencies.store.read(dependencies.actorFor(principal)));
  });
  app.post("/api/v3/me/study/start", async (request, reply) => {
    empty.parse(request.query); const input = StartStudyV3Schema.parse(request.body);
    const principal = await dependencies.authorize({ request, mutation: true });
    if (principal.subject.role !== "student") throw new PermissionDeniedError("只有学生本人可以开始课程");
    const actor = dependencies.actorFor(principal), course = dependencies.runtime.dependencies.courses.getReleaseById(input.courseReleaseId);
    try { return StartStudyResultV3Schema.parse(await dependencies.store.start(actor, input, course.courseId, ({practiceOrdinal}) => dependencies.runtime.prepare(actor, input.courseReleaseId, input.requestId, input.taskReleaseId,practiceOrdinal))); }
    catch (error) { if (!(error instanceof StudyConflictError)) throw error; return reply.code(409).send({ error: error.message, state: error.state }); }
  });
  app.post("/api/v3/me/study/cancel", async (request, reply) => {
    empty.parse(request.query); const input = CancelStudyV3Schema.parse(request.body);
    const principal = await dependencies.authorize({ request, mutation: true });
    if (principal.subject.role !== "student") throw new PermissionDeniedError("只有学生本人可以放弃当前课程");
    try { return StudentStudyV3Schema.parse(await dependencies.store.cancel(dependencies.actorFor(principal), input)); }
    catch (error) { if (!(error instanceof StudyConflictError)) throw error; return reply.code(409).send({ error: error.message, state: error.state }); }
  });
  app.post("/api/v3/me/study/complete", async (request, reply) => {
    empty.parse(request.query); const input = CompleteStudyV3Schema.parse(request.body);
    const principal = await dependencies.authorize({ request, mutation: true });
    if (principal.subject.role !== "student") throw new PermissionDeniedError("只有学生本人可以结束当前课程");
    try { return StudentStudyV3Schema.parse(await dependencies.store.complete(dependencies.actorFor(principal), input)); }
    catch (error) { if (!(error instanceof StudyConflictError)) throw error; return reply.code(409).send({ message: error.message, state: error.state }); }
  });
}
