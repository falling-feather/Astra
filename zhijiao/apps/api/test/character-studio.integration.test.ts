import { beforeAll, afterAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCanonical } from '@ronggang/course-content';
import type { FastifyInstance } from 'fastify';
import { CharacterWorkflowV3Schema, characterWorkflowEdges, characterWorkflowOrder, createDefaultCharacterWorkflowV3 } from '@ronggang/contracts';
import { createApp, DEMO_XUNPU_SESSION_ID } from '../src/server.js';
import type { DemoAuthContext } from '../src/identity.js';
let app: FastifyInstance | null = null;
const tempRoot=fileURLToPath(new URL('../../../.local/',import.meta.url));
let directory:string|null=null;
afterAll(async()=>{await app?.close();app=null;if(directory){const child=relative(tempRoot,resolve(directory));if(!child||child.startsWith('..')||isAbsolute(child))throw new Error('Temporary path outside workspace');await rm(directory,{recursive:true,force:true});directory=null;}});
beforeAll(async()=>{
  const started=Date.now();
  await mkdir(tempRoot,{recursive:true});directory=await mkdtemp(resolve(tempRoot,'teacher-workflow-api-'));
  app=await createApp({dataDir:directory,logger:false,initializeSecondaryDemo:false,awaitStartupRecovery:true,environment:{NODE_ENV:'test',IFLYTEK_MODE:'mock',DEEPSEEK_MODE:'mock'}});
  console.info(JSON.stringify({stage:'isolated-cold-start',elapsedMs:Date.now()-started}));
},60_000);
it('keeps legacy workflow content hashes and rejects disconnected or cyclic graph edits',()=>{
  const original=createDefaultCharacterWorkflowV3();
  expect(hashCanonical(CharacterWorkflowV3Schema.parse(original))).toBe(hashCanonical(original));
  const edges=characterWorkflowEdges(original);
  expect(CharacterWorkflowV3Schema.safeParse({...original,edges:edges.slice(1)}).success).toBe(false);
  expect(CharacterWorkflowV3Schema.safeParse({...original,edges:[...edges,{source:'tools',target:'memory'}]}).success).toBe(false);
});
it('saves and publishes a connected graph through teacher authorization without granting another class',async()=>{

  const origin='http://localhost:5173';
  const login=await app!.inject({method:'POST',url:'/api/auth/demo-session',headers:{origin},payload:{profileId:'teacher-class-a',sessionId:DEMO_XUNPU_SESSION_ID}});
  expect(login.statusCode,login.body).toBe(200);
  const auth=login.json() as DemoAuthContext;
  const binding=auth.bindings.find(item=>item.sessionId===DEMO_XUNPU_SESSION_ID)!;
  const cookies=login.headers['set-cookie'],cookie=(Array.isArray(cookies)?cookies[0]!:cookies!).split(';')[0]!;
  const headers={origin,cookie,'x-csrf-token':auth.csrfToken};
  const classes=await app!.inject({url:'/api/v3/teacher/classrooms',headers});
  expect(classes.json().classrooms.map((item:{classroomId:string})=>item.classroomId)).toEqual(['classroom-local-tourism-a']);
  const courseId='course-xunpu-intangible-media',path='/api/v3/character-studio/'+courseId;
  const forbidden=await app!.inject({url:'/api/v3/character-studio?courseId='+courseId+'&classroomId=classroom-local-tourism-b',headers});
  expect(forbidden.statusCode).toBe(403);
  const initial=await app!.inject({url:'/api/v3/character-studio?courseId='+courseId,headers});
  expect(initial.statusCode,initial.body).toBe(200);
  const workspace=initial.json(),flow=createDefaultCharacterWorkflowV3();
  flow.nodes.push({id:'follow-up',kind:'instruction',label:'追问核对',enabled:true,instruction:'核对学生是否理解来源的适用范围。',position:{x:-120,y:730}});
  flow.edges=[...characterWorkflowEdges(createDefaultCharacterWorkflowV3()).filter(edge=>edge.source!=='decide'),{source:'decide',target:'follow-up'},{source:'follow-up',target:'tools'}];
  expect(characterWorkflowOrder(flow).map(node=>node.id)).toEqual(['understand','knowledge','memory','decide','follow-up','tools','reply']);
  const character={id:'character-integration-guide',name:'课程联络员',role:'现场资料联络员',nodeId:workspace.nodes[0].id,
    goal:'协助学生核对岗位资料与来源。',personality:'耐心回应有具体依据的提问，遇到不清楚的内容会说明边界。',unknown:'不虚构未发生的事情，不承诺自己无法提供的权限。',greeting:'你好，请说说你希望核对的具体资料。',
    appearance:{image:'/assets/v3/xunpu-actors.png',x:.6,y:.94,height:.58},social:{supportsContact:true,initialTrust:15,contactThreshold:25,referralThreshold:45,referralTargets:[],refusal:'请先把这次工作的问题沟通清楚。'},knowledgeIds:[],
    topics:[{id:'work',title:'工作范围',keywords:['工作'],response:'我负责当前资料联络，无法替其他人员确认授权与承诺。',sourceKind:'simulation',sourceTitle:'教师编排工作说明',sourceUrl:null}],workflow:flow};
  const author={bindingId:binding.bindingId,authorizationSessionId:DEMO_XUNPU_SESSION_ID,classroomId:'classroom-local-tourism-a'};
  const badSave=await app!.inject({method:'POST',url:path+'/draft',headers,payload:{...author,classroomId:'classroom-local-tourism-b',requestId:'denied-edit',expectedRevision:0,characters:[character]}});
  expect(badSave.statusCode).toBe(403);
  const save=await app!.inject({method:'POST',url:path+'/draft',headers,payload:{...author,requestId:'save-graph',expectedRevision:workspace.draft.revision,characters:[character]}});
  expect(save.statusCode,save.body).toBe(200);
  const saved=save.json();expect(saved.draft.characters[0].workflow).toEqual(flow);
  const publish=await app!.inject({method:'POST',url:path+'/publish',headers,payload:{...author,requestId:'publish-graph',expectedRevision:saved.draft.revision,contentHash:saved.draft.contentHash}});
  expect(publish.statusCode,publish.body).toBe(200);
  const reread=await app!.inject({url:'/api/v3/character-studio?courseId='+courseId,headers});
  expect(reread.json().publication.draftRevision).toBe(saved.draft.revision);
  expect(reread.json().draft.characters[0].workflow.edges).toEqual(flow.edges);
},30_000);
