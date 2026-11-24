import type { Task } from "@/core";

/**
 * Demo tasks for a first look at MiOS, including one deadlock so the
 * deadlock check has something to show.
 */
export const buildSampleTasks = (startOrder: number): Task[] => {
  const now = new Date();
  const iso = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * 3_600_000).toISOString();
  const at = now.toISOString();
  const id = () => crypto.randomUUID();

  const ids = { plan: id(), signOff: id(), expenses: id(), laundry: id(), dentist: id(), groceries: id(), slides: id() };
  let order = startOrder;

  const base = (t: Partial<Task> & Pick<Task, "id" | "title" | "mode">): Task => ({
    state: "ready",
    priority: 2,
    order: order++,
    blockedBy: [],
    isInterrupt: false,
    actualMinutes: 0,
    createdAt: at,
    updatedAt: at,
    stateChangedAt: at,
    ...t,
  });

  return [
    base({ id: ids.slides, title: "Finish slides for Thursday's meeting", mode: "work", priority: 1, deadline: iso(20), estimateMinutes: 60 }),
    base({ id: ids.groceries, title: "Groceries for the week", mode: "daily-life", priority: 2, estimateMinutes: 45 }),
    base({ id: ids.laundry, title: "Laundry", mode: "chores", priority: 3, estimateMinutes: 20 }),
    base({ id: ids.dentist, title: "Book dentist appointment", mode: "daily-life", priority: 3, deadline: iso(72), estimateMinutes: 10 }),
    base({
      id: ids.plan,
      title: "Update the project plan",
      mode: "work",
      priority: 2,
      state: "blocked",
      estimateMinutes: 90,
      blockedBy: [{ id: id(), kind: "task", taskId: ids.signOff }],
    }),
    base({
      id: ids.signOff,
      title: "Get budget sign-off from Sam",
      mode: "work",
      priority: 2,
      state: "blocked",
      estimateMinutes: 15,
      blockedBy: [{ id: id(), kind: "task", taskId: ids.plan }],
    }),
    base({
      id: ids.expenses,
      title: "Follow up on expense claim",
      mode: "work",
      priority: 2,
      state: "blocked",
      estimateMinutes: 10,
      stateChangedAt: iso(-24 * 15),
      blockedBy: [{ id: id(), kind: "person", label: "Reply from finance", resolved: false }],
    }),
  ];
};
