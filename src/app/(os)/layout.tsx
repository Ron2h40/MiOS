import type { ReactNode } from "react";
import { AppShell } from "@/features/shell/AppShell";

/** Everything except Focus view lives inside the app shell. */
export default function OsLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
