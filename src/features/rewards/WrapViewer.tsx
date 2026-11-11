"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Wrap } from "@/core";
import { saveCardImage } from "./cardImage";
import s from "./rewards.module.css";

/**
 * D1 stats drop: full-screen cards, one stat each.
 * Tap right or press → for next, tap left or ← for back, Esc to close.
 */
export function WrapViewer({ wrap, onClose }: { wrap: Wrap; onClose: () => void }) {
  const [i, setI] = useState(0);
  const last = wrap.cards.length - 1;
  const card = wrap.cards[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(last, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [last, onClose]);

  if (!card) return null;

  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={`${wrap.title}, ${wrap.periodLabel}`}>
      <div className={s.topRow}>
        <div className={s.progress} aria-hidden>
          {wrap.cards.map((c, n) => (
            <span key={c.id} className={`${s.segment} ${n <= i ? s.segmentDone : ""}`} />
          ))}
        </div>
        <div className={s.meta}>
          <span>
            {wrap.title} · {wrap.periodLabel}
          </span>
          <button type="button" className={s.ghost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className={s.stage}>
        <article key={card.id} className={`${s.card} ${s[card.tone]}`} aria-live="polite">
          <span className={s.eyebrow}>{card.eyebrow}</span>
          {card.value && <span className={s.value}>{card.value}</span>}
          <h2 className={s.headline}>{card.headline}</h2>
          {card.detail && <p className={s.detail}>{card.detail}</p>}
        </article>
        <button type="button" className={s.tapLeft} aria-label="Previous card" onClick={() => setI((x) => Math.max(0, x - 1))} />
        <button type="button" className={s.tapRight} aria-label="Next card" onClick={() => setI((x) => Math.min(last, x + 1))} />
      </div>

      <div className={s.controls}>
        <button type="button" className={s.ghost} disabled={i === 0} onClick={() => setI(i - 1)}>
          Back
        </button>
        <button type="button" className={s.ghost} onClick={() => saveCardImage(card, wrap)}>
          Save image
        </button>
        {i < last ? (
          <button type="button" className={s.primary} onClick={() => setI(i + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className={s.primary} onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
