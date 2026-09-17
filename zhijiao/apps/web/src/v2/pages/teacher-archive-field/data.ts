export interface StudentDossier {
  id: number;
  recordId: string | null;
  classId: number;
  name: string;
}

export const TEACHER_VISIBLE_SLOTS=42;
const MIN_CLASS_CYCLE=10;

/** Repeat whole class cycles so an offscreen seam never truncates the roster. */
export function createTeacherDossierSlots(lanes:readonly {classroomId:string}[],records:readonly {id:string;title:string;collection?:string}[]):StudentDossier[] {
  let id=0;
  return Array.from({length:4},(_,classId)=>{
    const lane=lanes[classId],members=lane?records.filter(record=>record.collection===lane.classroomId):[];
    const period=Math.max(MIN_CLASS_CYCLE,members.length);
    // Extra physical copies cover the viewport; they never add students to the directory.
    const count=Math.ceil(TEACHER_VISIBLE_SLOTS/period)*period;
    return Array.from({length:count},(_,index)=>{
      const member=members[index%period];
      return {id:id++,classId,recordId:member?.id??null,name:member?.title??''};
    });
  }).flat();
}
