"use client";

import { useEffect } from "react";
import { create } from "zustand";

/** Lightweight notices, e.g. when the referee refuses an action. */
interface ToastState {
  message: string | null;
  tone: "info" | "warn";
  show(message: string, tone?: "info" | "warn"): void;
  clear(): void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: "info",
  show: (message, tone = "info") => set({ message, tone }),
  clear: () => set({ message: null }),
}));

export function Toaster() {
  const { message, tone, clear } = useToast();
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(clear, 4500);
    return () => clearTimeout(id);
  }, [message, clear]);

  if (!message) return null;
  return (
    <div
      role="status"
      onClick={clear}
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 50,
        maxWidth: "min(520px, calc(100vw - 32px))",
        padding: "12px 18px",
        borderRadius: 14,
        background: tone === "warn" ? "var(--red)" : "var(--text)",
        color: tone === "warn" ? "#fff" : "var(--bg)",
        boxShadow: "var(--shadow-pop)",
        fontSize: "var(--text-sm)",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {message}
    </div>
  );
}
