"use client";

import { useState, type ReactNode } from "react";
import { getMode, nextOrder, splitByDeadline, type ModeId, type Task } from "@/core";
import { useDeadlocks, useModeLoad, useModeTasks, useNow, useStage, useStarved } from "@/state/hooks";
import { buildSampleTasks } from "@/state/sampleData";
import { useMios } from "@/state/store";
import { Button, Card, Empty } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { QueueAssist } from "@/features/ai/QueueAssist";
import { ResourceStrip } from "@/features/resources/ResourceStrip";
import { DeadlockPanel, ModeLoadPanel, StarvationPanel } from "./Panels";
import { TaskComposer } from "./TaskComposer";
import { BlockerDialog, EditDialog, StartDialog } from "./TaskDialogs";
import { TaskRow, type RowHandlers } from "./TaskRow";
import s from "./tasks.module.css";

export function ModeScreen({ modeId }: { modeId: ModeId }) {
  const mode = getMode(modeId);
  const now = useNow();
  const { all, running, ready, blocked, done } = useModeTasks(modeId);
  const allTasks = useMios((st) => st.tasks);
  const settings = useMios((st) => st.settings);
  const { moveTask, sortByPriority, setTaskState, updateTask, loadSample } = useMios.getState();
  const toast = useToast((st) => st.show);
  const { policy } = useStage();

  const deadlocks = useDeadlocks();
  const load = useModeLoad(now);
  const starved = useStarved(now);
  const starvedById = new Map(starved.map((f) => [f.task.id, f.daysWaiting]));
  const modeIds = new Set(all.map((t) => t.id));
  const visibleDeadlocks = deadlocks.filter((c) => c.some((e) => modeIds.has(e.taskId)));

  const [starting, setStarting] = useState<Task | null>(null);
  const [blocking, setBlocking] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);

  const start = (task: Task, estimate?: number) => {
    if (estimate) updateTask(task.id, { estimateMinutes: estimate });
    const r = setTaskState(task.id, "running");
    if (!r.ok) toast(r.error, "warn");
    setStarting(null);
  };

  const handlers: RowHandlers = {
    // A9: ask for a time guess first if there isn't one yet. At child and teen
    // stage the dialog always opens so AI can give its estimate (B4).
    onStart: (task) => (task.estimateMinutes && !policy.aiButton ? start(task) : setStarting(task)),
    onBlock: setBlocking,
    onEdit: setEditing,
  };

  const showMode = modeId === "general";
  const rowProps = { showMode, now, handlers };

  // Two queue sections side by side; each keeps its own order and numbering.
  const { timed, untimed } = splitByDeadline(ready);
  const queueRow = (t: Task, i: number, section: Task[]) => (
    <TaskRow
      key={t.id}
      task={t}
      rank={i + 1}
      starvedDays={starvedById.get(t.id)}
      queue={{ first: i === 0, last: i === section.length - 1, move: (dir) => moveTask(t.id, dir, modeId) }}
      {...rowProps}
    />
  );

  return (
    <div className={s.screen}>
      <section className={s.hero}>
        <div>
          <div className={s.heroIcon} aria-hidden>
            {mode.icon}
          </div>
          <h1 className={s.heroTitle}>{mode.label}</h1>
          <p className={s.heroBlurb}>{mode.blurb}</p>
        </div>
        <div className={s.stats}>
          <Stat value={running.length} label={`Running / ${settings.runningCap}`} />
          <Stat value={ready.length} label="Ready" />
          <Stat value={blocked.length} label="Blocked" />
        </div>
      </section>

      <ResourceStrip />

      <DeadlockPanel cycles={visibleDeadlocks} />

      <div className={s.columns}>
        <div className={s.stack}>
          {allTasks.length === 0 && (
            <Card>
              <div className={s.welcome}>
                <h2>Welcome to MiOS</h2>
                <p>
                  Your brain runs like an OS here: tasks have states, the queue is yours to order, and a referee
                  keeps protected time free. Add your first task, or load a few examples to look around.
                </p>
                <Button variant="secondary" onClick={() => loadSample(buildSampleTasks(nextOrder(allTasks)))}>
                  Load example tasks
                </Button>
              </div>
            </Card>
          )}

          <Card title="Running" hint={`Cap: ${settings.runningCap} at once. The referee holds the rest.`}>
            {running.length ? (
              <ul className={s.list}>
                {running.map((t) => (
                  <TaskRow key={t.id} task={t} {...rowProps} />
                ))}
              </ul>
            ) : (
              <Empty>Nothing running. Start the top task when you&apos;re ready.</Empty>
            )}
          </Card>
        </div>

        <aside className={s.stack}>
          <TaskComposer key={modeId} mode={modeId} />
        </aside>
      </div>

      <section className={s.queue} aria-labelledby="ready-queue">
        <header className={s.queueHeader}>
          <div>
            <h2 id="ready-queue" className={s.queueTitle}>
              Ready queue
            </h2>
            <p className={s.queueHint}>You set the order. MiOS never reorders on its own.</p>
          </div>
          <div className={s.toolbar}>
            {ready.length > 1 && (
              <Button size="sm" variant="plain" onClick={() => sortByPriority(modeId)}>
                Sort by priority & deadline
              </Button>
            )}
          </div>
        </header>
        <QueueAssist key={modeId} queue={ready} />
        <div className={s.queueColumns}>
          <QueueSection
            title="With a deadline"
            hint="Earliest deadline first after sorting."
            empty="No tasks with a deadline."
            tasks={timed}
            render={queueRow}
          />
          <QueueSection
            title="No deadline"
            hint="Open-ended tasks. Their own type, kept out of your on-time rate."
            empty="No open-ended tasks."
            tasks={untimed}
            render={queueRow}
          />
        </div>
      </section>

      <div className={s.columns}>
        <div className={s.stack}>
          {blocked.length > 0 && (
            <Card title="Blocked" hint="Waiting on a task, a person or an event.">
              <ul className={s.list}>
                {blocked.map((t) => (
                  <TaskRow key={t.id} task={t} starvedDays={starvedById.get(t.id)} {...rowProps} />
                ))}
              </ul>
            </Card>
          )}

          {done.length > 0 && (
            <Card
              title={`Done (${done.length})`}
              action={
                <Button size="sm" variant="plain" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? "Hide" : "Show"}
                </Button>
              }
            >
              {showDone && (
                <ul className={s.list}>
                  {done.map((t) => (
                    <TaskRow key={t.id} task={t} {...rowProps} />
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <aside className={s.stack}>
          <StarvationPanel flags={starved.filter((f) => modeIds.has(f.task.id))} days={settings.starvationDays} />
          <ModeLoadPanel load={load} current={modeId} />
        </aside>
      </div>

      <StartDialog key={starting?.id} task={starting} onStart={(est) => starting && start(starting, est)} onClose={() => setStarting(null)} />
      <BlockerDialog key={blocking?.id ?? "none"} task={blocking} onClose={() => setBlocking(null)} />
      <EditDialog key={editing?.id ?? "none-edit"} task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function QueueSection({
  title,
  hint,
  empty,
  tasks,
  render,
}: {
  title: string;
  hint: string;
  empty: string;
  tasks: Task[];
  render: (t: Task, i: number, section: Task[]) => ReactNode;
}) {
  return (
    <Card title={`${title} (${tasks.length})`} hint={hint}>
      {tasks.length ? <ul className={s.list}>{tasks.map((t, i) => render(t, i, tasks))}</ul> : <Empty>{empty}</Empty>}
    </Card>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={s.stat}>
      <div className={s.statValue}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}
