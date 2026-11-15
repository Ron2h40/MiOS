"use client";

import { useState } from "react";
import {
  isHm,
  medDayOf,
  RESOURCE_PRESETS,
  SCHEDULE_PRESETS,
  type DailyMed,
  type DoseTrigger,
  type MedDays,
  type MedDose,
} from "@/core";
import { useMios } from "@/state/store";
import { Button, Dialog } from "@/ui/primitives";
import s from "./meds.module.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MEDICINE_PRESETS = RESOURCE_PRESETS.filter((p) => p.kind === "medicine");
const newId = () => crypto.randomUUID();

type DaysKind = MedDays["kind"];

/**
 * Set up a daily medicine as prescribed: pick a schedule preset to start
 * from, then change anything. Mount only while open (keyed by medicine).
 */
export function MedDialog({ med, onClose }: { med?: DailyMed; onClose: () => void }) {
  const addMed = useMios((st) => st.addMed);
  const updateMed = useMios((st) => st.updateMed);
  const startHour = useMios((st) => st.settings.medDayStartHour ?? 0);
  const [name, setName] = useState(med?.name ?? "");
  const [preset, setPreset] = useState<string>(med ? "custom" : "");
  const [doses, setDoses] = useState<MedDose[]>(med?.doses ?? []);
  const [daysKind, setDaysKind] = useState<DaysKind>(med?.days.kind ?? "daily");
  const [weekdays, setWeekdays] = useState<number[]>(med?.days.kind === "weekdays" ? med.days.days : [1, 2, 3, 4, 5]);
  const [remind, setRemind] = useState(med?.remind ?? true);

  const presetMatch = MEDICINE_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = SCHEDULE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setDoses(p.triggers.map((trigger) => ({ id: newId(), trigger })));
    setRemind(p.remind);
    setDaysKind(p.days ?? "daily");
    if (p.days === "weekdays") setWeekdays([1, 2, 3, 4, 5]);
  };

  const setTrigger = (id: string, trigger: DoseTrigger) => {
    setPreset("custom");
    setDoses((ds) => ds.map((d) => (d.id === id ? { ...d, trigger } : d)));
  };

  const valid =
    name.trim().length > 0 &&
    (!remind || doses.length > 0) &&
    (daysKind !== "weekdays" || weekdays.length > 0) &&
    doses.every((d) =>
      d.trigger.kind === "time"
        ? isHm(d.trigger.at)
        : d.trigger.kind === "meal"
          ? isHm(d.trigger.after) && (!d.trigger.remindBy || isHm(d.trigger.remindBy))
          : true,
    );

  const save = () => {
    const days: MedDays =
      daysKind === "weekdays"
        ? { kind: "weekdays", days: [...weekdays].sort() }
        : daysKind === "everyOther"
          ? { kind: "everyOther", from: med?.days.kind === "everyOther" ? med.days.from : medDayOf(Date.now(), startHour) }
          : { kind: "daily" };
    const input = {
      name,
      doses: remind ? doses : [],
      days,
      remind,
      ...(presetMatch ? { presetId: presetMatch.id } : {}),
    };
    if (med) updateMed(med.id, { ...input, presetId: presetMatch?.id });
    else addMed(input);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={med ? `Edit ${med.name}` : "Add a daily medicine"}
      actions={
        <>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <label>
          Medicine
          <input
            value={name}
            maxLength={80}
            list="mios-medicine-presets"
            placeholder="e.g. Vitamin D"
            onChange={(e) => setName(e.target.value)}
          />
          <datalist id="mios-medicine-presets">
            {MEDICINE_PRESETS.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          <span className={s.help}>
            {presetMatch
              ? "A MiOS preset: logging it also moves your Focus chart, from its label data."
              : "Tracking only: it reminds and logs, and doesn't change your charts."}
          </span>
        </label>

        <fieldset className={s.fieldset}>
          <legend>Schedule, as prescribed</legend>
          <div className={s.presets} role="radiogroup" aria-label="Start from a common schedule">
            {SCHEDULE_PRESETS.map((p) => (
              <label key={p.id} className={s.presetOption}>
                <input type="radio" name="med-preset" checked={preset === p.id} onChange={() => applyPreset(p.id)} />
                {p.label}
              </label>
            ))}
            <label className={s.presetOption}>
              <input type="radio" name="med-preset" checked={preset === "custom"} onChange={() => setPreset("custom")} />
              Custom: set it up yourself
            </label>
          </div>
          <span className={s.help}>Pick the closest one, then change anything below.</span>
        </fieldset>

        <label className={s.inline}>
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
          Remind me with a red note (off = as needed, log only)
        </label>

        {remind && (
          <>
            <fieldset className={s.fieldset}>
              <legend>Doses each day</legend>
              <ol className={s.doses}>
                {doses.map((d, i) => (
                  <DoseRow
                    key={d.id}
                    index={i + 1}
                    trigger={d.trigger}
                    onChange={(t) => setTrigger(d.id, t)}
                    onRemove={() => {
                      setPreset("custom");
                      setDoses((ds) => ds.filter((x) => x.id !== d.id));
                    }}
                  />
                ))}
              </ol>
              <Button
                size="sm"
                disabled={doses.length >= 8}
                onClick={() => {
                  setPreset("custom");
                  setDoses((ds) => [...ds, { id: newId(), trigger: { kind: "time", at: "08:00" } }]);
                }}
              >
                Add a dose
              </Button>
              <span className={s.help}>
                &ldquo;Before a meal&rdquo; can&apos;t be detected, so set those doses as a time.
              </span>
            </fieldset>

            <fieldset className={s.fieldset}>
              <legend>Which days</legend>
              <div className={s.row}>
                {(
                  [
                    ["daily", "Every day"],
                    ["weekdays", "Chosen days"],
                    ["everyOther", "Every other day"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className={s.inline}>
                    <input
                      type="radio"
                      name="med-days"
                      checked={daysKind === k}
                      onChange={() => {
                        setPreset("custom");
                        setDaysKind(k);
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {daysKind === "weekdays" && (
                <div className={s.row} role="group" aria-label="Days of the week">
                  {WEEKDAYS.map((w, i) => (
                    <button
                      key={w}
                      type="button"
                      className={s.dayChip}
                      aria-pressed={weekdays.includes(i)}
                      onClick={() => setWeekdays((ws) => (ws.includes(i) ? ws.filter((x) => x !== i) : [...ws, i]))}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          </>
        )}
      </div>
    </Dialog>
  );
}

function DoseRow({
  index,
  trigger,
  onChange,
  onRemove,
}: {
  index: number;
  trigger: DoseTrigger;
  onChange: (t: DoseTrigger) => void;
  onRemove: () => void;
}) {
  return (
    <li className={s.dose}>
      <span className={s.doseHead}>
        Dose {index}
        <select
          aria-label={`When is dose ${index}`}
          value={trigger.kind}
          onChange={(e) => {
            const k = e.target.value as DoseTrigger["kind"];
            onChange(k === "anytime" ? { kind: "anytime" } : k === "time" ? { kind: "time", at: "08:00" } : { kind: "meal", after: "00:00", waitMinutes: 0 });
          }}
        >
          <option value="anytime">Any time that day</option>
          <option value="time">At a time</option>
          <option value="meal">After a meal</option>
        </select>
        <Button size="sm" variant="plain" onClick={onRemove} aria-label={`Remove dose ${index}`}>
          ✕
        </Button>
      </span>
      {trigger.kind === "time" && (
        <label className={s.inline}>
          Time
          <input type="time" value={trigger.at} onChange={(e) => onChange({ ...trigger, at: e.target.value })} />
        </label>
      )}
      {trigger.kind === "meal" && (
        <div className={s.mealGrid}>
          <label>
            After the first meal logged from
            <input type="time" value={trigger.after} onChange={(e) => onChange({ ...trigger, after: e.target.value })} />
          </label>
          <label>
            Wait (minutes)
            <input
              type="number"
              min={0}
              max={240}
              value={trigger.waitMinutes}
              onChange={(e) => onChange({ ...trigger, waitMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
            />
          </label>
          <label>
            Remind me anyway by (optional)
            <input
              type="time"
              value={trigger.remindBy ?? ""}
              onChange={(e) => {
                const next = { ...trigger };
                if (e.target.value) next.remindBy = e.target.value;
                else delete next.remindBy;
                onChange(next);
              }}
            />
          </label>
        </div>
      )}
    </li>
  );
}
