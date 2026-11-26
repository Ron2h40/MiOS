"use client";

import { useEffect } from "react";
import { create } from "zustand";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Lightweight notices, e.g. when the referee refuses an action. An optional action (like Undo) sits beside the text. */
interface ToastState {
  message: string | null;
  tone: "info" | "warn";
  action?: ToastAction;
  show(message: string, tone?: "info" | "warn", action?: ToastAction): void;
  clear(): void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: "info",
  show: (message, tone = "info", action) => set({ message, tone, action }),
  clear: () => set({ message: null, action: undefined }),
}));

/** `bottom` lifts it clear of anything fixed at the bottom, like the phone's tab bar. */
export function Toaster({ bottom = "24px" }: { bottom?: string }) {
  const { message, tone, action, clear } = useToast();
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(clear, action ? 7000 : 4500);
    return () => clearTimeout(id);
  }, [message, action, clear]);

  if (!message) return null;
  return (
    <div
      role="status"
      onClick={clear}
      style={{
        position: "fixed",
        left: "50%",
        bottom,
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(520px, calc(100vw - 32px))",
        padding: "12px 18px",
        borderRadius: 14,
        background: tone === "warn" ? "var(--red)" : "var(--text)",
        color: tone === "warn" ? "#fff" : "var(--bg)",
        boxShadow: "var(--shadow-pop)",
        fontSize: "var(--text-sm)",
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>{message}</span>
      {action && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
            clear();
          }}
          style={{
            border: "1px solid currentColor",
            background: "transparent",
            color: "inherit",
            borderRadius: 8,
            padding: "2px 10px",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
