import type { Task } from "./types";

/**
 * A4 — deadlock check. Tasks can be "blocked by" other tasks; MiOS keeps the
 * dependency map, finds cycles, shows the loop, and asks the user to break
 * one link. It never breaks a link itself.
 */

/** One "A is blocked by B" edge, identified by the blocker that created it. */
export interface DependencyEdge {
  taskId: string;
  blockedByTaskId: string;
  blockerId: string;
}

/** A loop of edges: edge[i].blockedByTaskId === edge[i+1].taskId, wrapping around. */
export type DeadlockCycle = DependencyEdge[];

/** Edges between tasks that are not Done (a Done task no longer blocks anything). */
export const dependencyEdges = (tasks: readonly Task[]): DependencyEdge[] => {
  const open = new Set(tasks.filter((t) => t.state !== "done").map((t) => t.id));
  return tasks.flatMap((t) =>
    open.has(t.id)
      ? t.blockedBy.flatMap((b) =>
          b.kind === "task" && open.has(b.taskId)
            ? [{ taskId: t.id, blockedByTaskId: b.taskId, blockerId: b.id }]
            : [],
        )
      : [],
  );
};

/**
 * Find deadlocks. Returns one loop per strongly connected group of tasks,
 * so each independent deadlock is reported once.
 */
export const findDeadlocks = (tasks: readonly Task[]): DeadlockCycle[] => {
  const edges = dependencyEdges(tasks);
  const out = new Map<string, DependencyEdge[]>();
  for (const e of edges) {
    const list = out.get(e.taskId) ?? [];
    list.push(e);
    out.set(e.taskId, list);
  }

  // Tarjan's strongly connected components.
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const e of out.get(v) ?? []) {
      const w = e.blockedByTaskId;
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      components.push(comp);
    }
  };

  for (const id of out.keys()) if (!idx.has(id)) visit(id);

  const cycles: DeadlockCycle[] = [];
  for (const comp of components) {
    const members = new Set(comp);
    const selfLoop = comp.length === 1 && (out.get(comp[0]) ?? []).some((e) => e.blockedByTaskId === comp[0]);
    if (comp.length < 2 && !selfLoop) continue;
    const cycle = traceCycle(comp[0], members, out);
    if (cycle) cycles.push(cycle);
  }
  return cycles;
};

/** Walk inside one component until we return to the start, giving a concrete loop to show. */
const traceCycle = (
  start: string,
  members: ReadonlySet<string>,
  out: ReadonlyMap<string, DependencyEdge[]>,
): DeadlockCycle | null => {
  const path: DependencyEdge[] = [];
  const seen = new Set<string>();
  const dfs = (v: string): boolean => {
    seen.add(v);
    for (const e of out.get(v) ?? []) {
      if (!members.has(e.blockedByTaskId)) continue;
      path.push(e);
      if (e.blockedByTaskId === start) return true;
      if (!seen.has(e.blockedByTaskId) && dfs(e.blockedByTaskId)) return true;
      path.pop();
    }
    return false;
  };
  return dfs(start) ? path : null;
};

/** Would adding "taskId is blocked by blockedByTaskId" close a loop? */
export const wouldDeadlock = (tasks: readonly Task[], taskId: string, blockedByTaskId: string): boolean => {
  if (taskId === blockedByTaskId) return true;
  const edges = dependencyEdges(tasks);
  // Is there already a path blockedByTaskId → … → taskId?
  const stack = [blockedByTaskId];
  const seen = new Set<string>();
  while (stack.length) {
    const v = stack.pop()!;
    if (v === taskId) return true;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const e of edges) if (e.taskId === v) stack.push(e.blockedByTaskId);
  }
  return false;
};
