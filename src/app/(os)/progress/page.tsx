import type { Metadata } from "next";
import { HydrationGate } from "@/ui/HydrationGate";
import { ProgressScreen } from "@/features/progress/ProgressScreen";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <HydrationGate>
      <ProgressScreen />
    </HydrationGate>
  );
}
