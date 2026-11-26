/**
 * Made-up data for the phone mockup. Nothing here is read from or saved to
 * the real app.
 */

export type MockMode = "work" | "daily-life" | "chores";
export type ModeView = MockMode | "general";
export type MockState = "running" | "ready" | "blocked" | "done";

export const MODES: { id: ModeView; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "🧭" },
  { id: "work", label: "Work", icon: "💼" },
  { id: "daily-life", label: "Daily life", icon: "☀️" },
  { id: "chores", label: "Chores", icon: "🧺" },
];

export const modeOf = (id: ModeView) => MODES.find((m) => m.id === id)!;

export interface MockTask {
  id: string;
  title: string;
  mode: MockMode;
  state: MockState;
  priority: 1 | 2 | 3 | 4;
  /** Time guess, minutes. */
  guess?: number;
  /** Shown as is, e.g. "Today 2:00 PM". */
  due?: string;
  /** Planned start today, in hours (10.5 = 10:30 AM). */
  start?: number;
  /** Minutes already counted. */
  spent: number;
  blockedBy?: string;
}

/** The clock in the mockup is fixed: 10:15 AM. */
export const NOW_HOUR = 10.25;

export const START_TASKS: MockTask[] = [
  { id: "slides", title: "Finish slides for Thursday's meeting", mode: "work", state: "running", priority: 1, guess: 60, due: "Tomorrow 2:00 PM", start: 9.75, spent: 32 },
  { id: "report", title: "Draft the monthly report", mode: "work", state: "ready", priority: 2, guess: 90, due: "Mon", start: 13.5, spent: 0 },
  { id: "dentist", title: "Book dentist appointment", mode: "daily-life", state: "ready", priority: 3, guess: 10, due: "Fri", spent: 0 },
  { id: "alex", title: "Reply to Alex about Saturday", mode: "daily-life", state: "ready", priority: 3, guess: 5, spent: 0 },
  { id: "laundry", title: "Laundry", mode: "chores", state: "ready", priority: 3, guess: 20, start: 19.75, spent: 0 },
  { id: "plan", title: "Update the project plan", mode: "work", state: "blocked", priority: 2, guess: 45, spent: 0, blockedBy: "Get budget sign-off from Sam" },
  { id: "budget", title: "Get budget sign-off from Sam", mode: "work", state: "blocked", priority: 2, guess: 15, spent: 0, blockedBy: "Update the project plan" },
  { id: "expense", title: "Follow up on expense claim", mode: "work", state: "blocked", priority: 3, guess: 10, spent: 0, blockedBy: "A reply from finance" },
  { id: "groceries", title: "Groceries for the week", mode: "daily-life", state: "done", priority: 2, guess: 45, spent: 50, due: "Yesterday" },
  { id: "bins", title: "Take the bins out", mode: "chores", state: "done", priority: 4, guess: 5, spent: 4 },
];

export type NoticeKind = "deadlock" | "waiting" | "checkin" | "reward";

export interface Notice {
  id: string;
  kind: NoticeKind;
  icon: string;
  /** The short name on the floating button. */
  name: string;
}

export const START_NOTICES: Notice[] = [
  { id: "deadlock", kind: "deadlock", icon: "🔁", name: "Blocking each other" },
  { id: "waiting", kind: "waiting", icon: "⏳", name: "Waiting 15 days" },
  { id: "checkin", kind: "checkin", icon: "📅", name: "3 calendar items" },
  { id: "reward", kind: "reward", icon: "✨", name: "New stats card" },
];

export const CHECKIN_ITEMS = [
  { id: "c1", title: "Team stand-up", time: "11:00 AM" },
  { id: "c2", title: "Pick up parcel", time: "4:30 PM" },
  { id: "c3", title: "Call with Mum", time: "8:00 PM" },
];

/** Today's calendar items (busy time). */
export const CALENDAR_TODAY = [
  { from: 7, to: 9, title: "Morning routine" },
  { from: 11, to: 11.5, title: "Team stand-up" },
  { from: 12.5, to: 13.5, title: "Lunch with team" },
  { from: 15, to: 16.5, title: "Class" },
  { from: 18.5, to: 19.5, title: "Gym" },
];

/** Which days this month have calendar items, for the month view's dots. */
export const MONTH = { name: "November 2026", firstWeekday: 0, days: 30, today: 25, busy: [3, 4, 6, 10, 11, 13, 17, 18, 20, 24, 25, 26, 27] };

export type ResourceId = "focus" | "energy" | "hydration";

export const RESOURCES: { id: ResourceId; label: string; color: string }[] = [
  { id: "focus", label: "Focus", color: "var(--series-focus)" },
  { id: "energy", label: "Energy", color: "var(--series-energy)" },
  { id: "hydration", label: "Hydration", color: "var(--series-hydration)" },
];

export const START_LEVELS: Record<ResourceId, number> = { focus: 64, energy: 58, hydration: 41 };

/** What tapping a ring offers, and how much each adds (made up). */
export const LOG_ITEMS: Record<ResourceId, { icon: string; name: string; adds: Partial<Record<ResourceId, number>> }[]> = {
  hydration: [
    { icon: "💧", name: "Water", adds: { hydration: 12 } },
    { icon: "🍵", name: "Tea", adds: { hydration: 8, focus: 5 } },
    { icon: "🧃", name: "Juice", adds: { hydration: 8, energy: 4 } },
  ],
  energy: [
    { icon: "☕", name: "Coffee", adds: { energy: 10, focus: 12 } },
    { icon: "🍽", name: "Meal", adds: { energy: 18 } },
    { icon: "🍪", name: "Snack", adds: { energy: 7 } },
    { icon: "😴", name: "Nap", adds: { energy: 15, focus: 6 } },
  ],
  focus: [
    { icon: "☕", name: "Coffee", adds: { energy: 10, focus: 12 } },
    { icon: "🍵", name: "Tea", adds: { hydration: 8, focus: 5 } },
    { icon: "🚶", name: "Short walk", adds: { focus: 8, energy: 3 } },
  ],
};

export interface MockMed {
  id: string;
  name: string;
  when: string;
  due: boolean;
}

export const START_MEDS: MockMed[] = [
  { id: "vitd", name: "Vitamin D", when: "After breakfast", due: true },
  { id: "mag", name: "Magnesium", when: "Before bed", due: false },
];

/** Hourly levels from 7 AM, for the resources chart (made up). */
export const DAY_SERIES: Record<ResourceId, number[]> = {
  focus: [30, 46, 70, 64],
  energy: [40, 62, 66, 58],
  hydration: [55, 48, 44, 41],
};

export const fmtHour = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const suffix = hh >= 12 && hh < 24 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${suffix}`;
};

export const fmtLength = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return [h ? `${h} h` : "", m || !h ? `${m} min` : ""].filter(Boolean).join(" ");
};

export const PRIORITY = { 1: "P1 · Urgent", 2: "P2 · High", 3: "P3 · Normal", 4: "P4 · Low" } as const;
