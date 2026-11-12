"use client";

import { useState, type ReactNode } from "react";
import type { AiFeature, AiErrorCode } from "@/ai/types";
import { AI_FEATURES } from "@/ai/types";
import { useStage } from "@/state/hooks";
import { useAi } from "@/state/ai";
import { useMios } from "@/state/store";
import { Button } from "@/ui/primitives";
import { PopupDialog } from "./PopupDialog";
import s from "./ai.module.css";

/**
 * The one entry point to AI help, so every feature follows the same stage
 * rules:
 * - child: the button runs AI right away
 * - teen: a think-first pop-up question comes first (friction, not a test)
 * - adult: no button at all
 */
export function AiHelpButton({
  feature,
  label,
  onHelp,
  disabled,
}: {
  feature: AiFeature;
  label: string;
  onHelp: () => void;
  disabled?: boolean;
}) {
  const { stage, policy } = useStage();
  const logAiUse = useMios((st) => st.logAiUse);
  const [asking, setAsking] = useState(false);

  if (!policy.aiButton) return null;

  const help = () => {
    logAiUse(AI_FEATURES[feature].code);
    onHelp();
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => (stage === "teen" ? setAsking(true) : help())}
      >
        <span className={s.spark} aria-hidden>
          ✦
        </span>
        {label}
        {stage === "teen" && <span className="visually-hidden"> (asks you a quick question first)</span>}
      </Button>
      {asking && (
        <PopupDialog
          feature={feature}
          onDone={() => {
            setAsking(false);
            help();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}

const ERROR_TEXT: Record<AiErrorCode, string> = {
  rate_limited: "The free AI limit is used up for now. Try again in a minute, or carry on without it.",
  unavailable: "AI isn't reachable right now. Everything else still works.",
  bad_response: "The AI answer didn't make sense. Try again.",
  bad_request: "That request couldn't be sent.",
  no_sources: "Google Search found no sources for that. Try asking more specifically.",
  daily_limit: "That's today's AI requests used up. AI is back tomorrow; everything else works.",
  signed_out: "Your sign-in has expired. Sign in again to use AI.",
};

export type AiStatus<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; error: AiErrorCode }
  | { state: "done"; result: T };

/** Shared frame for an AI answer: title, demo badge, body, "Why?" and actions. */
export function AiCard<T>({
  title,
  status,
  why,
  children,
  actions,
  onClose,
}: {
  title: string;
  status: AiStatus<T>;
  why?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  const demo = useAi((st) => st.demo);
  const demoReason = useAi((st) => st.demoReason);
  if (status.state === "idle") return null;
  return (
    <section className={s.card} aria-live="polite">
      <header className={s.cardHead}>
        <span className={s.cardTitle}>
          <span className={s.spark} aria-hidden>
            ✦
          </span>
          {title}
          {status.state === "done" && demo && <span className={s.demo}>{demoReason === "guest" ? "Demo AI · sign in for real AI" : "Demo AI · no API key"}</span>}
        </span>
        {onClose && (
          <Button size="sm" variant="plain" onClick={onClose}>
            Close
          </Button>
        )}
      </header>
      {status.state === "loading" && <p className={s.loading}>Thinking…</p>}
      {status.state === "error" && <p className={s.error}>{ERROR_TEXT[status.error]}</p>}
      {status.state === "done" && (
        <>
          {children}
          <div className={s.actions}>
            {actions}
            {why !== undefined && <WhyButton why={why} />}
          </div>
        </>
      )}
    </section>
  );
}

const NO_NOTES: string[] = [];

/** Every AI suggestion explains itself, using its own reason plus the background log. */
export function WhyButton({ why }: { why: string }) {
  const [open, setOpen] = useState(false);
  // A stable fallback: a fresh [] here would re-render forever.
  const notes = useAi((st) => st.log[0]?.notes ?? NO_NOTES);
  return (
    <>
      <Button size="sm" variant="plain" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Why?
      </Button>
      {open && (
        <div className={s.why} style={{ flexBasis: "100%" }}>
          <span className={s.whyLabel}>Reasoning</span>
          <span>{why || "No reasoning was given."}</span>
          {notes.length > 0 && (
            <>
              <span className={s.whyLabel}>What MiOS has noticed about you</span>
              <ul className={s.notes}>
                {notes.slice(0, 3).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
