"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ProcessState } from "@/core";
import s from "./ui.module.css";

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "plain" | "danger" | "success" | "icon";

export function Button({
  variant = "secondary",
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" }) {
  return (
    <button
      type="button"
      className={cx(s.button, s[variant], size === "sm" && s.sm, className)}
      {...props}
    />
  );
}

export function Card({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx(s.card, className)}>
      {(title || action) && (
        <header className={s.cardHeader}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {hint && <p className={s.cardHint}>{hint}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const STATE_LABEL: Record<ProcessState, string> = {
  ready: "Ready",
  running: "Running",
  blocked: "Blocked",
  done: "Done",
};

export function StatePill({ state }: { state: ProcessState }) {
  return <span className={cx(s.pill, s[state])}>{STATE_LABEL[state]}</span>;
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "tag" | "warn"; children: ReactNode }) {
  return <span className={cx(s.pill, s[tone])}>{children}</span>;
}

/** Native <dialog>, so focus trapping and Esc-to-close come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} onCancel={onClose}>
      {open && (
        <div className={s.dialogBody}>
          <h2 className={s.dialogTitle}>{title}</h2>
          {children}
          {actions && <div className={s.dialogActions}>{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}
