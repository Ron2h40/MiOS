"use client";

import { useMemo } from "react";
import type { DueReward, ModeId } from "@/core";
import { tasksInMode } from "@/core";
import { useDeadlocks, useDueRewards, usePendingToday, useStarved } from "@/state/hooks";
import { useMios } from "@/state/store";

/**
 * Everything that needs you, for the phone's floating button. Each comes from
 * the data, so once it's sorted it's gone from the button.
 */
export type PhoneNotice =
  | { id: "deadlock"; kind: "deadlock"; icon: string; name: string }
  | { id: "waiting"; kind: "waiting"; icon: string; name: string }
  | { id: "checkin"; kind: "checkin"; icon: string; name: string }
  | { id: "reward"; kind: "reward"; icon: string; name: string; reward: DueReward };

export const useNotices = (mode: ModeId, now: string): PhoneNotice[] => {
  const tasks = useMios((st) => st.tasks);
  const deadlocks = useDeadlocks();
  const starved = useStarved(now);
  const pending = usePendingToday(now);
  const rewards = useDueRewards(now);

  return useMemo(() => {
    const ids = new Set(tasksInMode(tasks, mode).map((t) => t.id));
    const cycles = deadlocks.filter((c) => c.some((e) => ids.has(e.taskId)));
    const waiting = starved.filter((f) => ids.has(f.task.id));
    const out: PhoneNotice[] = [];
    if (cycles.length) out.push({ id: "deadlock", kind: "deadlock", icon: "🔁", name: "Blocking each other" });
    if (waiting.length) {
      const days = waiting[0].daysWaiting;
      out.push({
        id: "waiting",
        kind: "waiting",
        icon: "⏳",
        name: waiting.length === 1 ? `Waiting ${days} days` : `${waiting.length} waiting too long`,
      });
    }
    if (pending.length) out.push({ id: "checkin", kind: "checkin", icon: "📅", name: `${pending.length} calendar ${pending.length === 1 ? "item" : "items"}` });
    if (rewards.length) {
      const r = rewards[0];
      out.push({ id: "reward", kind: "reward", icon: r.kind === "milestone" ? "🏅" : "✨", name: r.kind === "milestone" ? "New milestone" : "New stats card", reward: r });
    }
    return out;
  }, [tasks, mode, deadlocks, starved, pending, rewards]);
};
