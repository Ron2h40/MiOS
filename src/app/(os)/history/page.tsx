import type { Metadata } from "next";
import { HistoryScreen } from "@/features/history/HistoryScreen";
import { HydrationGate } from "@/ui/HydrationGate";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <HydrationGate>
      <HistoryScreen />
    </HydrationGate>
  );
}
