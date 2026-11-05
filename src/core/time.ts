import type { ISODateTime } from "./types";

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export const toMs = (iso: ISODateTime): number => new Date(iso).getTime();
export const toIso = (ms: number): ISODateTime => new Date(ms).toISOString();

export const minutesBetween = (fromIso: ISODateTime, toIsoValue: ISODateTime): number =>
  Math.max(0, (toMs(toIsoValue) - toMs(fromIso)) / MINUTE_MS);

export const daysBetween = (fromIso: ISODateTime, toIsoValue: ISODateTime): number =>
  (toMs(toIsoValue) - toMs(fromIso)) / DAY_MS;

/** "HH:MM" → minutes since midnight. */
export const parseClock = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
