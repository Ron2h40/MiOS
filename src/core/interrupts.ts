import { projectQueue, remainingMinutes } from "./scheduler";
import { minutesBetween } from "./time";
import type { ISODateTime, Task } from "./types";

/**
 * A3: interrupts. When the user flags an incoming item as an interrupt,
 * MiOS shows what running it first would push back. It never reorders tasks
 * on its own; the user decides.
 */

export interface PushedBack {
  task: Task;
  delayMinutes: number;
  finishBefore: ISODateTime;
  finishAfter: ISODateTime;
  /** On time before the interrupt, late after it. */
  newlyLate: boolean;
}

export interface InterruptPreview {
  interruptMinutes: number;
  pushedBack: PushedBack[];
  /** Tasks that would now miss their deadline. */
  newlyLateCount: number;
}

export const previewInterrupt = (
  queue: readonly Task[],
  interrupt: Task,
  now: ISODateTime,
  defaultEstimate: number,
): InterruptPreview => {
  const rest = queue.filter((t) => t.id !== interrupt.id);
  const before = projectQueue(rest, now, defaultEstimate);
  const after = projectQueue([interrupt, ...rest], now, defaultEstimate).slice(1);

  const pushedBack = before.map((b, i) => {
    const a = after[i];
    return {
      task: b.task,
      delayMinutes: Math.round(minutesBetween(b.finish, a.finish)),
      finishBefore: b.finish,
      finishAfter: a.finish,
      newlyLate: !b.late && a.late,
    };
  });

  return {
    interruptMinutes: remainingMinutes(interrupt, defaultEstimate),
    pushedBack,
    newlyLateCount: pushedBack.filter((p) => p.newlyLate).length,
  };
};
