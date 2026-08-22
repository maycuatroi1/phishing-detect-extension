export interface ManualClock {
  readonly setTimer: (run: () => void, delayMs: number) => number;
  readonly clearTimer: (handle: number) => void;
  scheduledDelays(): readonly number[];
  settle(): Promise<void>;
}

async function drain(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 0);
    });
  }
}

export function manualClock(): ManualClock {
  const pending = new Map<number, { run: () => void; delayMs: number }>();
  const scheduled: number[] = [];
  let nextHandle = 1;

  return {
    setTimer: (run, delayMs) => {
      const handle = nextHandle;
      nextHandle += 1;
      scheduled.push(delayMs);
      pending.set(handle, { run, delayMs });
      return handle;
    },
    clearTimer: (handle) => {
      pending.delete(handle);
    },
    scheduledDelays: () => scheduled.slice(),
    settle: async () => {
      for (let round = 0; round < 64; round += 1) {
        await drain();
        if (pending.size === 0) {
          await drain();
          if (pending.size === 0) {
            break;
          }
        }
        for (const [handle, timer] of Array.from(pending.entries())) {
          pending.delete(handle);
          timer.run();
        }
      }
      await drain();
    },
  };
}
