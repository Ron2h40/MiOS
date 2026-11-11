"use client";

import { useEffect } from "react";
import { googleClientId, hasValidToken, preloadGoogle } from "@/integrations/google/client";
import { connectGoogle, disconnectGoogle, syncGoogle, useGoogleRuntime } from "@/state/google";
import { useNow } from "@/state/hooks";
import { useMios } from "@/state/store";
import { Button, Card } from "@/ui/primitives";
import s from "./calendar.module.css";

const AUTO_SYNC_MS = 5 * 60_000;
const AFTER_CHANGE_MS = 15_000;

const ago = (iso: string, now: string) => {
  const min = Math.round((Date.parse(now) - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** E2: connect, sync, disconnect. */
export function GoogleCard() {
  const now = useNow(30_000);
  const google = useMios((st) => st.google);
  const { phase, message, lastResult } = useGoogleRuntime();
  const clientId = googleClientId();

  useEffect(() => {
    if (clientId) preloadGoogle();
  }, [clientId]);

  if (!clientId) {
    return (
      <Card title="Google Calendar" hint="Two-way sync with your Google Calendar.">
        <p className={s.note}>
          Sync is off: add <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> to <code>.env.local</code> (see the README).
        </p>
      </Card>
    );
  }

  const busy = phase === "connecting" || phase === "syncing";
  const signedIn = hasValidToken();

  return (
    <Card
      title="Google Calendar"
      hint="Reads your main calendar. Writes only to a separate “MiOS” calendar it creates, never to your own events."
      action={
        google.enabled ? (
          <div className={s.actions}>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => (signedIn ? syncGoogle() : connectGoogle())}>
              {phase === "syncing" ? "Syncing…" : phase === "connecting" ? "Signing in…" : "Sync now"}
            </Button>
            <Button
              size="sm"
              variant="plain"
              disabled={busy}
              onClick={() => {
                if (confirm("Disconnect Google Calendar? Its items leave MiOS. Your tasks, and the MiOS calendar in Google, stay.")) {
                  void disconnectGoogle();
                }
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => connectGoogle()}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        )
      }
    >
      {google.enabled ? (
        <p className={s.note}>
          {google.lastSyncAt ? `Last synced ${ago(google.lastSyncAt, now)}` : "Not synced yet"}
          {lastResult ? ` · ${lastResult}` : ""}.{" "}
          {signedIn
            ? "Syncs every few minutes while MiOS is open."
            : "Paused until you press Sync now (Google asks MiOS to sign in again each visit)."}
        </p>
      ) : (
        <p className={s.note}>
          Your tasks with a planned start and your deadlines go to a “MiOS” calendar in Google. Move or delete one there and
          MiOS follows; deleting never deletes the task. While MiOS is in testing, Google shows an “unverified app” screen
          first and asks you to approve again every 7 days.
        </p>
      )}
      {message && <p className={phase === "error" ? s.warn : s.note}>{message}</p>}
    </Card>
  );
}

/** Keeps sync going in the background while signed in: every few minutes, and soon after tasks change. */
export function GoogleRuntime() {
  const enabled = useMios((st) => st.google.enabled);
  const tasks = useMios((st) => st.tasks);

  useEffect(() => {
    if (!enabled || !googleClientId()) return;
    const id = setInterval(() => {
      if (hasValidToken() && document.visibilityState === "visible") void syncGoogle();
    }, AUTO_SYNC_MS);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !hasValidToken()) return;
    const id = setTimeout(() => void syncGoogle(), AFTER_CHANGE_MS);
    return () => clearTimeout(id);
  }, [enabled, tasks]);

  return null;
}
