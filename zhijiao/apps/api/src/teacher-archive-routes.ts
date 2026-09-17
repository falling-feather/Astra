import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TeacherStudentArchiveV3Schema, TeacherSubmittedWorksV3Schema } from "@ronggang/contracts";
import { courseRegionAssignments, type ExplorationLesson } from "@ronggang/course-content";
import type { WorldSimulationEngineV3 } from "@ronggang/world-core";
import type { TeachingAuthorizer } from "./character-studio-routes.js";
import { TeachingTaskError } from "./teaching-task-service.js";
import type { StudentStudyStore,StudyOwner } from "./student-study.js";
import { ChallengeLevelSchema, type FlagshipStudentWorkServiceV3 } from "./flagship-student-work-v3.js";
import type { FlagshipEvidenceAssessmentServiceV4 } from "./flagship-assessment-v4.js";

export async function registerTeacherArchiveRoutes(app: FastifyInstance, ports: {
  authorize: TeachingAuthorizer; study: StudentStudyStore;
  engine: Pick<WorldSimulationEngineV3,"getRecord">; lessons: readonly ExplorationLesson[];
  work: FlagshipStudentWorkServiceV3; assessment: FlagshipEvidenceAssessmentServiceV4;
  studentName(profileId: string): string;
  classrooms?(principalId: string): Promise<Array<{classroomId: string; name: string}>>;
  roster?(classroomId:string):Promise<StudyOwner[]>;
}) {
  const classroomsFor = (actor: {principalId:string;classroomId:string}) => ports.classrooms ? ports.classrooms(actor.principalId) : Promise.resolve([{classroomId:actor.classroomId,name:actor.classroomId}]);
  app.get('/api/v3/teacher/classrooms', async request => {
    const actor = await ports.authorize(request,false);
    if (actor.role !== 'teacher') throw new TeachingTaskError('access_denied','只有教师可以查看所管理的班级');
    return {classrooms:await classroomsFor(actor)};
  });
  app.get('/api/v3/teacher/student-archive/:studentId/sessions/:sessionId/works', async request => {
    const params = z.object({ studentId: z.string().min(1), sessionId: z.string().min(1) }).strict().parse(request.params);
    const actor = await ports.authorize(request,false);
    if (actor.role !== 'teacher') throw new TeachingTaskError('access_denied','只有本班教师可以查阅送审作品');
    const allowed = await classroomsFor(actor);
    const student = (await Promise.all(allowed.map(item => ports.study.students(item.classroomId)))).flat().find(student => student.owner.profileId === params.studentId);
    if (!student?.state.runs.some(run => run.sessionId === params.sessionId)) throw new TeachingTaskError('access_denied','该作品不属于当前班级学生的课程');
    if(student.state.runs.find(run=>run.sessionId===params.sessionId)?.runtimeKind==='legacy_course')throw new TeachingTaskError('invalid_task','本场使用旧版章节流程，请打开原版作品评价入口');
    const work = await ports.work.loadRecord(params.sessionId);
    if (work && work.ownerPrincipalId !== student.owner.principalId) throw new TeachingTaskError('access_denied','作品的学生归属不一致');
    return TeacherSubmittedWorksV3Schema.parse(await ports.work.submittedWorks(params.sessionId));
  });
  app.get('/api/v3/teacher/student-archive', async request => {
    z.object({}).strict().parse(request.query);
    const actor = await ports.authorize(request,false);
    if (actor.role !== 'teacher') throw new TeachingTaskError('access_denied','只有本班教师可以查看学生课程档案');
    const classrooms = await classroomsFor(actor);
    const stored = (await Promise.all(classrooms.map(item => ports.study.students(item.classroomId)))).flat();
    const roster=ports.roster?(await Promise.all(classrooms.map(item=>ports.roster!(item.classroomId)))).flat():[];
    const registered=[...new Map([...stored.map(item=>item.owner),...roster].map(owner=>[owner.principalId,{owner}])).values()];
    const students = await Promise.all(registered.map(async student => {
      const state = await ports.study.read(student.owner);
      const runs = await Promise.all(state.runs.map(async run => {
        if(run.runtimeKind==='legacy_course'){
          const {bindingId:_binding,...publicRun}=run,configuration=courseRegionAssignments.find(item=>item.courseId===run.courseRef.courseId);
          return {...publicRun,region:configuration?.regionTitle??'章节课程',coverIndex:configuration?.coverIndex??0,visitedScenes:0,conversations:0,submittedWorks:0,requiredWorks:0,relationships:[],
            assessment:{status:'legacy',message:'本场采用旧版章节流程，请通过本次评价入口查看原作品与教师记录。',criteria:[]}};
        }
        const world = await ports.engine.getRecord(run.sessionId), field = world.fieldInterview;
        const lesson = field ? ports.lessons.find(lesson => lesson.contentHash === field.lessonRef.contentHash) : null;
        const configuration = courseRegionAssignments.find(item => item.courseId === run.courseRef.courseId);
        const [work, decision] = await Promise.all([ports.work.getReviewWorkspace({sessionId:run.sessionId,challengeLevel:ChallengeLevelSchema.parse(world.challengeAssignment.challengeLevel)}),ports.assessment.loadCurrentAssessment({sessionId:run.sessionId})]);
        const assessment = ports.assessment.projectView(decision,'teacher');
        const { bindingId: _privateBinding, ...publicRun }=run;
        return {...publicRun, region:lesson?.region?.title??configuration?.regionTitle??'课程实训', coverIndex:configuration?.coverIndex??0,
          visitedScenes:field?.visitedNodeIds.length??0,conversations:field?.turns.length??0,
          submittedWorks:work.completion.submittedRequiredCount,requiredWorks:work.completion.requiredArtifactCount,
          relationships:(field?.contacts??[]).map(contact=>({name:lesson?.people.find(person=>person.id===contact.npcId)?.name??'课程人物',met:contact.met,friend:contact.friend,introductions:contact.referredNpcIds.length})),
          assessment:{status:assessment.status,message:assessment.safeMessage,criteria:assessment.criteria.map(criterion=>({id:criterion.criterionId,title:criterion.title,score:criterion.score,rationale:criterion.rationale}))}};
      }));
      return {studentId:student.owner.profileId,displayName:ports.studentName(student.owner.profileId),classroomId:student.owner.classroomId,currentSessionId:state.currentSessionId,runs:runs.toSorted((a,b)=>b.startedAt.localeCompare(a.startedAt))};
    }));
    return TeacherStudentArchiveV3Schema.parse({students,classrooms});
  });
}
