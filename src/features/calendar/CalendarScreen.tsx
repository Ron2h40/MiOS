"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { CALENDAR_COLORS, dayKey, getMode, type CalendarEvent, type CalendarSource, type MergeReport } from "@/core";
import { buildIcs, parseIcs } from "@/integrations/ics";
import { useAgenda, useCalendarLooks, useNow, usePendingToday } from "@/state/hooks";
import { useMios } from "@/state/store";
import { Button, Card, Empty } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { DayList } from "./AgendaList";
import { CheckInDialog } from "./CheckIn";
import { GoogleCard } from "./GoogleSync";
import s from "./calendar.module.css";
import { calStyle, lookOf } from "./colors";

const DAYS_SHOWN = 7;

const reportLine = (name: string, r: MergeReport) => {
  const here = r.duplicates + r.alreadyInMios;
  const parts = [
    r.added && `${r.added} new`,
    r.updated && `${r.updated} updated`,
    here && `${here} already here`,
  ].filter(Boolean);
  return `${name}: ${parts.length ? parts.join(", ") : "nothing in the next 6 months"}.`;
};

export function CalendarScreen() {
  const now = useNow(60_000);
  const tasks = useMios((st) => st.tasks);
  const settings = useMios((st) => st.settings);
  const events = useMios((st) => st.calendarEvents);
  const decisions = useMios((st) => st.calendarDecisions);
  const sources = useMios((st) => st.calendarSources);
  const importCalendar = useMios((st) => st.importCalendar);
  const forget = useMios((st) => st.forgetCalendarDecision);
  const pending = usePendingToday(now);
  const toast = useToast((t) => t.show);
  const fileRef = useRef<HTMLInputElement>(null);
  const [checkIn, setCheckIn] = useState(false);
  const [withDeadlines, setWithDeadlines] = useState(true);

  const today = useMemo(() => new Date(Date.parse(now)), [now]);
  const agenda = useAgenda(today, DAYS_SHOWN, now);
  const days = [...agenda.entries()];

  const onFiles = async (ev: ChangeEvent<HTMLInputElement>) => {
    const files = [...(ev.target.files ?? [])];
    ev.target.value = "";
    const lines: string[] = [];
    for (const f of files) {
      try {
        const parsed = parseIcs(await f.text(), "import", Date.now());
        const report = importCalendar({ fileName: f.name, name: parsed.name, color: parsed.color, events: parsed.events });
        lines.push(reportLine(parsed.name ?? f.name, report));
      } catch {
        toast(`Couldn't read ${f.name}. Is it an .ics calendar file?`, "warn");
        return;
      }
    }
    if (lines.length) toast(lines.join(" "));
  };

  const exportable = useMemo(() => buildIcs(tasks, settings, { includeDeadlines: withDeadlines }, 0).count, [tasks, settings, withDeadlines]);

  const download = () => {
    const { ics, count } = buildIcs(tasks, settings, { includeDeadlines: withDeadlines }, Date.now());
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mios-${dayKey(Date.now())}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${count} ${count === 1 ? "item" : "items"}.`);
  };

  const countBySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.sourceId, (m.get(e.sourceId) ?? 0) + 1);
    return m;
  }, [events]);

  const seriesAnswers = useMemo(() => {
    const titleByUid = new Map<string, CalendarEvent>();
    for (const e of events) if (e.recurring && !titleByUid.has(e.uid)) titleByUid.set(e.uid, e);
    return Object.entries(decisions)
      .filter(([k]) => k.startsWith("series:"))
      .map(([k, d]) => ({ key: k, decision: d, event: titleByUid.get(k.slice("series:".length)) }))
      .filter((x) => x.event);
  }, [decisions, events]);

  return (
    <div className={s.screen}>
      <header>
        <h1 className={s.pageTitle}>Calendar</h1>
        <p className={s.lead}>One calendar for every mode. Your tasks and the calendars you bring in, side by side.</p>
      </header>

      <Card
        title="Next 7 days"
        hint="Busy and not-sorted items are protected: the referee warns before anything is planned on top of them."
        action={
          pending.length > 0 && (
            <Button size="sm" variant="primary" onClick={() => setCheckIn(true)}>
              Sort today ({pending.length})
            </Button>
          )
        }
      >
        <div className={s.days}>
          {days.map(([key, items], i) => {
            const [y, m, d] = key.split("-").map(Number);
            const day = new Date(y, m - 1, d);
            return (
              <section key={key} aria-label={day.toDateString()}>
                <h3 className={s.dayName}>
                  {i === 0 ? "Today" : i === 1 ? "Tomorrow" : day.toLocaleDateString(undefined, { weekday: "long" })} ·{" "}
                  {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </h3>
                <DayList items={items} now={Date.parse(now)} isToday={i === 0} />
              </section>
            );
          })}
        </div>
      </Card>

      <GoogleCard />

      <Card
        title="Calendars"
        hint="Import .ics files from Google, Outlook or Apple. Importing the same file again updates it; nothing is ever added twice."
        action={
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Import .ics
          </Button>
        }
      >
        <input
          ref={fileRef}
          className={s.fileInput}
          type="file"
          accept=".ics,text/calendar"
          multiple
          onChange={onFiles}
          tabIndex={-1}
          aria-hidden
        />
        {sources.length ? (
          <ul className={s.sources}>
            {sources.map((c) => (
              <SourceRow key={c.id} source={c} count={countBySource.get(c.id) ?? 0} />
            ))}
          </ul>
        ) : (
          <Empty>No calendars yet. Export one from your calendar app as an .ics file, then import it here.</Empty>
        )}
      </Card>

      <Card title="Export" hint="One-way: a file you can open in Google, Outlook or Apple Calendar. Importing it again updates the same events.">
        <div className={s.actions}>
          <label className={s.inline}>
            <input type="checkbox" checked={withDeadlines} onChange={(e) => setWithDeadlines(e.target.checked)} />
            Include deadlines as &quot;Due&quot; events
          </label>
          <Button variant="primary" onClick={download} disabled={!exportable}>
            Download .ics ({exportable})
          </Button>
        </div>
        <p className={s.note}>Tasks with a planned start go out as blocks as long as your time guess. Finished tasks stay out.</p>
      </Card>

      {seriesAnswers.length > 0 && (
        <Card title="Repeating items" hint="Your answers for items that repeat. Ask again to change one.">
          <ul className={s.sources}>
            {seriesAnswers.map(({ key, decision, event }) => (
              <li key={key} className={s.source}>
                <span>
                  <strong>{event!.title}</strong>
                  <span className={s.sourceMeta}>
                    {" "}
                    · {decision.choice === "task" ? `added to ${getMode(decision.mode ?? "daily-life").label} each time` : "always busy time"}
                  </span>
                </span>
                <Button size="sm" variant="plain" onClick={() => forget(key)}>
                  Ask again
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CheckInDialog open={checkIn} onClose={() => setCheckIn(false)} />
    </div>
  );
}

/** One calendar in the list: its color (click to change), name, item count, and Remove for files. */
function SourceRow({ source: c, count }: { source: CalendarSource; count: number }) {
  const removeCalendar = useMios((st) => st.removeCalendar);
  const setCalendarColor = useMios((st) => st.setCalendarColor);
  const look = lookOf(c.id, useCalendarLooks());
  const [picking, setPicking] = useState(false);
  return (
    <li className={s.source} style={calStyle(look.color)}>
      <span className={s.sourceName}>
        {look.mios ? (
          <span className={s.swatch} title="Shown in MiOS's color" aria-hidden />
        ) : (
          <button
            type="button"
            className={s.swatch}
            aria-label={`Color for ${c.name}`}
            aria-expanded={picking}
            onClick={() => setPicking((p) => !p)}
          />
        )}
        <strong>{c.name}</strong>
        <span className={s.sourceMeta}>
          {count} items · {c.kind === "ics" ? "imported" : "synced"} {new Date(c.importedAt).toLocaleDateString()}
        </span>
      </span>
      {c.kind === "ics" ? (
        <Button
          size="sm"
          variant="plain"
          onClick={() => {
            if (confirm(`Remove ${c.name}? Its items leave MiOS. Tasks you already made from it stay.`)) removeCalendar(c.id);
          }}
        >
          Remove
        </Button>
      ) : (
        <span className={s.sourceMeta}>Synced</span>
      )}
      {picking && (
        <div className={s.palette} role="radiogroup" aria-label={`Color for ${c.name}`}>
          {CALENDAR_COLORS.map((col) => (
            <button
              key={col}
              type="button"
              role="radio"
              aria-checked={look.color === col}
              aria-label={col}
              className={s.swatch}
              style={calStyle(col)}
              onClick={() => {
                setCalendarColor(c.id, col);
                setPicking(false);
              }}
            />
          ))}
        </div>
      )}
    </li>
  );
}
