"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { PhoneNotice } from "./notices";
import s from "./phone.module.css";

/** Hold this long before the button can be dragged. */
const HOLD_MS = 280;

interface Gesture {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  maxX: number;
  maxY: number;
  mode: "press" | "drag" | "swipe" | "none";
  timer: ReturnType<typeof setTimeout>;
}

const POS_KEY = "mios:floater";

const savedPos = (): { x: number; y: number } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
};

/**
 * One floating button for everything else that needs you. Tap to open the
 * notice it shows, swipe sideways for the next one, hold and drag to move it
 * anywhere on the page (remembered on this phone). Sorted notices leave it;
 * with none left it's gone.
 */
export function Floater({ notices, onOpen }: { notices: PhoneNotice[]; onOpen: (n: PhoneNotice) => void }) {
  const [index, setIndex] = useState(0);
  // Rendered only after the page has loaded (phone layout), so reading storage here is safe.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(savedPos);
  const [dragging, setDragging] = useState(false);
  const [swipeDx, setSwipeDx] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const skipClick = useRef(false);

  if (!notices.length) return null;
  const i = Math.min(index, notices.length - 1);
  const notice = notices[i];
  const step = (dir: 1 | -1) => setIndex((i + dir + notices.length) % notices.length);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const box = (el.offsetParent as HTMLElement).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    gesture.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: r.left - box.left,
      oy: r.top - box.top,
      maxX: box.width - r.width - 8,
      maxY: box.height - r.height - 8,
      mode: "press",
      timer: setTimeout(() => {
        if (gesture.current?.mode !== "press") return;
        gesture.current.mode = "drag";
        setDragging(true);
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10);
      }, HOLD_MS),
    };
  };

  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (g.mode === "press" && Math.hypot(dx, dy) > 8) {
      clearTimeout(g.timer);
      g.mode = Math.abs(dx) > Math.abs(dy) ? "swipe" : "none";
    }
    if (g.mode === "drag") {
      setPos({ x: Math.min(Math.max(g.ox + dx, 8), g.maxX), y: Math.min(Math.max(g.oy + dy, 8), g.maxY) });
    } else if (g.mode === "swipe") {
      setSwipeDx(dx);
    }
  };

  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.timer);
    const dx = e.clientX - g.sx;
    if (g.mode !== "press") skipClick.current = true;
    if (g.mode === "drag") {
      setDragging(false);
      try {
        if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        // Not remembered; it still moved.
      }
    }
    if (g.mode === "swipe") {
      if (Math.abs(dx) > 36 && notices.length > 1) step(dx < 0 ? 1 : -1);
      setSwipeDx(0);
    }
  };

  return (
    <button
      type="button"
      className={`${s.floater} ${dragging ? s.floaterDragging : ""}`}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      aria-label={`${notices.length} ${notices.length === 1 ? "thing needs" : "things need"} you. Showing ${notice.name}. Swipe for the next, hold to move.`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        if (gesture.current) clearTimeout(gesture.current.timer);
        gesture.current = null;
        setDragging(false);
        setSwipeDx(0);
      }}
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        onOpen(notice);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <span className={s.floaterDot} aria-hidden />
      <span
        className={s.floaterLabel}
        style={swipeDx ? { transform: `translateX(${swipeDx * 0.35}px)`, opacity: 1 - Math.min(Math.abs(swipeDx) / 160, 0.6) } : undefined}
      >
        <span aria-hidden>{notice.icon}</span>
        <span className={s.floaterName}>{notice.name}</span>
      </span>
      {notices.length > 1 && (
        <span className={s.floaterDots} aria-hidden>
          {notices.map((n, k) => (
            <span key={n.id} className={k === i ? s.on : ""} />
          ))}
        </span>
      )}
    </button>
  );
}
