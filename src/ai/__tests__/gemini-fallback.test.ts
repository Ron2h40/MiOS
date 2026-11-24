import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { withFallback } = await import("../server/gemini");

/** A fake Google that answers each model with the next status in its list. */
const google = (answers: Record<string, number[]>) => {
  const asked: string[] = [];
  const send = async (model: string) => {
    asked.push(model);
    return new Response("{}", { status: answers[model]?.shift() ?? 200 });
  };
  return { send, asked };
};
const noPause = async () => {};

describe("Gemini fallback", () => {
  it("uses the main model when it answers", async () => {
    const g = google({ main: [200] });
    expect((await withFallback(g.send, "main", "backup", noPause)).status).toBe(200);
    expect(g.asked).toEqual(["main"]);
  });

  it("switches to the backup straight away when the free limit is used up", async () => {
    const g = google({ main: [429], backup: [200] });
    expect((await withFallback(g.send, "main", "backup", noPause)).status).toBe(200);
    expect(g.asked).toEqual(["main", "backup"]);
  });

  it("retries an overloaded main model once, then asks the backup", async () => {
    const g = google({ main: [503, 503], backup: [200] });
    expect((await withFallback(g.send, "main", "backup", noPause)).status).toBe(200);
    expect(g.asked).toEqual(["main", "main", "backup"]);
  });

  it("asks the backup if the retry hits the free limit", async () => {
    const g = google({ main: [503, 429], backup: [200] });
    expect((await withFallback(g.send, "main", "backup", noPause)).status).toBe(200);
    expect(g.asked).toEqual(["main", "main", "backup"]);
  });

  it("reports the limit when both models are used up", async () => {
    const g = google({ main: [429], backup: [429] });
    expect((await withFallback(g.send, "main", "backup", noPause)).status).toBe(429);
  });

  it("doesn't ask the same model twice when there's no separate backup", async () => {
    const g = google({ main: [429] });
    expect((await withFallback(g.send, "main", "main", noPause)).status).toBe(429);
    expect(g.asked).toEqual(["main"]);
  });
});
