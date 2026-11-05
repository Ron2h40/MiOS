"use client";

import type { ReactNode } from "react";
import { useHydrated } from "@/state/hooks";

/**
 * Data lives in localStorage, so screens render a placeholder on the server
 * and swap in real content once the store has loaded in the browser.
 */
export function HydrationGate({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <p style={{ display: "grid", placeItems: "center", minHeight: "40vh", color: "var(--text-tertiary)" }}>
        Loading your OS…
      </p>
    );
  }
  return <>{children}</>;
}
