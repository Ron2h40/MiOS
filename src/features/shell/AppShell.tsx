"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ALL_MODES } from "@/core";
import { AiRuntime } from "@/features/ai/AiRuntime";
import { Onboarding } from "@/features/ai/AiDisclosure";
import { AccountButton, AccountRuntime } from "@/features/account/Account";
import { FeedbackLink } from "@/features/account/FeedbackLink";
import { ReviewRuntime } from "@/features/assist/ReviewRuntime";
import { CalendarRuntime, CheckInBanner } from "@/features/calendar/CheckIn";
import { GoogleRuntime } from "@/features/calendar/GoogleSync";
import { RewardBanner, StreakBadge } from "@/features/rewards/Rewards";
import { useAccount } from "@/state/account";
import { useHydrated, useStage } from "@/state/hooks";
import { Toaster } from "@/ui/toast";
import s from "./shell.module.css";

const NAV = [
  { href: "/focus", label: "Focus" },
  { href: "/calendar", label: "Calendar" },
  { href: "/resources", label: "Resources" },
  { href: "/progress", label: "Progress" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hydrated = useHydrated();

  return (
    <div className={s.frame}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/m/general" className={s.brand} aria-label="MiOS home">
            <span className={s.logo}>Mi</span>
            MiOS
          </Link>

          <nav className={s.segmented} aria-label="Modes">
            {ALL_MODES.map((m) => {
              const href = `/m/${m.id}`;
              const active = pathname === href;
              return (
                <Link
                  key={m.id}
                  href={href}
                  className={`${s.segment} ${active ? s.segmentActive : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {m.label}
                </Link>
              );
            })}
          </nav>

          <nav className={s.nav} aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`${s.navLink} ${pathname === n.href ? s.navActive : ""}`}
                aria-current={pathname === n.href ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
            {hydrated && <StreakBadge />}
            {hydrated && <StageBadge />}
            {hydrated && <AccountButton />}
          </nav>
        </div>
      </header>

      <main className={s.main}>
        {hydrated && <CheckInBanner />}
        {hydrated && <RewardBanner />}
        {children}
      </main>

      <Toaster />
      {hydrated && (
        <>
          <AiRuntime />
          <CalendarRuntime />
          <GoogleRuntime />
          <ReviewRuntime />
          <AccountRuntime />
          <Onboarding />
        </>
      )}

      <footer className={s.footer}>
        MiOS v1 · {hydrated ? <WhereDataLives /> : "Your data stays in this browser"}
        <Link href="/privacy">Privacy</Link>
        <FeedbackLink label="Feedback" />
      </footer>
    </div>
  );
}

/** Guests keep data in the browser; signed-in people also have it in their account. */
function WhereDataLives() {
  const signedIn = useAccount((st) => st.account?.verified);
  return <>{signedIn ? "Saved in this browser and your account" : "Your data stays in this browser"}</>;
}

function StageBadge() {
  const { policy } = useStage();
  return (
    <Link href="/progress" className={s.stage} title={policy.description}>
      {policy.label} stage
    </Link>
  );
}
