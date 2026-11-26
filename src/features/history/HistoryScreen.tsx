"use client";

import { useMemo, useState } from "react";
import {
  ARCHIVE_DAYS,
  countByFilter,
  filterHistory,
  getMode,
  historyItems,
  TASK_MODES,
  type HistoryFilter,
  type HistoryItem,
  type HistoryQuery,
  type HistoryRange,
  type TaskModeId,
} from "@/core";
import { useNow } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes, formatWhen } from "@/ui/format";
import { Button, Card, Empty, Pill } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import assist from "@/features/assist/assist.module.css";
import { EditTimeDialog } from "@/features/assist/TimeTaken";
import s from "./history.module.css";

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
  { id: "late", label: "Late" },
  { id: "overdue", label: "Overdue" },
  { id: "replaced", label: "Replaced" },
  { id: "deleted", label: "Deleted" },
];

const RANGES: { id: HistoryRange; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
];

const EMPTY: Record<HistoryFilter, string> = {
  all: "Nothing here yet. Finished, overdue, replaced and deleted tasks show up here.",
  done: "No finished tasks in this range.",
  late: "Nothing finished late in this range.",
  overdue: "Nothing overdue. Every open task is still before its deadline.",
  replaced: "No repeat days were replaced in this range.",
  deleted: "Nothing deleted in this range.",
};

export function HistoryScreen() {
  const now = useNow(60_000);
  const nowMs = Date.parse(now);
  const tasks = useMios((st) => st.tasks);
  const archive = useMios((st) => st.archive);
  const [query, setQuery] = useState<HistoryQuery>({ filter: "all", mode: "all", range: "all", search: "" });

  const all = useMemo(() => historyItems(tasks, archive, nowMs), [tasks, archive, nowMs]);
  // Chip counts follow the other filters (mode, range, search), so they always match the list.
  const scoped = useMemo(() => filterHistory(all, { ...query, filter: "all" }, nowMs), [all, query, nowMs]);
  const counts = useMemo(() => countByFilter(scoped), [scoped]);
  const shown = useMemo(() => filterHistory(all, query, nowMs), [all, query, nowMs]);
  const set = (patch: Partial<HistoryQuery>) => setQuery((q) => ({ ...q, ...patch }));

  return (
    <div className={s.screen}>
      <header>
        <h1 className={s.pageTitle}>History</h1>
        <p className={s.lead}>
          Everything that has ended: finished, overdue, replaced or deleted. Deleted and replaced tasks stay {ARCHIVE_DAYS}{" "}
          days, so you can bring them back.
        </p>
      </header>

      <Card>
        <div className={s.filters} role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={query.filter === f.id}
              className={s.chip}
              onClick={() => set({ filter: f.id })}
            >
              {f.label} <span className={s.count}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className={s.controls}>
          <label>
            Mode
            <select value={query.mode} onChange={(e) => set({ mode: e.target.value as TaskModeId | "all" })}>
              <option value="all">All modes</option>
              {TASK_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            When
            <select value={query.range} onChange={(e) => set({ range: e.target.value as HistoryRange })}>
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className={s.search}>
            Search
            <input type="search" value={query.search} placeholder="Task title" onChange={(e) => set({ search: e.target.value })} />
          </label>
        </div>
      </Card>

      <Card title={`${shown.length} ${shown.length === 1 ? "task" : "tasks"}`}>
        {shown.length ? (
          <ul className={s.list}>
            {shown.map((item) => (
              <HistoryRow key={`${item.status}-${item.task.id}`} item={item} now={now} />
            ))}
          </ul>
        ) : (
          <Empty>{EMPTY[query.filter]}</Empty>
        )}
      </Card>
    </div>
  );
}

const statusTag = (item: HistoryItem): { label: string; tone: "neutral" | "tag" | "warn" } => {
  switch (item.status) {
    case "done":
      return item.onTime === true
        ? { label: "Done on time", tone: "tag" }
        : item.onTime === false
          ? { label: "Done late", tone: "warn" }
          : { label: "Done", tone: "tag" };
    case "overdue":
      return { label: "Overdue", tone: "warn" };
    case "replaced":
      return { label: "Replaced", tone: "neutral" };
    case "deleted":
      return { label: "Deleted", tone: "neutral" };
  }
};

const endedLabel = (item: HistoryItem, now: Date): string => {
  const when = formatWhen(item.endedAt, now);
  switch (item.status) {
    case "done":
      return `Finished ${when}`;
    case "overdue":
      return `Due ${when}`;
    case "replaced":
      return `Replaced ${when}`;
    case "deleted":
      return `Deleted ${when}`;
  }
};

function HistoryRow({ item, now }: { item: HistoryItem; now: string }) {
  const restore = useMios((st) => st.restoreTask);
  const purge = useMios((st) => st.purgeArchived);
  const toast = useToast((t) => t.show);
  const t = item.task;
  const tag = statusTag(item);
  const nowDate = new Date(Date.parse(now));
  const archived = item.status === "replaced" || item.status === "deleted";
  // Finished tasks still in the list can have their time corrected.
  const editable = item.status === "done" && !archived;
  const [editing, setEditing] = useState(false);

  return (
    <li className={s.row}>
      <div className={s.main}>
        <div className={s.title}>{t.title}</div>
        <div className={s.meta}>
          <Pill tone={tag.tone}>{tag.label}</Pill>
          <span>{getMode(t.mode).label}</span>
          <span>{endedLabel(item, nowDate)}</span>
          {t.deadline && item.status !== "overdue" && <span>Deadline {formatWhen(t.deadline, nowDate)}</span>}
          {(t.estimateMinutes !== undefined || t.actualMinutes >= 1) && (
            <span>
              {t.estimateMinutes !== undefined
                ? `Guessed ${formatMinutes(t.estimateMinutes)}${t.actualMinutes >= 1 ? ` · took ${formatMinutes(t.actualMinutes)}` : ""}`
                : `Took ${formatMinutes(t.actualMinutes)}`}
            </span>
          )}
          {editable && (
            <button type="button" className={assist.metaButton} onClick={() => setEditing(true)}>
              {t.actualMinutes >= 1 ? "Fix time" : "Add time"}
            </button>
          )}
          {t.source && <Pill>From calendar</Pill>}
          {t.repeat && <Pill>↻ Repeat</Pill>}
          {t.steps?.length ? (
            <span>
              Steps {t.steps.filter((x) => x.done).length}/{t.steps.length}
            </span>
          ) : null}
          {t.research?.length ? <span>Research {t.research.length}</span> : null}
        </div>
        {t.review && !t.review.skipped && t.review.answers.some((a) => a.answer) && (
          <details className={assist.answers}>
            <summary>Your review</summary>
            <dl>
              {t.review.answers
                .filter((a) => a.answer)
                .map((a) => (
                  <div key={a.question}>
                    <dt>{a.question}</dt>
                    <dd>{a.answer}</dd>
                  </div>
                ))}
            </dl>
          </details>
        )}
        {archived && item.expiresAt && (
          <div className={s.expiry}>Gone for good {formatWhen(item.expiresAt, nowDate)}.</div>
        )}
        {editing && <EditTimeDialog task={t} onClose={() => setEditing(false)} />}
      </div>
      {archived && (
        <div className={s.actions}>
          <Button
            size="sm"
            onClick={() => {
              restore(t.id);
              toast(`Restored "${t.title}".`);
            }}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="plain"
            onClick={() => {
              if (confirm(`Delete "${t.title}" for good? This can't be undone.`)) purge(t.id);
            }}
          >
            Delete for good
          </Button>
        </div>
      )}
    </li>
  );
}
