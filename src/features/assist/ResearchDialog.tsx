"use client";

import { useState } from "react";
import { RESEARCH_PER_DAY, researchUsedToday, type Task, type TaskResearch } from "@/core";
import type { ResearchResult } from "@/ai/types";
import { AiCard, WhyButton, type AiStatus } from "@/features/ai/AiHelp";
import { callAi } from "@/state/ai";
import { useStage } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatWhen } from "@/ui/format";
import { Button, Dialog } from "@/ui/primitives";
import s from "./assist.module.css";

const LEAD = {
  child: "Ask a question. AI searches the web and sums up what it finds, with the sources.",
  teen: "Ask a question. AI finds sources and says what to look for. You read them and write the summary.",
  adult: "Research you saved with this task.",
} as const;

/**
 * B5: research help. Child: a summary with sources. Teen: sources only, and
 * the user writes the summary. Sources always come from Google Search
 * results. Each result is kept with the task.
 */
export function ResearchDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const events = useMios((st) => st.events);
  const addResearch = useMios((st) => st.addResearch);
  const logAiUse = useMios((st) => st.logAiUse);
  const live = useMios((st) => st.tasks.find((t) => t.id === task.id)) ?? task;
  const { stage, policy } = useStage();
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<AiStatus<ResearchResult>>({ state: "idle" });
  const [latestId, setLatestId] = useState<string | null>(null);

  // Read at render: the dialog only exists while open, so this is "now" for the cap.
  const [openedAt] = useState(() => Date.now());
  const used = researchUsedToday(events, openedAt);
  const left = Math.max(0, RESEARCH_PER_DAY - used);
  const canAsk = policy.aiButton && task.state !== "done";

  const ask = async () => {
    const q = question.trim();
    if (!q || !left) return;
    logAiUse("B5");
    setStatus({ state: "loading" });
    const r = await callAi("research", { question: q, task: { title: task.title, mode: task.mode } });
    if (!r.ok) return setStatus({ state: "error", error: r.error });
    const saved = addResearch(task.id, {
      question: q,
      sources: r.result.sources,
      ...(r.result.summary ? { summary: r.result.summary } : {}),
      ...(r.result.guide ? { guide: r.result.guide } : {}),
      why: r.result.why,
      provider: r.result.provider,
    });
    setLatestId(saved?.id ?? null);
    setQuestion("");
    setStatus({ state: "done", result: r.result });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Research: ${task.title}`}
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className={s.lead}>{LEAD[stage]}</p>

      {canAsk && (
        <>
          <form
            className={s.ask}
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What do you want to find out?"
              aria-label="Research question"
              maxLength={300}
            />
            <Button type="submit" variant="secondary" disabled={!question.trim() || !left || status.state === "loading"}>
              <span aria-hidden>✦ </span>
              {stage === "teen" ? "Find sources" : "Research"}
            </Button>
          </form>
          <p className={s.note}>
            {left
              ? `${left} of ${RESEARCH_PER_DAY} searches left today. Your question and the task title go to Google Gemini and Google Search, or to Wikipedia when Google Search isn't available.`
              : `That's today's ${RESEARCH_PER_DAY} searches. More tomorrow.`}
          </p>
        </>
      )}

      {/* Errors and loading; a finished answer shows in the list below. */}
      {status.state !== "done" && <AiCard title="Research" status={status} />}
      {status.state === "done" && status.result.searchWidget && (
        // Google asks for its search suggestions to be shown with every grounded answer.
        <iframe
          className={s.searchWidget}
          title="Google Search suggestions"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={status.result.searchWidget}
        />
      )}

      {live.research?.length ? (
        <ul className={s.researchList}>
          {live.research.map((r) => (
            <ResearchItem key={r.id} task={live} item={r} fresh={r.id === latestId} />
          ))}
        </ul>
      ) : (
        !canAsk && <p className={s.note}>No research saved for this task.</p>
      )}
    </Dialog>
  );
}

function ResearchItem({ task, item, fresh }: { task: Task; item: TaskResearch; fresh: boolean }) {
  const setResearchSummary = useMios((st) => st.setResearchSummary);
  const removeResearch = useMios((st) => st.removeResearch);
  const [mine, setMine] = useState(item.mine ?? "");
  const [editing, setEditing] = useState(!item.mine && !item.summary);
  const dirty = mine.trim() !== (item.mine ?? "");

  return (
    <li className={`${s.researchItem} ${fresh ? s.fresh : ""}`}>
      <div className={s.researchHead}>
        <strong>{item.question}</strong>
        <span className={s.note}>
          {item.provider === "wikipedia" ? "From Wikipedia · " : ""}
          {formatWhen(item.at)}
        </span>
      </div>
      {item.summary && <p className={s.summary}>{item.summary}</p>}
      {item.guide && (
        <p className={s.guide}>
          <span className={s.label}>What to look for</span>
          {item.guide}
        </p>
      )}
      <ol className={s.sources}>
        {item.sources.map((src) => (
          <li key={src.url}>
            <a href={src.url} target="_blank" rel="noopener noreferrer">
              {src.title}
            </a>
          </li>
        ))}
      </ol>

      {editing ? (
        <label className={s.mine}>
          <span className={s.label}>Your summary</span>
          <textarea
            rows={4}
            value={mine}
            maxLength={4000}
            placeholder="In your own words: what did the sources say?"
            onChange={(e) => setMine(e.target.value)}
          />
        </label>
      ) : (
        item.mine && (
          <p className={s.summary}>
            <span className={s.label}>Your summary</span>
            {item.mine}
          </p>
        )
      )}

      <div className={s.row}>
        {editing ? (
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            onClick={() => {
              setResearchSummary(task.id, item.id, mine);
              setEditing(!mine.trim());
            }}
          >
            Save summary
          </Button>
        ) : (
          <Button size="sm" variant="plain" onClick={() => setEditing(true)}>
            {item.mine ? "Edit your summary" : "Add your summary"}
          </Button>
        )}
        {item.why && <WhyButton why={item.why} />}
        <Button
          size="sm"
          variant="plain"
          onClick={() => confirm(`Remove the research on "${item.question}"?`) && removeResearch(task.id, item.id)}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}
