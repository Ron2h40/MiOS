import type { Metadata } from "next";
import { Suspense } from "react";
import { FocusView } from "@/features/focus/FocusView";

export const metadata: Metadata = { title: "Focus" };

export default function FocusPage() {
  return (
    <Suspense>
      <FocusView />
    </Suspense>
  );
}
