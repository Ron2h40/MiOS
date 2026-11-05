/** Display helpers. Formatting only; no domain rules. */

export const formatMinutes = (min: number): string => {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};

export const formatWhen = (iso: string, now = new Date()): string => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ` ${time}`;
};

export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Value for an <input type="datetime-local"> from an ISO string, in local time. */
export const toLocalInput = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** ISO string from an <input type="datetime-local"> value (local time). */
export const fromLocalInput = (value: string): string | undefined =>
  value ? new Date(value).toISOString() : undefined;

export const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);

export const PRIORITY_LABEL: Record<number, string> = { 1: "P1 · Urgent", 2: "P2 · High", 3: "P3 · Normal", 4: "P4 · Low" };
