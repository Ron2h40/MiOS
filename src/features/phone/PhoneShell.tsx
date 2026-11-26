"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { getMode, isModeId, type ModeId } from "@/core";
import { AccountButton, AccountRuntime } from "@/features/account/Account";
import { Onboarding } from "@/features/ai/AiDisclosure";
import { AiRuntime } from "@/features/ai/AiRuntime";
import { ReviewRuntime } from "@/features/assist/ReviewRuntime";
import { TimeCheckRuntime } from "@/features/assist/TimeTaken";
import { CalendarRuntime } from "@/features/calendar/CheckIn";
import { GoogleRuntime } from "@/features/calendar/GoogleSync";
import { useHydrated } from "@/state/hooks";
import { Toaster } from "@/ui/toast";
import { PhoneHome } from "./PhoneHome";
import { PhoneWindows } from "./PhoneWindows";
import { usePhoneUi, type PhoneTab } from "./phoneUi";
import s from "./phone.module.css";

const TABS: { id: PhoneTab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "schedule", label: "Schedule", icon: "▤" },
  { id: "me", label: "Me", icon: "◉" },
];

/** Where each section of the desktop lives on the phone's Me page. */
const SUB_PAGES: Record<string, string> = {
  "/history": "History",
  "/progress": "Progress and stats",
  "/resources": "Resources",
  "/settings": "Settings",
  "/calendar": "Calendar",
  "/privacy": "Privacy",
};

/**
 * The phone layout: three pages (Home, Schedule, Me) with tabs at the bottom.
 * Each page's main action sits top left; the account is top right. Sections
 * like History open as their own page with a back button.
 */
export function PhoneShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const popped = usePhoneUi((st) => st.popped);

  // The back gesture closes the open window instead of leaving the page.
  useEffect(() => {
    const onPop = () => popped();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [popped]);

  const modeMatch = pathname.match(/^\/m\/([\w-]+)/);
  const mode: ModeId | null = modeMatch && isModeId(modeMatch[1]) ? modeMatch[1] : null;
  const subTitle = SUB_PAGES[pathname];

  return (
    <div className={s.screen}>
      {mode ? (
        <Tabs mode={mode}>{children}</Tabs>
      ) : (
        <SubPage title={subTitle ?? "MiOS"}>{children}</SubPage>
      )}

      <Toaster bottom="calc(env(safe-area-inset-bottom) + 76px)" />
      {hydrated && (
        <>
          <PhoneWindows mode={mode ?? "general"} />
          <AiRuntime />
          <CalendarRuntime />
          <GoogleRuntime />
          <TimeCheckRuntime />
          <ReviewRuntime />
          <AccountRuntime />
          <Onboarding />
        </>
      )}
    </div>
  );
}

function Tabs({ mode, children }: { mode: ModeId; children: ReactNode }) {
  const hydrated = useHydrated();
  const tab = usePhoneUi((st) => st.tab);
  const setTab = usePhoneUi((st) => st.setTab);

  return (
    <>
      <header className={s.top}>
        <TopLeft mode={mode} />
        <Logo />
        <div className={s.topRight}>{hydrated && <AccountButton />}</div>
      </header>

      <div className={s.body}>
        {!hydrated ? null : tab === "home" ? (
          <PhoneHome mode={mode} />
        ) : tab === "schedule" ? (
          // Until the phone Schedule page is built, the full task screen stands in.
          <div className={s.page}>{children}</div>
        ) : (
          <MeLinks />
        )}
      </div>

      <nav className={s.tabs} aria-label="Pages">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={s.tab} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <span className={s.tabIcon} aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

/** Each page's own main action. */
function TopLeft({ mode }: { mode: ModeId }) {
  const tab = usePhoneUi((st) => st.tab);
  const open = usePhoneUi((st) => st.open);
  if (tab === "home") {
    const m = getMode(mode);
    return (
      <button type="button" className={s.cornerButton} aria-label={`Mode: ${m.label}. Change mode`} onClick={() => open({ kind: "mode" })}>
        <span aria-hidden>{m.icon}</span>
      </button>
    );
  }
  if (tab === "me") {
    return (
      <button type="button" className={s.cornerButton} aria-label="Log medicines, drinks and food" onClick={() => open({ kind: "log" })}>
        <span aria-hidden>💊</span>
      </button>
    );
  }
  return <span />;
}

function Logo() {
  return (
    <Link href="/m/general" className={s.logo} aria-label="MiOS home">
      <span className={s.logoMark}>Mi</span>MiOS
    </Link>
  );
}

/** A section opened from the Me page, full screen with a way back. */
function SubPage({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <>
      <header className={s.subTop}>
        <button
          type="button"
          className={s.close}
          aria-label="Back"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/m/general"))}
        >
          ‹
        </button>
        <h1>{title}</h1>
        <span />
      </header>
      <div className={s.body}>
        <div className={s.page}>{children}</div>
      </div>
    </>
  );
}

/** Until the phone Me page is built: its sections, one tap away. */
function MeLinks() {
  const rows = [
    { href: "/resources", icon: "📊", label: "Resources", hint: "Charts and everything logged" },
    { href: "/history", icon: "🕘", label: "History", hint: "Finished tasks · fix times" },
    { href: "/progress", icon: "📈", label: "Progress and stats", hint: "Stage, guesses, stats cards" },
    { href: "/settings", icon: "⚙️", label: "Settings", hint: "Medicines, running cap, protected time" },
  ];
  return (
    <div className={s.page}>
      <ul className={`${s.card} ${s.menu}`}>
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className={s.menuRow}>
              <span className={s.menuIcon} aria-hidden>
                {r.icon}
              </span>
              <span className={s.taskText}>
                <strong>{r.label}</strong>
                <span>{r.hint}</span>
              </span>
              <span className={s.chevron} aria-hidden>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
