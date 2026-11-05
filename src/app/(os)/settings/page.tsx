import type { Metadata } from "next";
import { HydrationGate } from "@/ui/HydrationGate";
import { SettingsScreen } from "@/features/settings/SettingsScreen";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <HydrationGate>
      <SettingsScreen />
    </HydrationGate>
  );
}
