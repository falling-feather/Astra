export type FieldTransitionPhase = "initial" | "leaving" | "loading" | "arriving" | "ready" | "failed";

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function runFieldTransition(input: {
  hasScene: boolean;
  reducedMotion: boolean;
  signal: AbortSignal;
  load(): Promise<boolean>;
  swap(): void;
  phase(value: FieldTransitionPhase): void;
}): Promise<void> {
  if (input.signal.aborted) return;
  if (input.hasScene && !input.reducedMotion) {
    input.phase("leaving");
    await pause(180, input.signal);
    if (input.signal.aborted) return;
  }
  input.phase("loading");
  const applied = await input.load();
  if (input.signal.aborted || !applied) return;
  input.swap();
  if (!input.reducedMotion) {
    input.phase("arriving");
    await pause(240, input.signal);
    if (input.signal.aborted) return;
  }
  input.phase("ready");
}
