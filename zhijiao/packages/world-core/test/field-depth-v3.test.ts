import {expect,it} from 'vitest';
import {courseFieldLessonsV3,createFieldLessonVariantV3,validateExplorationLesson,type ExplorationLesson} from '@ronggang/course-content';
import type {FieldInterviewActionV1} from '@ronggang/contracts';
import {createFieldInterview,applyFieldInterviewAction,projectFieldInterview} from '../src/field-interview-v1.js';

function play(lesson:ExplorationLesson){let record=createFieldInterview(lesson,'learner','binding','session'),minute=0,version=0,sequence=0;
 const act=(action:FieldInterviewActionV1)=>{const result=applyFieldInterviewAction({lesson,record,actorId:'learner',worldStateVersion:version,virtualMinute:minute,remainingMinutes:55-minute,now:'2026-09-12T12:00:00.000Z',
  request:{schemaVersion:'field-interview-action/1.0.0',requestId:`action-${++sequence}`,sessionId:'session',bindingId:'binding',expectedWorldStateVersion:version,action}});record=result.record;minute=result.event.afterMinute;version=result.event.resultingWorldStateVersion;};
 const go=(destination:string)=>{const queue=[[record.nodeId]],seen=new Set<string>();while(queue.length){const path=queue.shift()!,last=path.at(-1)!;if(last===destination){for(const nodeId of path.slice(1))act({kind:'travel',nodeId});return;}if(seen.has(last))continue;seen.add(last);
  for(const exit of lesson.nodes.find(node=>node.id===last)!.exits??[]){const node=lesson.nodes.find(node=>node.id===exit.targetId)!;if(!node.requiresFlag||record.flags.includes(node.requiresFlag))queue.push([...path,node.id]);}}
  throw new Error(`No accessible route to ${destination}`);};
 return {act,go,get record(){return record;},get minute(){return minute;},get view(){return projectFieldInterview({lesson,record,worldStateVersion:version,virtualMinute:minute,remainingMinutes:55-minute});}};
}

it('lets a student meet the resident and enter by her consent without talking to the gatekeeper',()=>{
 const lesson=courseFieldLessonsV3[0]!.lesson,game=play(lesson);
 game.go('xp-courtyard-threshold');
 expect(game.view.people.find(person=>person.id==='entity-community-source')?.presence).toBe('present');
 expect(()=>game.act({kind:'travel',nodeId:'loc-community-courtyard'})).toThrow();
 game.act({kind:'choose',npcId:'entity-community-source',channel:'scene',choiceId:'ahuan-courtyard-entry',rationale:'只进入本人明确同意的区域，记录范围另行协商。'});
 game.go('loc-community-courtyard');game.act({kind:'inspect',materialId:'xp-courtyard-observation'});
 expect(game.record.materialIds).toContain('xp-courtyard-observation');
 expect(game.record.turns.some(turn=>turn.npcId==='entity-gatekeeper')).toBe(false);
});

it('offers twenty substantive cast members and allows each course direction to reach its named sources within a lesson',()=>{
 for(const {courseId,lesson} of courseFieldLessonsV3){
  expect(validateExplorationLesson(lesson),courseId).toEqual([]);
  expect(lesson.nodes.length).toBeGreaterThanOrEqual(20);expect(lesson.people.length).toBeGreaterThanOrEqual(20);expect(lesson.strategies.length).toBeGreaterThanOrEqual(10);
  expect(lesson.people.every(person=>person.topics.length>=3&&person.appearance&&person.goal&&person.unknown)).toBe(true);
  for(const strategy of lesson.strategies){const game=play(lesson);
   for(const npcId of strategy.evidenceNpcIds){const person=lesson.people.find(person=>person.id===npcId)!;
    if(person.nodeId==='loc-zanhuawei-workshop'){game.go('xp-workshop-foyer');game.act({kind:'choose',npcId:'entity-inheritor',choiceId:'huang-invitation',channel:'scene',rationale:'先确认观摩安排，再进入操作区域。'});}
    game.go(person.nodeId);game.act({kind:'talk',npcId,channel:'scene',text:person.topics[0]!.title+'，请讲一个具体细节。'});
   }
   expect(game.record.turns.length,`${courseId}/${strategy.id}`).toBeGreaterThanOrEqual(3);
   expect(game.minute,`${courseId}/${strategy.id}`).toBeLessThan(40); // Leaves a real budget for follow-ups and work; not a real-time duration claim.
  }
 }
});

it('freezes four distinct commissions per course and never mutates the base or another run',()=>{
 for(const {courseId,lesson} of courseFieldLessonsV3){const original=JSON.stringify(lesson),runs=Array.from({length:4},(_,ordinal)=>createFieldLessonVariantV3(lesson,courseId,ordinal));
  expect(new Set(runs.map(run=>run.contentHash)).size).toBe(4);expect(new Set(runs.map(run=>run.assignment)).size).toBe(4);
  for(const run of runs){expect(validateExplorationLesson(run)).toEqual([]);expect(run.materials.at(-1)?.nodeId).toBe(run.initialNodeId);}
  expect(createFieldLessonVariantV3(lesson,courseId,4).contentHash).toBe(runs[0]!.contentHash);expect(JSON.stringify(lesson)).toBe(original);
 }
});
