import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect,it } from 'vitest';
import { createApp } from '../src/server.js';
const root=fileURLToPath(new URL('../../../.local/',import.meta.url));
it('opens five personal course worlds under concurrent projections and post-action reads',async()=>{
 await mkdir(root,{recursive:true});const directory=await mkdtemp(resolve(root,'v280-world-projection-'));
 const app=await createApp({dataDir:directory,logger:false,initializeSecondaryDemo:false,awaitStartupRecovery:true,environment:{NODE_ENV:'test',MODEL_PROVIDER:'deterministic',IFLYTEK_MODE:'mock',DEEPSEEK_MODE:'mock'}});
 const errors:string[]=[];app.addHook('onError',(_req,_reply,error,done)=>{errors.push(error.stack??error.message);done();});
 const origin='http://localhost:5173';
 try{
  const login=await app.inject({method:'POST',url:'/api/auth/demo-session',headers:{origin},payload:{profileId:'student-unassigned'}});
  const auth=login.json(),cookie=String(login.headers['set-cookie']).split(';')[0]!,headers={origin,cookie,'x-csrf-token':auth.csrfToken};
  const archive=(await app.inject({method:'GET',url:'/api/v3/course-archive',headers})).json();let state=(await app.inject({method:'GET',url:'/api/v3/me/study',headers})).json();
  for(const [index,course] of archive.courses.filter((course:{taskReleaseId?:string})=>!course.taskReleaseId).entries()){
   const start=await app.inject({method:'POST',url:'/api/v3/me/study/start',headers,payload:{requestId:`start-course-${index}`,courseReleaseId:course.courseRef.releaseId,...(state.currentSessionId?{replace:{sessionId:state.currentSessionId,expectedRevision:state.revision,confirmation:'abandon-and-start'}}:{})}});
   expect(start.statusCode,start.body+'\n'+errors.join('\n')).toBe(200);const {run,state:next}=start.json();state=next;
   const reads=()=>Promise.all(['v4/experience','v4/field','v4/interview','v3/world','v3/workspace','v3/collaboration-episode'].map(async endpoint=>{
    const [generation,path]=endpoint.split('/');const response=await app.inject({method:'GET',url:`/api/${generation}/sessions/${run.sessionId}/${path}?bindingId=${run.bindingId}`,headers});
    expect(response.statusCode,endpoint+': '+response.body+'\n'+errors.join('\n')).toBe(200);return response.json();
   }));
   const initial=await reads(),view=initial[2].view,person=view.people.find((person:{presence:string;interactionKind:string})=>person.presence==='present'&&person.interactionKind==='agent');
   const ownWorks=await app.inject({method:'GET',url:`/api/v3/me/study/${run.sessionId}/works`,headers});expect(ownWorks.statusCode,ownWorks.body).toBe(200);
   if(index===0){const otherLogin=await app.inject({method:'POST',url:'/api/auth/demo-session',headers:{origin},payload:{profileId:'student-team-a'}});
    const beforeDenied=errors.length;
    const denied=await app.inject({method:'GET',url:`/api/v3/me/study/${run.sessionId}/works`,headers:{origin,cookie:String(otherLogin.headers['set-cookie']).split(';')[0]!}});expect(denied.statusCode).toBe(403);
    expect(errors.slice(beforeDenied)).toHaveLength(1);expect(errors[beforeDenied]).toContain('不在当前学生的个人课程记录中');errors.splice(beforeDenied,1);}
   const action=app.inject({method:'POST',url:`/api/v4/sessions/${run.sessionId}/interview/actions`,headers,payload:{schemaVersion:'field-interview-action/1.0.0',requestId:`introduction-${index}`,sessionId:run.sessionId,bindingId:run.bindingId,expectedWorldStateVersion:view.worldStateVersion,action:{kind:'talk',npcId:person.id,channel:'scene',text:'我是来做采访的学生，想先认识一下。'}}});
   const [performed]=await Promise.all([action,reads()]);expect(performed.statusCode,performed.body+'\n'+errors.join('\n')).toBe(200);await reads();
  }
  expect(errors).toEqual([]);
 }finally{await app.close();const child=relative(root,resolve(directory));if(!child||child.startsWith('..')||isAbsolute(child))throw new Error('unsafe test cleanup');await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},60_000);
