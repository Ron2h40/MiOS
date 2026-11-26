"use client";

import { create } from "zustand";
import type { ResourceKey } from "@/core";

/**
 * Phone layout state that isn't data: which page is showing, the schedule
 * filter, and the one window open on top. Opening a window adds a history
 * step, so the phone's back gesture closes it instead of leaving MiOS.
 */
export type PhoneTab = "home" | "schedule" | "me";
export type PhoneFilter = "all" | "running" | "ready" | "blocked";

export type PhoneWindow =
  | { kind: "mode" }
  | { kind: "log"; resource?: ResourceKey }
  | { kind: "notice"; id: string }
  /** A task's actions, from Schedule. */
  | { kind: "task"; id: string }
  /** The full new-task form; `start` when a free gap was tapped. */
  | { kind: "add"; start?: string }
  /** One AI feature, in its own window. */
  | { kind: "ai"; feature: "order" | "schedule" };

interface PhoneUi {
  tab: PhoneTab;
  filter: PhoneFilter;
  window: PhoneWindow | null;
  /** A history step was added for the open window. */
  pushed: boolean;
  setTab(tab: PhoneTab): void;
  /** Open Schedule showing only one kind of task. */
  showOnSchedule(filter: PhoneFilter): void;
  setFilter(filter: PhoneFilter): void;
  open(w: PhoneWindow): void;
  /** Close the open window (through history, so back and ✕ behave the same). */
  close(): void;
  /** The back gesture happened. */
  popped(): void;
}

export const usePhoneUi = create<PhoneUi>((set, get) => ({
  tab: "home",
  filter: "all",
  window: null,
  pushed: false,
  setTab: (tab) => set({ tab, ...(tab === "schedule" ? { filter: "all" as const } : {}) }),
  showOnSchedule: (filter) => set({ tab: "schedule", filter }),
  setFilter: (filter) => set({ filter }),
  open: (w) => {
    if (!get().pushed) window.history.pushState({ ...window.history.state, miosWindow: true }, "");
    set({ window: w, pushed: true });
  },
  close: () => {
    if (get().pushed) window.history.back();
    else set({ window: null });
  },
  popped: () => set({ window: null, pushed: false }),
}));
