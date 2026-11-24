import { describe, expect, it } from "vitest";
import type { MiosEvent, Task } from "@/core";
import { describeEvent, isB8Trigger, plainNames } from "../backgroundLog";
import { mockResult } from "../mock";
import { avoidList, isAnswered, pickFormats, POPUP_HISTORY_LIMIT, rememberQuestion, shuffled } from "../popup";
import { buildPrompt } from "../prompts";
import type { AiCall, AiTask } from "../types";
import { parseEstimate, parseInterrupt, parsePopup, parsePriority, parseSchedule } from "../validate";

const AT = "2026-11-05T15:00:00.000Z";
const ev = (e: Record<string, unknown>) => ({ at: AT, stage: "child", ...e }) as MiosEvent;
const ctx = (stage: "child" | "teen" = "child") => ({ stage, now: AT, timeZone: "UTC", notes: [] });
const aiTask = (id: string, over: Partial<AiTask> = {}): AiTask => ({
  id, title: `Task ${id}`, mode: "chores", state: "ready", priority: 2, actualMinutes: 0, blocked: false, ...over,
});

describe("pop-up question history", () => {
  it("clears once a feature reaches 30 questions", () => {
    let h: string[] = [];
    for (let i = 1; i < POPUP_HISTORY_LIMIT; i++) h = rememberQuestion(h, `q${i}`);
    expect(h).toHaveLength(29);
    expect(rememberQuestion(h, "q30")).toEqual([]);
  });

  it("avoids both past questions and ones already in stock", () => {
    const stock = [{ id: "1", feature: "priority" as const, format: "text" as const, prompt: "in stock", suggested: "x" }];
    expect(avoidList(["old"], stock)).toEqual(["old", "in stock"]);
  });

  it("picks formats at random from all four", () => {
    const seq = [0, 0.3, 0.6, 0.9];
    let i = 0;
    expect(pickFormats(4, () => seq[i++])).toEqual(["choice", "text", "order", "number"]);
  });

  it("shuffles order items so the suggested order isn't given away", () => {
    const items = ["a", "b", "c"];
    for (let k = 0; k < 20; k++) {
      const s = shuffled(items);
      expect([...s].sort()).toEqual(items);
      expect(s).not.toEqual(items);
    }
  });

  it("counts an answer only when the user engaged", () => {
    expect(isAnswered({ format: "text", value: "  " })).toBe(false);
    expect(isAnswered({ format: "text", value: "eat first" })).toBe(true);
    expect(isAnswered({ format: "number", value: "abc" })).toBe(false);
    expect(isAnswered({ format: "number", value: "30" })).toBe(true);
    expect(isAnswered({ format: "choice", value: "" })).toBe(false);
  });
});

describe("validating model output", () => {
  it("drops invented task ids and keeps tasks the model forgot", () => {
    const r = parsePriority({ order: ["b", "ghost", "b", "a"], reasons: [{ taskId: "ghost", why: "x" }], why: "w" }, ["a", "b", "c"]);
    expect(r?.order).toEqual(["b", "a", "c"]);
    expect(r?.reasons).toEqual([]);
  });

  it("rejects a priority answer with no usable ids", () => {
    expect(parsePriority({ order: ["nope"] }, ["a"])).toBeNull();
    expect(parsePriority("not json", ["a"])).toBeNull();
  });

  it("keeps only well-formed schedule slots", () => {
    const r = parseSchedule({ slots: [{ taskId: "a", start: "09:30" }, { taskId: "b", start: "25:00" }, { taskId: "x", start: "10:00" }] }, ["a", "b"]);
    expect(r?.slots).toEqual([{ taskId: "a", start: "09:30" }]);
  });

  it("checks enums and ranges", () => {
    expect(parseInterrupt({ severity: "panic", warning: "x" })).toBeNull();
    expect(parseInterrupt({ severity: "low", warning: "Minor delay" })?.severity).toBe("low");
    expect(parseEstimate({ minutes: 0, effort: "low" })).toBeNull();
    expect(parseEstimate({ minutes: 44.6, effort: "medium" })?.minutes).toBe(45);
  });

  it("enforces each pop-up format's shape", () => {
    const r = parsePopup({
      questions: [
        { format: "choice", prompt: "p1", options: ["only one"], suggested: "s" },
        { format: "order", prompt: "p2", options: ["a", "b", "c"], suggested: "s" },
        { format: "number", prompt: "p3", suggested: "s" },
        { format: "essay", prompt: "p4", suggested: "s" },
      ],
    });
    expect(r?.questions.map((q) => q.format)).toEqual(["order", "number"]);
    expect(r?.questions[1].unit).toBe("minutes");
  });
});

describe("background log (B8)", () => {
  it("runs on cognitive actions and AI use only", () => {
    expect(isB8Trigger(ev({ type: "decision_made", usedAi: false, feature: "order" }))).toBe(true);
    expect(isB8Trigger(ev({ type: "task_completed", taskId: "t", onTime: true, ownChoice: true }))).toBe(true);
    expect(isB8Trigger(ev({ type: "time_guess", taskId: "t", minutes: 20 }))).toBe(true);
    expect(isB8Trigger(ev({ type: "blocker_added", taskId: "t", kind: "person" }))).toBe(true);
    expect(isB8Trigger(ev({ type: "ai_used", feature: "B1" }))).toBe(true);
    expect(isB8Trigger(ev({ type: "popup_question", feature: "priority", outcome: "answered" }))).toBe(true);
    expect(isB8Trigger(ev({ type: "popup_question", feature: "priority", outcome: "skipped" }))).toBe(false);
    expect(isB8Trigger(ev({ type: "task_created", taskId: "t", mode: "chores", isInterrupt: false }))).toBe(false);
    expect(isB8Trigger(ev({ type: "task_state_changed", taskId: "t", from: "ready", to: "running" }))).toBe(false);
  });

  it("describes events in plain words with task titles", () => {
    const tasks = new Map([["t", { title: "Laundry" } as Task]]);
    expect(describeEvent(ev({ type: "time_guess", taskId: "t", minutes: 20 }), tasks)).toContain('guessed 20 min for "Laundry"');
  });

  it("names AI features in plain words, never by internal code", () => {
    const line = describeEvent(ev({ type: "ai_used", feature: "B4" }), new Map());
    expect(line).toContain("used AI for time estimates");
    expect(line).not.toMatch(/\bB\d\b/);
  });

  it("swaps codes left in older notes for plain names", () => {
    expect(plainNames("Often uses AI for B4 before starting.")).toBe("Often uses AI for time estimates before starting.");
    expect(plainNames("Asks B1 and B6 for help.")).toBe("Asks priority help and task breakdown for help.");
    expect(plainNames("Plans in B-blocks")).toBe("Plans in B-blocks");
  });
});

describe("prompts", () => {
  it("tells the model never to write internal codes", () => {
    const call = { kind: "estimate", context: { stage: "child", now: "2026-11-23T10:00:00.000Z", timeZone: "UTC", notes: [] } } as unknown as AiCall;
    expect(buildPrompt({ ...call, payload: {} } as AiCall).system).toContain("Never write internal codes");
  });

  it("adds the question-leaning rule only at teen stage", () => {
    const call = (stage: "child" | "teen"): AiCall<"priority"> => ({ kind: "priority", context: ctx(stage), payload: { tasks: [aiTask("a")] } });
    expect(buildPrompt(call("teen")).system).toContain("Lean toward questions");
    expect(buildPrompt(call("child")).system).not.toContain("Lean toward questions");
  });

  it("asks pop-ups not to repeat earlier questions", () => {
    const p = buildPrompt({ kind: "popup", context: ctx("teen"), payload: { feature: "priority", formats: ["choice"], avoid: ["Old question?"] } });
    expect(p.user).toContain("Old question?");
    expect(p.user).toContain("made-up");
  });
});

describe("demo AI (no API key)", () => {
  it("returns valid answers that pass the validators", () => {
    const tasks = [aiTask("a", { priority: 3 }), aiTask("b", { priority: 1 })];
    const order = mockResult({ kind: "priority", context: ctx(), payload: { tasks } });
    expect(parsePriority(order, ["a", "b"])?.order).toEqual(["b", "a"]);
    const popup = mockResult({ kind: "popup", context: ctx("teen"), payload: { feature: "priority", formats: ["choice", "order"], avoid: [] } });
    expect(parsePopup(popup)?.questions).toHaveLength(2);
  });

  it("skips demo pop-ups that were already asked", () => {
    const first = mockResult({ kind: "popup", context: ctx("teen"), payload: { feature: "priority", formats: ["choice"], avoid: [] } });
    const again = mockResult({
      kind: "popup",
      context: ctx("teen"),
      payload: { feature: "priority", formats: ["choice"], avoid: [first.questions[0].prompt] },
    });
    expect(again.questions[0].prompt).not.toBe(first.questions[0].prompt);
  });
});
