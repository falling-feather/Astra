export const ARCHIVE_MAX_FPS=30;

/** The simulation still advances by elapsed time; only redundant draws are skipped. */
export function archiveFrameIsDue(now:number,lastFrame:number|null,reduced:boolean):boolean {
  return reduced||lastFrame===null||now-lastFrame>=1000/ARCHIVE_MAX_FPS-.5;
}
