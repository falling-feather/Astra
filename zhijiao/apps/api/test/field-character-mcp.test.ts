import { describe, expect, it } from 'vitest';
import { courseFieldLessonsV3 } from '@ronggang/course-content';
import { createFieldInterview, projectFieldInterview } from '@ronggang/world-core';
import { FieldCharacterMcp } from '../src/field-character-mcp.js';
const lesson=courseFieldLessonsV3[1]!.lesson;
const view=projectFieldInterview({lesson,record:createFieldInterview(lesson,'student-a','binding-a','session-a'),worldStateVersion:0,virtualMinute:0,remainingMinutes:55});
describe('in-process character MCP transport',()=>{
 it('executes through the MCP client and server and passes a server-issued invocation reference',async()=>{const mcp=new FieldCharacterMcp();try{
  let reference='';const result=await mcp.invoke('add_contact',async callRef=>{reference=callRef;return{view,eventId:'field-event-a',replayed:false};});
  expect(reference).toMatch(/^character-tool-/);expect(result.eventId).toBe('field-event-a');expect(result.view.sessionId).toBe('session-a');
 }finally{await mcp.close();}});
 it('preserves the domain failure rather than returning a false successful action',async()=>{const mcp=new FieldCharacterMcp();const failure=new Error('course was closed');try{
  await expect(mcp.invoke('request_referral',async()=>{throw failure;})).rejects.toBe(failure);
 }finally{await mcp.close();}});
});
