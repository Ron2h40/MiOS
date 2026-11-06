import type { Metadata } from "next";
import { ResourcesScreen } from "@/features/resources/ResourcesScreen";
import { HydrationGate } from "@/ui/HydrationGate";

export const metadata: Metadata = { title: "Resources" };

export default function ResourcesPage() {
  return (
    <HydrationGate>
      <ResourcesScreen />
    </HydrationGate>
  );
}
