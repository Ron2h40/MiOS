import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ALL_MODES, isModeId } from "@/core";
import { ModeScreen } from "@/features/tasks/ModeScreen";
import { HydrationGate } from "@/ui/HydrationGate";

export function generateStaticParams() {
  return ALL_MODES.map((m) => ({ mode: m.id }));
}

// Static on purpose: reading params in generateMetadata blocks prefetching.
export const metadata: Metadata = { title: "Tasks" };

export default function ModePage({ params }: PageProps<"/m/[mode]">) {
  // Reading params inside Suspense keeps navigation between modes instant.
  return (
    <Suspense>
      <Mode params={params} />
    </Suspense>
  );
}

async function Mode({ params }: Pick<PageProps<"/m/[mode]">, "params">) {
  const { mode } = await params;
  if (!isModeId(mode)) notFound();
  return (
    <HydrationGate>
      <ModeScreen modeId={mode} />
    </HydrationGate>
  );
}
