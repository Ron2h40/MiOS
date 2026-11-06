"use client";

import { useEffect } from "react";
import { b8Active, B8_MAX_WAIT_MS, B8_QUIET_MS, describeEvent, isB8Trigger } from "@/ai/backgroundLog";
import type { AiFeature } from "@/ai/types";
import type { MiosEvent } from "@/core";
import { callAi, toAiTask, useAi } from "@/state/ai";
import { useMios } from "@/state/store";

/**
 * Invisible worker mounted once in the app shell.
 * - B8: watches the event log; after a burst of cognitive actions or AI use
 *   goes quiet, sends one background review. Silent: no notification.
 * - Teen stage: keeps a few pop-up questions ready for each AI feature.
 */
export function AiRuntime() {
  useEffect(() => {
    let pending: MiosEvent[] = [];
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let seen = useMios.getState().events.length;

    const flush = async () => {
      clearTimeout(quiet);
      clearTimeout(deadline);
      quiet = deadline = undefined;
      const batch = pending;
      pending = [];
      const { tasks, events, settings } = useMios.getState();
      if (!batch.length || !b8Active(settings.stage)) return;

      const byId = new Map(tasks.map((t) => [t.id, t]));
      const r = await callAi("analyze", {
        triggers: batch.map((e) => describeEvent(e, byId)),
        recentEvents: events.slice(-30).map((e) => describeEvent(e, byId)),
        tasks: tasks.filter((t) => t.state !== "done").slice(0, 30).map((t) => toAiTask(t, byId)),
        previousSummary: useAi.getState().log[0]?.summary ?? "",
      });
      // Failures are dropped quietly; the next action tries again.
      if (r.ok) useAi.getState().recordAnalysis(r.result, batch.map((e) => describeEvent(e, byId)));
    };

    const unsubscribe = useMios.subscribe((state) => {
      if (state.events.length < seen) seen = 0; // data was reset or imported
      const fresh = state.events.slice(seen);
      seen = state.events.length;
      if (!b8Active(state.settings.stage)) return;
      const triggers = fresh.filter(isB8Trigger);
      if (!triggers.length) return;
      pending.push(...triggers);
      clearTimeout(quiet);
      quiet = setTimeout(flush, B8_QUIET_MS);
      deadline ??= setTimeout(flush, B8_MAX_WAIT_MS);
    });

    // Send anything waiting if the tab is closed or hidden.
    const onHide = () => document.visibilityState === "hidden" && pending.length && void flush();
    document.addEventListener("visibilitychange", onHide);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(quiet);
      clearTimeout(deadline);
    };
  }, []);

  const stage = useMios((s) => s.settings.stage);
  useEffect(() => {
    if (stage !== "teen") return;
    const features: AiFeature[] = ["priority", "schedule", "interrupt", "estimate"];
    // Stagger the first fill so the free tier isn't hit with four calls at once.
    const timers = features.map((f, i) => setTimeout(() => void useAi.getState().refillPopups(f), 1500 + i * 2500));
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  return null;
}
