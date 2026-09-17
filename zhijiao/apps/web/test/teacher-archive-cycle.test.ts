import {expect,it} from 'vitest';
import {createTeacherDossierSlots,TEACHER_VISIBLE_SLOTS} from '../src/v2/pages/teacher-archive-field/data';
const roster=(count:number,collection='class-a')=>Array.from({length:count},(_,i)=>({id:collection+'-'+i,title:'学生'+(i+1),collection}));

it('repeats three real dossiers and seven empty slots, including across the physical seam',()=>{
  const students=roster(3),slots=createTeacherDossierSlots([{classroomId:'class-a'}],students).filter(slot=>slot.classId===0);
  const period=[...students.map(student=>student.id),...Array(7).fill(null)];
  expect(slots.length).toBeGreaterThanOrEqual(TEACHER_VISIBLE_SLOTS);
  expect(slots.length%10).toBe(0);
  for(let offset=0;offset<slots.length;offset+=10)expect(slots.slice(offset,offset+10).map(slot=>slot.recordId)).toEqual(period);
  expect(slots.filter(slot=>slot.recordId===null).every(slot=>slot.name==='')).toBe(true);
  expect(new Set(slots.map(slot=>slot.id)).size).toBe(slots.length);
  expect(students).toHaveLength(3);
});

it.each([0,1,9,10,11,43])('uses the ten-slot minimum or the real roster size for %i students',count=>{
  const students=roster(count),slots=createTeacherDossierSlots([{classroomId:'class-a'}],students).filter(slot=>slot.classId===0);
  const period=Math.max(10,count);
  expect(slots.length%period).toBe(0);
  expect(slots.slice(0,period).filter(slot=>slot.recordId!==null)).toHaveLength(count);
  expect(slots.slice(-period).map(slot=>slot.recordId)).toEqual(slots.slice(0,period).map(slot=>slot.recordId));
  expect(new Set(slots.flatMap(slot=>slot.recordId?[slot.recordId]:[]))).toEqual(new Set(students.map(student=>student.id)));
});

it('keeps cycles inside their classroom and leaves unused lanes empty',()=>{
  const slots=createTeacherDossierSlots([{classroomId:'class-a'},{classroomId:'class-b'}],[...roster(3),...roster(12,'class-b')]);
  expect(slots.filter(slot=>slot.classId===0&&slot.recordId).every(slot=>slot.recordId!.startsWith('class-a-'))).toBe(true);
  expect(slots.filter(slot=>slot.classId===1&&slot.recordId).every(slot=>slot.recordId!.startsWith('class-b-'))).toBe(true);
  expect(slots.filter(slot=>slot.classId>1).every(slot=>slot.recordId===null)).toBe(true);
});
