import { describe, expect, it } from 'vitest';
import { courseFieldLessonsV3 } from '@ronggang/course-content';
import type { FieldInterviewActionV1 } from '@ronggang/contracts';
import { applyFieldInterviewAction, createFieldInterview, projectFieldInterview } from '../src/field-interview-v1.js';
import { canMessageFieldPerson, fieldMemoryContext } from '../src/field-social-v3.js';
const lesson=courseFieldLessonsV3.find(item=>item.courseId==='course-village-super-multiplatform')!.lesson;
function play(){let record=createFieldInterview(lesson,'student-a','binding-a','session-a'),minute=0,version=0,sequence=0;
 const act=(action:FieldInterviewActionV1)=>{const result=applyFieldInterviewAction({lesson,record,actorId:'student-a',worldStateVersion:version,virtualMinute:minute,remainingMinutes:60-minute,now:'2026-09-12T00:00:00.000Z',
  request:{schemaVersion:'field-interview-action/1.0.0',requestId:`action-${++sequence}`,sessionId:'session-a',bindingId:'binding-a',expectedWorldStateVersion:version,action}});record=result.record;version=result.event.resultingWorldStateVersion;minute=result.event.afterMinute;return result;};
 return {act,get record(){return record;},get view(){return projectFieldInterview({lesson,record,worldStateVersion:version,virtualMinute:minute,remainingMinutes:60-minute});}};}
const say=(text:string,npcId='rg-liaison',channel:'scene'|'chat'='scene'):FieldInterviewActionV1=>({kind:'talk',npcId,channel,text});
describe('published multi-region exploration and social boundaries',()=>{
 it('projects each published starting point without revealing unexplored places or remote contacts',()=>{
  for(const {lesson} of courseFieldLessonsV3){const record=createFieldInterview(lesson,'student-a','binding-a','session-a'),view=projectFieldInterview({lesson,record,worldStateVersion:0,virtualMinute:0,remainingMinutes:60});
   expect(view.people.filter(person=>person.canMessage)).toEqual([]);
   expect(view.nodes.some(node=>node.discovered===false)).toBe(true);
   for(const node of view.nodes.filter(node=>node.discovered===false||!node.allowed))expect(node.image).toBeNull();
  }
 });
 it('rejects direct travel to an undiscovered destination',()=>{const game=play();expect(()=>game.act({kind:'travel',nodeId:'rg-desk'})).toThrow();expect(game.record.nodeId).toBe('rg-entry');});
 it('requires knowing someone before a contact request can succeed and does not duplicate friends',()=>{const game=play();
  game.act(say('可以加你的微信好友吗？'));expect(game.view.people.find(person=>person.id==='rg-liaison')!.canMessage).toBe(false);
  game.act(say('我是来做采访的学生。'));game.act(say('可以加你的微信好友吗？'));
  expect(game.view.people.find(person=>person.id==='rg-liaison')!.canMessage).toBe(true);
  game.act(say('可以加你的微信好友吗？'));expect(game.record.contacts?.filter(contact=>contact.friend)).toHaveLength(1);
 });
 it('ignores a negated or hypothetical request to add a contact',()=>{const game=play();game.act(say('我是来做采访的学生。'));game.act(say('我不想加微信好友，只是想问工作安排。'));expect(game.record.contacts?.some(contact=>contact.friend)).toBe(false);});
 it('records a real introduction but does not make the introduced person a friend',()=>{const game=play();game.act(say('我是来做采访的学生。'));game.act(say('你可以引荐其他受访者吗？'));
  expect(game.record.contacts?.find(contact=>contact.npcId==='rg-liaison')!.referredNpcIds).toContain('rg-practitioner');
  expect(game.record.contacts?.find(contact=>contact.npcId==='rg-practitioner')?.friend).toBe(false);
 });
 it('lets a non-contactable specialist refuse and rejects a forged remote channel',()=>{const game=play();for(const nodeId of ['rg-stand-entrance','rg-referee-desk','rg-commentary-room'])game.act({kind:'travel',nodeId});game.act(say('我是来采访的学生。','rg-specialist'));game.act(say('可以加你的微信好友吗？','rg-specialist'));
  expect(game.view.people.find(person=>person.id==='rg-specialist')!.canMessage).toBe(false);expect(()=>game.act(say('想了解比分统计。','rg-specialist','chat'))).toThrow();
 });
 it('does not reward repeating the same topic and carries only supplied relationship memory to a new course',()=>{const game=play();game.act(say('请介绍今天的赛程安排。'));const before=game.record.contacts?.find(contact=>contact.npcId==='rg-liaison')!.trust;
  game.act(say('请介绍今天的赛程安排。'));expect(game.record.contacts?.find(contact=>contact.npcId==='rg-liaison')!.trust).toBe(before);
  game.act(say('可以加你的微信好友吗？'));const next=createFieldInterview(lesson,'student-a','binding-next','session-next',game.record.contacts);
  expect(next.turns).toHaveLength(0);expect(next.visitedNodeIds).toEqual([lesson.initialNodeId]);expect(canMessageFieldPerson(lesson.people[0]!,next)).toBe(true);
  expect(fieldMemoryContext(lesson.people[0]!,next,'赛程').memories.length).toBeGreaterThan(0);
  expect(createFieldInterview(lesson,'student-b','binding-b','session-b').contacts??[]).toHaveLength(0);
 });
});
