"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { hasActiveBlockers, type Task } from "@/core";
import { B8_LOG_LIMIT } from "@/ai/backgroundLog";
import { avoidList, emptyByFeature, pickFormats, POPUP_STOCK_TARGET, rememberQuestion } from "@/ai/popup";
import type {
  AiFeature,
  AiKind,
  AiRequestMap,
  AiResponse,
  AiTask,
  AnalyzeResult,
  PopupQuestion,
} from "@/ai/types";
import { useMios } from "./store";

/**
 * Browser side of the AI assistant: calls /api/ai, keeps the background
 * analysis log (B8), and the teen pop-up question stock and history.
 * Kept in its own store so the OS core state never depends on AI.
 */

export interface AnalysisEntry {
  id: string;
  at: string;
  triggers: string[];
  summary: string;
  notes: string[];
}

interface AiState {
  /** Background analysis log, newest first. */
  log: AnalysisEntry[];
  /** Prompts shown per feature; cleared at 30 (see POPUP_HISTORY_LIMIT). */
  popupHistory: Record<AiFeature, string[]>;
  /** Questions ready to show per feature. */
  popupStock: Record<AiFeature, PopupQuestion[]>;
  /** The last answer came from demo mode (no API key on the server). */
  demo: boolean;

  recordAnalysis(result: AnalyzeResult, triggers: string[]): void;
  takePopup(feature: AiFeature): Promise<PopupQuestion | null>;
  refillPopups(feature: AiFeature): Promise<void>;
  reset(): void;
}

const initial = () => ({
  log: [] as AnalysisEntry[],
  popupHistory: emptyByFeature<string[]>(() => []),
  popupStock: emptyByFeature<PopupQuestion[]>(() => []),
  demo: false,
});

/** Compact task shape sent to the model. */
export const toAiTask = (t: Task, byId: ReadonlyMap<string, Task>): AiTask => ({
  id: t.id,
  title: t.title,
  mode: t.mode,
  state: t.state,
  priority: t.priority,
  deadline: t.deadline,
  estimateMinutes: t.estimateMinutes,
  actualMinutes: Math.round(t.actualMinutes),
  scheduledStart: t.scheduledStart,
  blocked: hasActiveBlockers(t, byId),
});

const refilling = new Set<AiFeature>();

/** Call the AI route with the shared context (stage, local time, learned notes). */
export async function callAi<K extends AiKind>(kind: K, payload: AiRequestMap[K]): Promise<AiResponse<K>> {
  const stage = useMios.getState().settings.stage;
  const notes = useAi.getState().log[0]?.notes ?? [];
  const now = new Date();
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        payload,
        context: {
          stage,
          now: now.toString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          notes,
        },
      }),
    });
    const body = (await res.json()) as AiResponse<K>;
    if (body.ok) useAi.setState({ demo: body.mock });
    return body;
  } catch {
    return { ok: false, error: "unavailable", message: "Couldn't reach MiOS's AI service." };
  }
}

export const useAi = create<AiState>()(
  persist(
    (set, get) => ({
      ...initial(),

      recordAnalysis(result, triggers) {
        const entry: AnalysisEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), triggers, ...result };
        set((s) => ({ log: [entry, ...s.log].slice(0, B8_LOG_LIMIT) }));
      },

      async takePopup(feature) {
        if (!get().popupStock[feature].length) await get().refillPopups(feature);
        const [q, ...rest] = get().popupStock[feature];
        if (!q) return null;
        set((s) => ({
          popupStock: { ...s.popupStock, [feature]: rest },
          popupHistory: { ...s.popupHistory, [feature]: rememberQuestion(s.popupHistory[feature], q.prompt) },
        }));
        // Top the stock back up in the background so the next pop-up is instant.
        if (rest.length < 2) void get().refillPopups(feature);
        return q;
      },

      async refillPopups(feature) {
        if (refilling.has(feature)) return;
        refilling.add(feature);
        try {
          const { popupHistory, popupStock } = get();
          const need = Math.max(0, POPUP_STOCK_TARGET - popupStock[feature].length);
          if (!need) return;
          const r = await callAi("popup", {
            feature,
            formats: pickFormats(need),
            avoid: avoidList(popupHistory[feature], popupStock[feature]),
          });
          if (!r.ok) return;
          const fresh: PopupQuestion[] = r.result.questions.map((q) => ({ ...q, id: crypto.randomUUID(), feature }));
          set((s) => ({ popupStock: { ...s.popupStock, [feature]: [...s.popupStock[feature], ...fresh] } }));
        } finally {
          refilling.delete(feature);
        }
      },

      reset() {
        set(initial());
      },
    }),
    {
      name: "mios:ai:v1",
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ log, popupHistory, popupStock }) => ({ log, popupHistory, popupStock }),
    },
  ),
);
