import type { Task } from "./types";

/**
 * A9: time-guess training. The user guesses a task's time before starting;
 * MiOS logs the actual time and shows how close the guesses get.
 */

export interface GuessSample {
  taskId: string;
  title: string;
  completedAt: string;
  estimate: number;
  actual: number;
  /** actual / estimate; 1 is a perfect guess, 2 means it took twice as long. */
  ratio: number;
}

export interface GuessAccuracy {
  samples: GuessSample[];
  /** Mean of |actual − estimate| / estimate, as a percentage. null with no data. */
  meanErrorPct: number | null;
  /** Same measure over the most recent `window` samples, to show a trend. */
  recentErrorPct: number | null;
  /** > 1 means the user tends to underestimate. */
  medianRatio: number | null;
}

const meanError = (s: readonly GuessSample[]): number | null =>
  s.length ? (s.reduce((sum, x) => sum + Math.abs(x.actual - x.estimate) / x.estimate, 0) / s.length) * 100 : null;

export const guessAccuracy = (tasks: readonly Task[], window = 5): GuessAccuracy => {
  const samples: GuessSample[] = tasks
    .filter((t) => t.state === "done" && t.estimateMinutes && t.completedAt && t.actualMinutes > 0)
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      completedAt: t.completedAt!,
      estimate: t.estimateMinutes!,
      actual: t.actualMinutes,
      ratio: t.actualMinutes / t.estimateMinutes!,
    }))
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const ratios = samples.map((s) => s.ratio).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const medianRatio = ratios.length
    ? ratios.length % 2
      ? ratios[mid]
      : (ratios[mid - 1] + ratios[mid]) / 2
    : null;

  return {
    samples,
    meanErrorPct: meanError(samples),
    recentErrorPct: meanError(samples.slice(-window)),
    medianRatio,
  };
};
