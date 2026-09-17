interface ArchiveLoop {start: number; length: number; count?: number}
export interface ArchiveSheet {
  x: number;
  z: number;
  row: number;
  slot: number;
  phase: number;
  speed: number;
  tone: number;
  group: number;
  direction: 1 | -1;
  loop: ArchiveLoop;
}

export const FILE_WIDTH = 4;
export const FILE_HEIGHT = 5.4;
export const FLOW_SPEED = 0.7;
const ROW_COUNT = 7;
const SHEETS_PER_ROW = 63;
const MIN_CLEARANCE = 0.18;
const wrap = (value: number, length: number) => ((value % length) + length) % length;

export function createArchiveSheets(): ArchiveSheet[] {
  const sheets: ArchiveSheet[] = [];
  const loop: ArchiveLoop = {start: -24, length: 48};
  for (let row = 0; row < ROW_COUNT; row += 1) {
    for (let slot = 0; slot < SHEETS_PER_ROW; slot += 1) {
      sheets.push({
        x: (row - 3) * 4.85,
        z: loop.start + (slot + 0.5) * loop.length / SHEETS_PER_ROW,
        row, slot, phase: 0, speed: 1, loop,
        tone: ((slot * 13 + row * 7) % 17) / 17,
        group: Math.floor(slot / 9) * ROW_COUNT + row,
        direction: row % 2 === 0 ? -1 : 1,
      });
    }
  }
  return sheets;
}

/** Resize the shared offscreen loop without resetting any folder's progress. */
export function resizeArchiveLoop(sheets: ArchiveSheet[], start: number, length: number) {
  const loop = sheets[0]?.loop;
  if (!loop) return;
  const scale = length / loop.length;
  for (const sheet of sheets) {
    sheet.z = start + (sheet.slot + 0.5) * length / (loop.count ?? SHEETS_PER_ROW);
    sheet.phase *= scale;
  }
  loop.start = start;
  loop.length = length;
}

function flowPosition(sheet: ArchiveSheet) {
  return sheet.loop.start + wrap(sheet.z - sheet.loop.start + sheet.direction * sheet.phase, sheet.loop.length);
}

/** Pinned folders retain their identity; approaching folders yield instead of passing through them. */
export function advanceArchiveFlow(sheets: ArchiveSheet[], delta: number, focusIndex: number | null, reduced: boolean) {
  const dt = Math.min(Math.max(delta, 0), 0.2);
  if (reduced) {
    for (const sheet of sheets) sheet.speed = 0;
    return;
  }
  const positions = sheets.map(flowPosition);
  const focus = focusIndex === null ? undefined : sheets[focusIndex];
  const easing = 1 - Math.exp(-dt * 20);
  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index]!;
    const count = sheet.loop.count ?? SHEETS_PER_ROW;
    const nextSlot = wrap(sheet.slot + sheet.direction, count);
    const nextIndex = index - sheet.slot + nextSlot;
    const gap = wrap((positions[nextIndex]! - positions[index]!) * sheet.direction, sheet.loop.length);
    const spacing = sheet.loop.length / count;
    const distance = focus ? Math.hypot(sheet.x - focus.x, positions[index]! - positions[focusIndex!]!) : Infinity;
    const activity = Math.max(0, Math.min(1, (distance - 0.85) / 0.85));
    // A little headway recovery restores spacing after release without rewinding or snapping.
    const headway = Math.max(0, Math.min(1.2, (gap - MIN_CLEARANCE) / (spacing - MIN_CLEARANCE)));
    const target = activity * headway;
    sheet.speed += (target - sheet.speed) * easing;
    if (activity === 0 && sheet.speed < 0.015) sheet.speed = 0;
    const travel = Math.min(dt * FLOW_SPEED * sheet.speed, Math.max(0, gap - MIN_CLEARANCE));
    sheet.phase += travel;
  }
}

export function archiveSheetPose(sheet: ArchiveSheet, spread = 0) {
  return {
    x: sheet.x * (1 + spread * 0.16),
    y: FILE_HEIGHT / 2 + 0.65 + Math.sin(sheet.slot * 0.3) * 0.10,
    // With the archive camera, +Z projects lower-right and -Z upper-left.
    z: flowPosition(sheet) * (1 + spread * 0.10),
  };
}

/** A cluster references a real dossier; recycling never creates or changes that record. */
export function dossierIndexForSheet(sheet: ArchiveSheet, count: number) {
  return count > 0 ? sheet.group % count : -1;
}
