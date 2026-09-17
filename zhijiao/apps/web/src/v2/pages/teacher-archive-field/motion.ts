import { archiveSheetPose, FILE_HEIGHT, FILE_WIDTH, type ArchiveSheet } from '../archive-field/motion';
import type { StudentDossier } from './data';
export {TEACHER_VISIBLE_SLOTS} from './data';
export {FILE_HEIGHT, FILE_WIDTH};
export {advanceArchiveFlow as advanceTeacherFlow, resizeArchiveLoop} from '../archive-field/motion';
export const CLASS_LANE_GAP=7.4;
export function createTeacherSheets(students:readonly StudentDossier[]):ArchiveSheet[] {
  return [...new Set(students.map(student=>student.classId))].flatMap(row=>{
    const members=students.filter(student=>student.classId===row),loop={start:-36-row*8.5,length:members.length*1.875,count:members.length};
    return members.map((student,slot)=>({x:row*CLASS_LANE_GAP,z:loop.start+(slot+.5)*1.875,row,slot,phase:0,speed:1,tone:0,group:student.id,direction:1 as const,loop}));
  });
}
export function teacherPose(sheet:ArchiveSheet,spread=0) {
  const pose=archiveSheetPose(sheet);
  return {x:sheet.x*(1+spread*.10),y:FILE_HEIGHT/2,z:pose.z*(1+spread*.10)};
}
export function positionTeacherSheet(sheets:ArchiveSheet[],index:number,targetZ=10) {
  const selected=sheets[index];if(!selected)return;
  const shift=targetZ-teacherPose(selected).z;
  for(const sheet of sheets)if(sheet.row===selected.row)sheet.phase+=shift;
  selected.speed=0;
}
