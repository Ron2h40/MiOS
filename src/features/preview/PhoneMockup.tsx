"use client";

import { MainPage } from "./MainPage";
import { MePage } from "./MePage";
import { SchedulePage } from "./SchedulePage";
import { Sheets } from "./Sheets";
import { modeOf } from "./mockData";
import { MockupProvider, useMockup, type Tab } from "./store";
import s from "./mockup.module.css";

/**
 * A clickable mockup of the phone layout: three pages (main, schedule, you)
 * switched with tabs at the bottom. Made-up data; nothing is saved.
 */
export function PhoneMockup() {
  return (
    <MockupProvider>
      <div className={s.stage}>
        <div className={s.phone}>
          <Screen />
        </div>
        <p className={s.caption}>Mockup · made-up data · nothing is saved</p>
      </div>
    </MockupProvider>
  );
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "schedule", label: "Schedule", icon: "▤" },
  { id: "me", label: "Me", icon: "◉" },
];

function Screen() {
  const m = useMockup();

  return (
    <div className={s.screen}>
      <header className={s.top}>
        <TopLeft />
        <span className={s.logo}>
          <span className={s.logoMark}>Mi</span>MiOS
        </span>
        <button type="button" className={s.avatar} aria-label="Account" onClick={() => m.openSheet({ kind: "account" })}>
          A<span className={s.syncDot} aria-hidden />
        </button>
      </header>

      <div className={s.body}>
        {m.tab === "home" && <MainPage />}
        {m.tab === "schedule" && <SchedulePage />}
        {m.tab === "me" && <MePage />}
      </div>

      <nav className={s.tabs} aria-label="Pages">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={s.tab}
            aria-current={m.tab === t.id ? "page" : undefined}
            onClick={() => {
              if (t.id === "schedule" && m.tab !== "schedule") m.setFilter("all");
              m.setTab(t.id);
            }}
          >
            <span className={s.tabIcon} aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {m.toast && (
        <div key={m.toast.id} className={s.toast} role="status">
          <span>{m.toast.text}</span>
          {m.toast.undo && (
            <button type="button" onClick={m.undo}>
              Undo
            </button>
          )}
        </div>
      )}

      <Sheets />
    </div>
  );
}

/** Each page's own main action sits top left. */
function TopLeft() {
  const m = useMockup();
  if (m.tab === "home") {
    const mode = modeOf(m.mode);
    return (
      <button type="button" className={s.cornerButton} aria-label={`Mode: ${mode.label}. Change mode`} onClick={() => m.openSheet({ kind: "mode" })}>
        <span aria-hidden>{mode.icon}</span>
      </button>
    );
  }
  if (m.tab === "schedule") {
    return (
      <button type="button" className={`${s.cornerButton} ${s.cornerAccent}`} aria-label="Add a task" onClick={() => m.openSheet({ kind: "add" })}>
        +
      </button>
    );
  }
  const due = m.data.meds.some((x) => x.due);
  return (
    <button type="button" className={s.cornerButton} aria-label="Log medicines, drinks and food" onClick={() => m.openSheet({ kind: "log" })}>
      <span aria-hidden>💊</span>
      {due && <span className={s.cornerDot} aria-hidden />}
    </button>
  );
}
