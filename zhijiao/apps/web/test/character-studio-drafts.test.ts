import {expect,it} from 'vitest';
import {createDefaultCharacterWorkflowV3,type CharacterBlueprintV3,type CharacterStudioDraftV3} from '@ronggang/contracts';
import {readCharacterDraft,writeCharacterDraft,clearCharacterDraft,characterDraftMatches} from '../src/v2/pages/character-studio-drafts';
class MemoryStorage implements Storage {
  values=new Map<string,string>();get length(){return this.values.size;}clear(){this.values.clear();}key(index:number){return [...this.values.keys()][index]??null;}getItem(key:string){return this.values.get(key)??null;}setItem(key:string,value:string){this.values.set(key,value);}removeItem(key:string){this.values.delete(key);}
}
const draft={courseId:'course-a',classroomId:'class-a',revision:2,contentHash:'a'.repeat(64),baseLessonHash:'b'.repeat(64),characters:[],updatedAt:'2026-09-14T00:00:00.000Z'} satisfies CharacterStudioDraftV3;
const incomplete={id:'character-a',name:'',topics:[],workflow:{...createDefaultCharacterWorkflowV3(),edges:[]}} as unknown as CharacterBlueprintV3;
it('retains incomplete fields and a graph being connected across a page remount',()=>{
  const storage=new MemoryStorage();writeCharacterDraft(storage,'teacher-a',draft,[incomplete]);
  expect(readCharacterDraft(storage,'teacher-a',draft)?.characters).toEqual([incomplete]);
  expect(readCharacterDraft(storage,'teacher-a',draft)?.baseRevision).toBe(2);
});
it('isolates drafts by teacher, classroom and course',()=>{
  const storage=new MemoryStorage();writeCharacterDraft(storage,'teacher-a',draft,[incomplete]);
  expect(readCharacterDraft(storage,'teacher-b',draft)).toBeNull();
  expect(readCharacterDraft(storage,'teacher-a',{...draft,classroomId:'class-b'})).toBeNull();
  expect(readCharacterDraft(storage,'teacher-a',{...draft,courseId:'course-b'})).toBeNull();
  clearCharacterDraft(storage,'teacher-b',draft);expect(storage.length).toBe(1);
});
it('keeps a local revision for explicit conflict resolution after the server changed',()=>{
  const storage=new MemoryStorage();writeCharacterDraft(storage,'teacher-a',draft,[incomplete]);
  expect(readCharacterDraft(storage,'teacher-a',{...draft,revision:3,contentHash:'c'.repeat(64)})?.baseContentHash).toBe(draft.contentHash);
  clearCharacterDraft(storage,'teacher-a',draft);expect(storage.length).toBe(0);
});
it('does not delete a damaged record while reporting it',()=>{
  const storage=new MemoryStorage();writeCharacterDraft(storage,'teacher-a',draft,[incomplete]);const key=storage.key(0)!;storage.setItem(key,'broken-json');
  expect(()=>readCharacterDraft(storage,'teacher-a',draft)).toThrow();expect(storage.getItem(key)).toBe('broken-json');
});
it('ignores a recreated revision-zero timestamp but detects a changed base lesson',()=>{
  const storage=new MemoryStorage(),empty={...draft,revision:0};writeCharacterDraft(storage,'teacher-a',empty,[incomplete]);
  const cached=readCharacterDraft(storage,'teacher-a',empty)!;
  expect(characterDraftMatches(cached,{...empty,contentHash:'c'.repeat(64),updatedAt:'2026-09-14T01:00:00.000Z'})).toBe(true);
  expect(characterDraftMatches(cached,{...empty,baseLessonHash:'d'.repeat(64)})).toBe(false);
});
