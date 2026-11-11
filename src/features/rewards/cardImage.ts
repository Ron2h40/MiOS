import type { Wrap, WrapCard } from "@/core";

/**
 * D7: save a stats card as a PNG, drawn in the browser. Nothing is uploaded;
 * the image only contains what's on the card.
 */

const W = 1080;
const H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
};

export const drawCard = (card: WrapCard, wrap: Pick<Wrap, "title" | "periodLabel">): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const g = ctx.createLinearGradient(0, 0, W, H);
  if (card.tone === "compliment") {
    g.addColorStop(0, "#5856d6");
    g.addColorStop(0.55, "#af52de");
    g.addColorStop(1, "#ff6b8b");
  } else {
    g.addColorStop(0, "#1c3d7a");
    g.addColorStop(1, "#0a7f8f");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  let y = 420;

  ctx.globalAlpha = 0.8;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(card.eyebrow.toUpperCase(), W / 2, y);
  ctx.globalAlpha = 1;
  y += 70;

  if (card.value) {
    ctx.font = `800 220px ${FONT}`;
    y += 170;
    ctx.fillText(card.value, W / 2, y);
    y += 60;
  }

  ctx.font = `800 62px ${FONT}`;
  for (const line of wrapLines(ctx, card.headline, W - 160)) {
    y += 76;
    ctx.fillText(line, W / 2, y);
  }

  if (card.detail) {
    ctx.globalAlpha = 0.85;
    ctx.font = `400 38px ${FONT}`;
    y += 30;
    for (const line of wrapLines(ctx, card.detail, W - 200)) {
      y += 54;
      ctx.fillText(line, W / 2, y);
    }
    ctx.globalAlpha = 1;
  }

  ctx.globalAlpha = 0.7;
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(`MiOS · ${wrap.periodLabel}`, W / 2, H - 90);
  ctx.globalAlpha = 1;
  return canvas;
};

export const saveCardImage = (card: WrapCard, wrap: Pick<Wrap, "title" | "periodLabel">) => {
  drawCard(card, wrap).toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mios-${card.id}-${wrap.periodLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
};
