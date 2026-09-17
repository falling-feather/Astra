import { afterEach, describe, expect, it, vi } from "vitest";
import { runFieldTransition } from "../src/v2/pages/node-field/transition";

afterEach(() => vi.useRealTimers());
describe("node transition ordering", () => {
  it("covers the old scene before swapping and only then restores interaction", async () => {
    vi.useFakeTimers();
    const steps: string[] = [];
    const run = runFieldTransition({ hasScene: true, reducedMotion: false, signal: new AbortController().signal,
      load: async () => { steps.push("load"); return true; }, swap: () => steps.push("swap"), phase: value => steps.push(value),
    });
    expect(steps).toEqual(["leaving"]);
    await vi.advanceTimersByTimeAsync(180);
    expect(steps).toEqual(["leaving", "loading", "load", "swap", "arriving"]);
    await vi.runAllTimersAsync(); await run;
    expect(steps.at(-1)).toBe("ready");
  });
  it("does not apply a superseded scene when a slow load finishes", async () => {
    const controller = new AbortController(); const swap = vi.fn(); const phases: string[] = [];
    let finish!: (value: boolean) => void;
    const run = runFieldTransition({ hasScene: false, reducedMotion: true, signal: controller.signal,
      load: () => new Promise<boolean>(resolve => { finish = resolve; }), swap, phase: phase => phases.push(phase),
    });
    controller.abort(); finish(true); await run;
    expect(swap).not.toHaveBeenCalled(); expect(phases).not.toContain("ready");
  });
  it("supports reduced motion without timers and keeps failure observable", async () => {
    vi.useFakeTimers(); const steps: string[] = [];
    await runFieldTransition({ hasScene: true, reducedMotion: true, signal: new AbortController().signal, load: async () => true, swap: () => steps.push("swap"), phase: phase => steps.push(phase) });
    expect(steps).toEqual(["loading", "swap", "ready"]); expect(vi.getTimerCount()).toBe(0);
    await expect(runFieldTransition({ hasScene: false, reducedMotion: true, signal: new AbortController().signal, load: async () => { throw new Error("missing scene"); }, swap: () => {}, phase: () => {} })).rejects.toThrow("missing scene");
  });
});
