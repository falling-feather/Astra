import {describe, expect, it} from 'vitest';
import {OrthographicCamera, Vector3} from 'three';
import {advanceArchiveFlow, archiveSheetPose, createArchiveSheets, dossierIndexForSheet, FLOW_SPEED, resizeArchiveLoop} from '../src/v2/pages/archive-field/motion';

function screenPosition(sheet: ReturnType<typeof createArchiveSheets>[number]) {
  const camera = new OrthographicCamera(-12, 12, 6.5, -6.5, .1, 100);
  camera.position.set(-22, 23, 28);
  camera.lookAt(0, 2.6, 0);
  camera.updateMatrixWorld();
  const pose = archiveSheetPose(sheet);
  const projected = new Vector3(pose.x, pose.y, pose.z).project(camera);
  return {x: projected.x, y: -projected.y};
}

describe('archive continuous flow', () => {
  it('keeps 441 folders and every dossier group in seven equally spaced rows', () => {
    const sheets = createArchiveSheets();
    expect(sheets).toHaveLength(441);
    expect(new Set(sheets.map(sheet => sheet.group)).size).toBe(49);
    for(let row=0;row<7;row++) {
      const lane = sheets.filter(sheet => sheet.row === row);
      expect(lane).toHaveLength(63);
      expect(new Set(lane.map(sheet => sheet.x)).size).toBe(1);
      expect(new Set(lane.map(sheet => sheet.direction)).size).toBe(1);
      expect(lane[0]!.direction).toBe(row % 2 === 0 ? -1 : 1);
      const positions = lane.map(sheet => archiveSheetPose(sheet).z).sort((a,b)=>a-b);
      for(let index=1;index<positions.length;index++)expect(positions[index]!-positions[index-1]!).toBeCloseTo(lane[0]!.loop.length/63);
    }
  });

  it('continuously travels upper-left / lower-right in alternating rows without reversing', () => {
    const sheets = createArchiveSheets();
    const pair = [sheets[31]!, sheets[94]!];
    let before = pair.map(screenPosition);
    for(let second=1;second<=20;second++) {
      for(let frame=0;frame<60;frame++)advanceArchiveFlow(sheets,1/60,null,false);
      const after = pair.map(screenPosition);
      const moves = after.map((point,index)=>({x:point.x-before[index]!.x,y:point.y-before[index]!.y}));
      expect(moves[0]!.x).toBeLessThan(-.02);
      expect(moves[0]!.y).toBeLessThan(-.02);
      expect(moves[1]!.x).toBeCloseTo(-moves[0]!.x);
      expect(moves[1]!.y).toBeCloseTo(-moves[0]!.y);
      before = after;
    }
  });

  it('recycles in both directions with no seam gap or dossier change', () => {
    const sheets = createArchiveSheets();
    const initial = sheets.map(sheet=>archiveSheetPose(sheet));
    const groups = sheets.map(sheet=>dossierIndexForSheet(sheet,5));
    let remaining = sheets[0]!.loop.length/FLOW_SPEED;
    while(remaining>1e-8) {
      const step = Math.min(.1,remaining);
      advanceArchiveFlow(sheets,step,null,false);
      remaining-=step;
    }
    sheets.forEach((sheet,index)=>expect(archiveSheetPose(sheet).z).toBeCloseTo(initial[index]!.z,5));
    expect(sheets.map(sheet=>dossierIndexForSheet(sheet,5))).toEqual(groups);
    expect(sheets).toHaveLength(441);
  });

  it('preserves progress when fitting the loop to a new viewport', () => {
    const sheets = createArchiveSheets();
    for(let frame=0;frame<300;frame++)advanceArchiveFlow(sheets,1/60,null,false);
    const loop = {...sheets[0]!.loop};
    const fractions = sheets.map(sheet=>(archiveSheetPose(sheet).z-loop.start)/loop.length);
    resizeArchiveLoop(sheets,-40,80);
    sheets.forEach((sheet,index)=>expect((archiveSheetPose(sheet).z+40)/80).toBeCloseTo(fractions[index]!,6));
  });

  it('keeps the same flow speed at high and low frame rates', () => {
    const smooth = createArchiveSheets(), slow = createArchiveSheets();
    for(let frame=0;frame<600;frame++)advanceArchiveFlow(smooth,1/60,null,false);
    for(let frame=0;frame<50;frame++)advanceArchiveFlow(slow,1/5,null,false);
    slow.forEach((sheet,index)=>expect(archiveSheetPose(sheet).z).toBeCloseTo(archiveSheetPose(smooth[index]!).z,5));
  });

  it('holds nearby folders, keeps distant rows moving and avoids overlap during a long hover', () => {
    const sheets = createArchiveSheets(), focus=220, remote=20;
    for(let frame=0;frame<90;frame++)advanceArchiveFlow(sheets,1/60,focus,false);
    const held = sheets[focus]!.phase, far = sheets[remote]!.phase;
    for(let frame=0;frame<1800;frame++)advanceArchiveFlow(sheets,1/60,focus,false);
    expect(sheets[focus]!.phase).toBe(held);
    expect(sheets[remote]!.phase-far).toBeGreaterThan(10);
    const lane = sheets.filter(sheet=>sheet.row===sheets[focus]!.row);
    const positions = lane.map(sheet=>archiveSheetPose(sheet).z).sort((a,b)=>a-b);
    for(let index=1;index<positions.length;index++)expect(positions[index]!-positions[index-1]!).toBeGreaterThan(.17);
    const position = archiveSheetPose(sheets[focus]!);
    advanceArchiveFlow(sheets,1/60,null,false);
    expect(Math.abs(archiveSheetPose(sheets[focus]!).z-position.z)).toBeLessThan(.03);
    for(let frame=0;frame<120;frame++)advanceArchiveFlow(sheets,1/60,null,false);
    expect(sheets[focus]!.phase).toBeGreaterThan(held);
  });

  it('keeps reduced-motion positions still without losing dossier identity', () => {
    const sheets=createArchiveSheets(),before=sheets.map(sheet=>archiveSheetPose(sheet));
    advanceArchiveFlow(sheets,1,null,true);
    expect(sheets.map(sheet=>archiveSheetPose(sheet))).toEqual(before);
    expect(dossierIndexForSheet(sheets[0]!,0)).toBe(-1);
  });
});
