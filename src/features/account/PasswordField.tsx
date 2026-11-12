"use client";

import { useState, type InputHTMLAttributes } from "react";
import s from "./account.module.css";

/** A password box with an eye button to show or hide what's typed. */
export function PasswordField({
  label,
  invalid,
  ...input
}: { label: string; invalid?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <label>
      {label}
      <span className={s.password}>
        <input {...input} type={shown ? "text" : "password"} aria-invalid={invalid || undefined} />
        <button
          type="button"
          className={s.eye}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {shown && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </span>
    </label>
  );
}
