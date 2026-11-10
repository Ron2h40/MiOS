import type { Metadata } from "next";
import { CalendarScreen } from "@/features/calendar/CalendarScreen";
import { HydrationGate } from "@/ui/HydrationGate";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <HydrationGate>
      <CalendarScreen />
    </HydrationGate>
  );
}
