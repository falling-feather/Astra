import type {CharacterBlueprintV3,CharacterStudioDraftV3} from '@ronggang/contracts';

export interface LocalCharacterDraft {
  version:1; baseRevision:number; baseContentHash:string; baseLessonHash?:string; characters:CharacterBlueprintV3[];
}
const keyFor=(bindingId:string,draft:Pick<CharacterStudioDraftV3,'courseId'|'classroomId'>)=>
  `ganglian.character-draft.${bindingId}.${draft.classroomId}.${draft.courseId}`;

/** A device draft may contain incomplete fields or a graph that is still being connected. */
export function readCharacterDraft(storage:Storage,bindingId:string,draft:CharacterStudioDraftV3):LocalCharacterDraft|null {
  const raw=storage.getItem(keyFor(bindingId,draft));if(!raw)return null;
  const parsed=JSON.parse(raw) as LocalCharacterDraft;
  if(parsed.version!==1||!Number.isInteger(parsed.baseRevision)||typeof parsed.baseContentHash!=='string'||!Array.isArray(parsed.characters)
    ||!parsed.characters.every(person=>typeof person?.id==='string'&&typeof person.name==='string'&&Array.isArray(person.workflow?.nodes)&&Array.isArray(person.topics)))throw new Error('本机草稿无法读取，已保留原内容；当前显示服务器版本。');
  return parsed;
}
export function writeCharacterDraft(storage:Storage,bindingId:string,draft:CharacterStudioDraftV3,characters:CharacterBlueprintV3[]) {
  storage.setItem(keyFor(bindingId,draft),JSON.stringify({version:1,baseRevision:draft.revision,baseContentHash:draft.contentHash,baseLessonHash:draft.baseLessonHash,characters} satisfies LocalCharacterDraft));
}
export function characterDraftMatches(cache:LocalCharacterDraft,draft:CharacterStudioDraftV3):boolean {
  // An unsaved server draft is recreated with a new timestamp on every read.
  return cache.baseRevision===draft.revision&&(draft.revision===0?cache.baseLessonHash===draft.baseLessonHash:cache.baseContentHash===draft.contentHash);
}
export function clearCharacterDraft(storage:Storage,bindingId:string,draft:CharacterStudioDraftV3) {
  storage.removeItem(keyFor(bindingId,draft));
}
