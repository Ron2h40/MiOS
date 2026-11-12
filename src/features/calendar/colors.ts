import type { CSSProperties } from "react";
import { MIOS_LOOK, type CalendarLook } from "@/state/hooks";

export { MIOS_LOOK };

/** The calendar an item belongs to. No source (or one that's gone) means MiOS. */
export const lookOf = (sourceId: string | undefined, looks: ReadonlyMap<string, CalendarLook>): CalendarLook =>
  (sourceId && looks.get(sourceId)) || MIOS_LOOK;

/** Hands the colour to CSS as `--cal`. */
export const calStyle = (color: string): CSSProperties => ({ "--cal": color }) as CSSProperties;
