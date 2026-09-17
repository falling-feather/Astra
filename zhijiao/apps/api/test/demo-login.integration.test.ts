import {beforeAll,afterAll,expect,it} from 'vitest';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {createApp} from '../src/server.js';
import type {DemoAuthContext} from '../src/identity.js';

const origin='http://localhost:5173',tempRoot=fileURLToPath(new URL('../../../.local/',import.meta.url));
let app:FastifyInstance,directory:string;
beforeAll(async()=>{await mkdir(tempRoot,{recursive:true});directory=await mkdtemp(resolve(tempRoot,'demo-login-'));app=await createApp({dataDir:directory,logger:false,awaitStartupRecovery:true,environment:{NODE_ENV:'test',MODEL_PROVIDER:'deterministic',IFLYTEK_MODE:'mock'}});},60_000);
afterAll(async()=>{await app?.close();if(directory){const child=relative(tempRoot,directory);if(!child||child.startsWith('..')||isAbsolute(child))throw new Error('Invalid cleanup path');await rm(directory,{recursive:true,force:true});}});
async function login(username:string,role:'student'|'teacher'){
  const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin},payload:{username,password:'Demo2026',role}});
  expect(response.statusCode,response.body).toBe(200);
  const cookieHeader=response.headers['set-cookie'],cookie=(Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!).split(';')[0]!;
  const auth=response.json<DemoAuthContext>();return {auth,headers:{origin,cookie,'x-csrf-token':auth.csrfToken}};
}
it('publishes exactly one teacher and three working student credentials',async()=>{
  const response=await app.inject({url:'/api/auth/demo-accounts'});
  expect(response.json().accounts.map((item:{username:string})=>item.username)).toEqual(['teacher','student1','student2','student3']);
  const invalid=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin},payload:{username:'teacher',password:'wrong',role:'teacher'}});
  expect(invalid.statusCode).toBe(401);expect(invalid.headers['set-cookie']).toBeUndefined();
  const wrongRole=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin},payload:{username:'teacher',password:'Demo2026',role:'student'}});
  expect(wrongRole.statusCode).toBe(401);
});
it('provides two ten-student rosters without inventing scores',async()=>{
  const teacher=await login('teacher','teacher');
  const roster=(await app.inject({url:'/api/v3/teacher/student-archive',headers:teacher.headers})).json();
  expect(roster.classrooms).toHaveLength(2);expect(roster.students).toHaveLength(20);
  for(const classroom of roster.classrooms)expect(roster.students.filter((s:{classroomId:string})=>s.classroomId===classroom.classroomId)).toHaveLength(10);
  expect(roster.students.every((s:{runs:unknown[]})=>s.runs.length===0)).toBe(true);
  const studio=await app.inject({url:'/api/v3/character-studio?courseId=course-xunpu-intangible-media&classroomId=classroom-local-tourism-b',headers:teacher.headers});
  expect(studio.statusCode,studio.body).toBe(200);
},30_000);
it('restores the same login, rejects cross-class session access, and revokes logout',async()=>{
  const student=await login('student1','student');
  expect(student.auth.profileId).toBe('student-unassigned');
  const restored=(await app.inject({url:'/api/auth/session',headers:student.headers})).json();
  expect(restored).toEqual(student.auth);
  const forged=await app.inject({method:'POST',url:'/api/auth/session-context',headers:student.headers,payload:{sessionId:'demo-local-tourism-b'}});
  expect(forged.statusCode).toBe(403);
  const logout=await app.inject({method:'POST',url:'/api/auth/logout',headers:student.headers});expect(logout.statusCode).toBe(200);
  expect((await app.inject({url:'/api/auth/session',headers:student.headers})).statusCode).toBe(401);
});
it('starts independent courses for the remaining student accounts and exposes them to the teacher',async()=>{
  const sessions:string[]=[];
  for(const username of ['student2','student3']){
    const student=await login(username,'student');
    const courses=(await app.inject({url:'/api/v3/course-archive',headers:student.headers})).json().courses;
    const start=await app.inject({method:'POST',url:'/api/v3/me/study/start',headers:student.headers,payload:{requestId:'login-test-'+username,courseReleaseId:courses[0].courseRef.releaseId}});
    expect(start.statusCode,start.body).toBe(200);sessions.push(start.json().run.sessionId);
    const context=await app.inject({method:'POST',url:'/api/auth/session-context',headers:student.headers,payload:{sessionId:start.json().run.sessionId}});
    expect(context.statusCode,context.body).toBe(200);expect(context.json().profileId).toBe(student.auth.profileId);
  }
  expect(new Set(sessions).size).toBe(2);
  const teacher=await login('teacher','teacher'),roster=(await app.inject({url:'/api/v3/teacher/student-archive',headers:teacher.headers})).json();
  expect(roster.students.filter((s:{currentSessionId:string|null})=>sessions.includes(s.currentSessionId??''))).toHaveLength(2);
},30_000);
