"use client";

import { useRef } from "react";
import type { ProtectedBlock } from "@/core";
import { aiAccessNotice } from "@/ai/access";
import { AccountCard } from "@/features/account/DeleteAccount";
import { AiDisclosureText } from "@/features/ai/AiDisclosure";
import { useAccount } from "@/state/account";
import { useAi } from "@/state/ai";
import { exportSnapshot, useMios } from "@/state/store";
import { Button, Card, Empty } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import s from "../progress/progress.module.css";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SettingsScreen() {
  const settings = useMios((st) => st.settings);
  const updateSettings = useMios((st) => st.updateSettings);
  const importData = useMios((st) => st.importData);
  const reset = useMios((st) => st.reset);
  const synced = useAccount((st) => !!st.account?.verified);
  const toast = useToast((st) => st.show);
  const fileRef = useRef<HTMLInputElement>(null);

  const setBlocks = (protectedBlocks: ProtectedBlock[]) => updateSettings({ protectedBlocks });
  const patchBlock = (id: string, patch: Partial<ProtectedBlock>) =>
    setBlocks(settings.protectedBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const download = () => {
    const blob = new Blob([exportSnapshot()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mios-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (file: File) => {
    const r = importData(await file.text());
    toast(r.ok ? "Data imported." : r.error, r.ok ? "info" : "warn");
  };

  return (
    <div className={s.screen}>
      <header>
        <h1 className={s.pageTitle}>Settings</h1>
        <p className={s.lead}>The referee&apos;s rules and your data.</p>
      </header>

      <Card title="Referee" hint="Limits that keep your day sane.">
        <div className={s.row}>
          <label>
            Tasks running at once
            <select
              value={settings.runningCap}
              onChange={(e) => updateSettings({ runningCap: Number(e.target.value) as 1 | 2 | 3 })}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Flag waiting tasks after (days)
            <input
              type="number"
              min={1}
              max={90}
              value={settings.starvationDays}
              onChange={(e) => updateSettings({ starvationDays: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label>
            Default time for unguessed tasks (min)
            <input
              type="number"
              min={5}
              max={480}
              value={settings.defaultEstimateMinutes}
              onChange={(e) => updateSettings({ defaultEstimateMinutes: Math.max(5, Number(e.target.value) || 30) })}
            />
          </label>
          <label>
            Medicine day starts at
            <select
              value={settings.medDayStartHour ?? 0}
              onChange={(e) => updateSettings({ medDayStartHour: Number(e.target.value) })}
            >
              {Array.from({ length: 13 }, (_, h) => (
                <option key={h} value={h}>
                  {h === 0 ? "Midnight" : `${String(h).padStart(2, "0")}:00`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card
        title="Protected time"
        hint="Nothing gets scheduled here without your approval."
        action={
          <Button
            size="sm"
            onClick={() =>
              setBlocks([
                ...settings.protectedBlocks,
                { id: crypto.randomUUID(), label: "New block", days: [], start: "18:00", end: "19:00" },
              ])
            }
          >
            Add block
          </Button>
        }
      >
        {settings.protectedBlocks.length ? (
          <ul className={s.blocks}>
            {settings.protectedBlocks.map((b) => (
              <li key={b.id} className={s.block}>
                <input aria-label="Name" value={b.label} onChange={(e) => patchBlock(b.id, { label: e.target.value })} />
                <input aria-label="Start" type="time" value={b.start} onChange={(e) => patchBlock(b.id, { start: e.target.value })} />
                <input aria-label="End" type="time" value={b.end} onChange={(e) => patchBlock(b.id, { end: e.target.value })} />
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setBlocks(settings.protectedBlocks.filter((x) => x.id !== b.id))}
                >
                  Remove
                </Button>
                <div className={s.days} role="group" aria-label={`${b.label} days`}>
                  {DAY_NAMES.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      className={s.day}
                      aria-pressed={b.days.length === 0 || b.days.includes(i)}
                      onClick={() => {
                        const current = b.days.length ? b.days : [0, 1, 2, 3, 4, 5, 6];
                        const next = current.includes(i) ? current.filter((x) => x !== i) : [...current, i].sort();
                        patchBlock(b.id, { days: next.length === 7 ? [] : next });
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No protected time yet.</Empty>
        )}
      </Card>

      <Card title="AI and privacy" hint="What the assistant sees and where it goes.">
        <div className={s.prose}>
          <AiDisclosureText />
          <p>{aiAccessNotice(synced)}</p>
        </div>
      </Card>

      <AccountCard />

      <Card
        title="Your data"
        hint={
          synced
            ? "Stored in this browser and synced to your account. Changes here change your account too."
            : "Stored in this browser. AI requests are the only thing sent out."
        }
      >
        <div className={s.row}>
          <Button onClick={download}>Export JSON</Button>
          <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
          <Button
            variant="danger"
            onClick={() => {
              const where = synced ? "in your account and on every device" : "in this browser";
              if (!confirm(`Erase all tasks, stats, AI notes and settings ${where}? This can't be undone.`)) return;
              reset();
              useAi.getState().reset();
            }}
          >
            Erase everything
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </Card>
    </div>
  );
}
