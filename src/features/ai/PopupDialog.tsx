"use client";

import { useEffect, useState } from "react";
import { isAnswered, shuffled, type PopupAnswer } from "@/ai/popup";
import { AI_FEATURES, type AiFeature, type PopupQuestion } from "@/ai/types";
import { useAi } from "@/state/ai";
import { useMios } from "@/state/store";
import { Button, Dialog } from "@/ui/primitives";
import s from "./ai.module.css";

/**
 * Teen stage: a quick made-up scenario before AI help. It adds friction so
 * the user thinks first. There is no right answer and nothing is graded; a
 * suggested way to think about it shows after they answer.
 */
export function PopupDialog({
  feature,
  onDone,
  onCancel,
}: {
  feature: AiFeature;
  onDone: () => void;
  onCancel: () => void;
}) {
  const takePopup = useAi((st) => st.takePopup);
  const logPopup = useMios((st) => st.logPopup);
  const [question, setQuestion] = useState<PopupQuestion | null | "loading">("loading");
  const [answer, setAnswer] = useState<PopupAnswer | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let live = true;
    void takePopup(feature).then((q) => {
      if (!live) return;
      setQuestion(q);
      if (q) setAnswer(q.format === "order" ? { format: "order", value: shuffled(q.options ?? []) } : { format: q.format, value: "" });
    });
    return () => {
      live = false;
    };
  }, [feature, takePopup]);

  const label = AI_FEATURES[feature].label;
  const ready = answer !== null && isAnswered(answer);

  const skip = () => {
    logPopup(feature, "skipped");
    onDone();
  };
  const submit = () => {
    if (!ready) return;
    logPopup(feature, "answered");
    setSubmitted(true);
  };

  let body;
  let actions;
  if (question === "loading") {
    body = <p className={s.loading}>Getting a question…</p>;
    actions = (
      <Button variant="plain" onClick={onCancel}>
        Cancel
      </Button>
    );
  } else if (!question || !answer) {
    body = <p>Couldn&apos;t load a question right now. Take a second to think about it yourself first.</p>;
    actions = (
      <Button variant="primary" onClick={onDone}>
        Continue to {label}
      </Button>
    );
  } else if (submitted) {
    body = (
      <>
        <p className={s.scenario}>{question.prompt}</p>
        <div className={s.suggested}>
          <span className={s.whyLabel}>One way to think about it</span>
          <p>{question.suggested}</p>
        </div>
      </>
    );
    actions = (
      <Button variant="primary" onClick={onDone} autoFocus>
        Continue to {label}
      </Button>
    );
  } else {
    body = (
      <>
        <span className={s.kicker}>Think first · no wrong answers</span>
        <p className={s.scenario}>{question.prompt}</p>
        <AnswerInput question={question} answer={answer} onChange={setAnswer} onSubmit={submit} />
      </>
    );
    actions = (
      <>
        <Button variant="plain" onClick={skip}>
          Skip
        </Button>
        <Button variant="primary" onClick={submit} disabled={!ready}>
          Answer
        </Button>
      </>
    );
  }

  return (
    <Dialog open onClose={onCancel} title="Quick question" actions={actions}>
      {body}
    </Dialog>
  );
}

function AnswerInput({
  question,
  answer,
  onChange,
  onSubmit,
}: {
  question: PopupQuestion;
  answer: PopupAnswer;
  onChange: (a: PopupAnswer) => void;
  onSubmit: () => void;
}) {
  switch (answer.format) {
    case "choice":
      return (
        <div className={s.options} role="radiogroup">
          {(question.options ?? []).map((o) => (
            <label key={o} className={s.option}>
              <input
                type="radio"
                name="popup-choice"
                checked={answer.value === o}
                onChange={() => onChange({ format: "choice", value: o })}
              />
              {o}
            </label>
          ))}
        </div>
      );
    case "order": {
      const move = (i: number, d: -1 | 1) => {
        const next = [...answer.value];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        onChange({ format: "order", value: next });
      };
      return (
        <ol className={s.options} aria-label="Put these in order">
          {answer.value.map((item, i) => (
            <li key={item} className={s.orderRow}>
              <span className={s.num}>{i + 1}</span>
              <span>{item}</span>
              <Button variant="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${item} up`}>
                ↑
              </Button>
              <Button
                variant="icon"
                disabled={i === answer.value.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move ${item} down`}
              >
                ↓
              </Button>
            </li>
          ))}
        </ol>
      );
    }
    case "number":
      return (
        <label>
          Your answer{question.unit ? ` (${question.unit})` : ""}
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={answer.value}
            onChange={(e) => onChange({ format: "number", value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          />
        </label>
      );
    default:
      return (
        <label>
          Your answer
          <input
            autoFocus
            maxLength={200}
            value={answer.value}
            onChange={(e) => onChange({ format: "text", value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          />
        </label>
      );
  }
}
