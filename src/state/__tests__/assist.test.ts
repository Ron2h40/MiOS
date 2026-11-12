import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanSteps,
  fixedReviewQuestions,
  isBigTask,
  RESEARCH_PER_DAY,
  researchUsedToday,
  REVIEW_QUESTIONS,
  reviewDue,
  type MiosEvent,
} from "@/core";
import { makeTask } from "@/core/__tests__/fixtures";
import { describeEvent, isB8Trigger } from "@/ai/backgroundLog";
import { mockResult } from "@/ai/mock";
import { buildArticlePrompt, buildPrompt } from "@/ai/prompts";
import type { AiCall, AiTask } from "@/ai/types";
import { parseArticleAnswer, parseBreakdown, parseCheckSteps, parseResearch, parseResult, parseReview } from "@/ai/validate";
import { exportSnapshot, useMios } from "../store";

const st = () => useMios.getState();
const at = (min: number) => new Date(2026, 10, 11, 10, min);
const ctx = (stage: "child" | "teen" = "child") => ({ stage, now: at(0).toISOString(), timeZone: "UTC", notes: [] });
const aiTask: AiTask = { id: "t", title: "Essay", mode: "daily-life", state: "ready", priority: 2, actualMinutes: 0, blocked: false };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(0));
  st().reset();
});
afterEach(() => vi.useRealTimers());

describe("big tasks", () => {
  it("are guessed or took an hour or more, or have steps", () => {
    expect(isBigTask({ estimateMinutes: 60, actualMinutes: 0 })).toBe(true);
    expect(isBigTask({ estimateMinutes: 30, actualMinutes: 61 })).toBe(true);
    expect(isBigTask({ actualMinutes: 0, steps: [{ id: "1", title: "a", done: false }] })).toBe(true);
    expect(isBigTask({ estimateMinutes: 59, actualMinutes: 59, steps: [] })).toBe(false);
  });
});

describe("B6 steps", () => {
  it("cleans titles: trims, drops blanks and repeats", () => {
    expect(cleanSteps(["  Draft  intro ", "", "draft intro", "Edit"])).toEqual(["Draft intro", "Edit"]);
  });

  it("saving keeps ticks on steps that stay, and logs the user's own steps for B8", () => {
    const t = st().addTask({ title: "Essay", mode: "daily-life", priority: 3, estimateMinutes: 90 });
    st().setSteps(t.id, ["Outline", "Draft", "Edit"], false);
    const outline = st().tasks[0].steps![0];
    st().toggleStep(t.id, outline.id);
    st().setSteps(t.id, ["outline", "Draft", "Proofread"], true);
    expect(st().tasks[0].steps!.map((x) => [x.title, x.done])).toEqual([
      ["outline", true],
      ["Draft", false],
      ["Proofread", false],
    ]);
    const own = st().events.filter((e) => e.type === "own_work");
    expect(own).toHaveLength(1);
    expect(isB8Trigger(own[0])).toBe(true);
  });

  it("saving no steps removes them; working on a repeat day keeps it from being replaced", () => {
    const d0 = st().addRepeatingTask({ title: "Study", mode: "daily-life", priority: 3 }, { kind: "daily" });
    st().setSteps(d0.id, ["Read"], true);
    expect(st().tasks[0].oneOff).toBe(true);
    st().setSteps(d0.id, [], true);
    expect(st().tasks[0].steps).toBeUndefined();
  });
});

describe("B5 research", () => {
  it("is kept with the task, newest first; the user's summary counts as their own work", () => {
    const t = st().addTask({ title: "Trip", mode: "daily-life", priority: 3 });
    const a = st().addResearch(t.id, { question: "Visa?", sources: [{ title: "gov", url: "https://a.gov" }], guide: "Check dates" })!;
    st().addResearch(t.id, { question: "Weather?", sources: [{ title: "x", url: "https://x.org" }], summary: "Mild." });
    expect(st().tasks[0].research!.map((r) => r.question)).toEqual(["Weather?", "Visa?"]);
    st().setResearchSummary(t.id, a.id, "  Need it 30 days ahead. ");
    expect(st().tasks[0].research![1].mine).toBe("Need it 30 days ahead.");
    st().setResearchSummary(t.id, a.id, "   ");
    expect(st().tasks[0].research![1].mine).toBeUndefined();
    expect(st().events.filter((e) => e.type === "own_work")).toHaveLength(1);
    st().removeResearch(t.id, a.id);
    expect(st().tasks[0].research).toHaveLength(1);
  });

  it("is capped per day, counted from AI use", () => {
    for (let i = 0; i < RESEARCH_PER_DAY; i++) st().logAiUse("B5");
    st().logAiUse("B6");
    expect(researchUsedToday(st().events, Date.now())).toBe(RESEARCH_PER_DAY);
    expect(researchUsedToday(st().events, at(0).getTime() + 86_400_000)).toBe(0);
  });

  it("export and import keep steps, research and reviews", () => {
    const t = st().addTask({ title: "Trip", mode: "daily-life", priority: 3 });
    st().setSteps(t.id, ["Book"], true);
    st().addResearch(t.id, { question: "Visa?", sources: [{ title: "gov", url: "https://a.gov" }] });
    const json = exportSnapshot();
    st().reset();
    st().importData(json);
    expect(st().tasks[0]).toMatchObject({ steps: [{ title: "Book" }], research: [{ question: "Visa?" }] });
  });
});

describe("B7 review", () => {
  it("is due right after a big task is finished, once", () => {
    const big = st().addTask({ title: "Essay", mode: "daily-life", priority: 3, estimateMinutes: 90 });
    const small = st().addTask({ title: "Dishes", mode: "chores", priority: 3, estimateMinutes: 10 });
    st().setTaskState(small.id, "done");
    expect(reviewDue(st().tasks, st().events, Date.now())).toBeUndefined();
    st().setTaskState(big.id, "done");
    expect(reviewDue(st().tasks, st().events, Date.now())?.id).toBe(big.id);
    // Ten minutes later it's no longer offered.
    expect(reviewDue(st().tasks, st().events, at(11).getTime())).toBeUndefined();
    st().saveReview(big.id, { answers: [{ question: "q", answer: "" }], ai: false, skipped: true });
    expect(reviewDue(st().tasks, st().events, Date.now())).toBeUndefined();
    expect(st().events.some((e) => e.type === "own_work")).toBe(false);
  });

  it("answers count as the user's own work; reopening and finishing again doesn't ask twice", () => {
    const t = st().addTask({ title: "Essay", mode: "daily-life", priority: 3, estimateMinutes: 90 });
    st().setTaskState(t.id, "done");
    st().saveReview(t.id, { answers: [{ question: "What went well?", answer: " The outline " }], ai: true });
    expect(st().tasks[0].review).toMatchObject({ ai: true, answers: [{ answer: "The outline" }] });
    expect(st().events.filter((e) => e.type === "own_work")).toHaveLength(1);
    st().setTaskState(t.id, "ready");
    st().setTaskState(t.id, "done");
    expect(reviewDue(st().tasks, st().events, Date.now())).toBeUndefined();
  });

  it("fixed questions rotate, three at a time", () => {
    expect(fixedReviewQuestions(0)).toEqual(REVIEW_QUESTIONS.slice(0, 3));
    expect(fixedReviewQuestions(1)).toEqual(REVIEW_QUESTIONS.slice(3, 6));
    expect(fixedReviewQuestions(2)).toEqual(REVIEW_QUESTIONS.slice(0, 3));
  });
});

describe("B5–B7 AI answers", () => {
  it("breakdown needs at least two clean steps", () => {
    expect(parseBreakdown({ steps: ["Outline", "outline", "  "], why: "w" })).toBeNull();
    expect(parseBreakdown({ steps: ["Outline", "Draft"], why: "" })).toMatchObject({ steps: ["Outline", "Draft"] });
  });

  it("step checks refer only to steps that exist", () => {
    const r = parseCheckSteps({ notes: [{ step: 2, note: "Too big" }, { step: 9, note: "Odd" }, { step: 1, note: "" }], why: "w" }, 3);
    expect(r?.notes).toEqual([
      { step: 2, note: "Too big" },
      { step: 0, note: "Odd" },
    ]);
    expect(parseResult("checkSteps", { notes: [{ step: 3, note: "x" }] }, ["1", "2", "3"])?.notes[0].step).toBe(3);
  });

  it("review needs two or three questions", () => {
    expect(parseReview({ questions: ["Only one?"] })).toBeNull();
    expect(parseReview({ questions: ["a?", "b?", "c?", "d?"], why: "w" })?.questions).toEqual(["a?", "b?", "c?"]);
  });

  it("research keeps only real search links, splits off the reasoning, and never summarizes at teen stage", () => {
    const sources = [
      { title: "who.int", url: "https://www.who.int/page" },
      { title: "", url: "https://example.org/a" },
      { title: "bad", url: "javascript:alert(1)" },
      { title: "dupe", url: "https://www.who.int/page" },
    ];
    const text = "## Answer\n**Sleep** helps memory.\n- Most adults need 7 hours.\n**Why:** Health agencies first.";
    const child = parseResearch(text, sources, "child", "<div>chips</div>");
    expect(child).toEqual({
      summary: "Sleep helps memory.\nMost adults need 7 hours.",
      sources: [
        { title: "who.int", url: "https://www.who.int/page" },
        { title: "example.org", url: "https://example.org/a" },
      ],
      why: "Health agencies first.",
      provider: "google",
      searchWidget: "<div>chips</div>",
    });
    const teen = parseResearch(text, sources, "teen");
    expect(teen?.summary).toBeUndefined();
    expect(teen?.guide).toContain("Sleep helps memory.");
    expect(parseResearch(text, [], "child")).toBeNull();
  });

  it("the Wikipedia fallback: the model works only from the articles, which are the sources", () => {
    const call = { kind: "research", context: ctx("teen"), payload: { question: "Why sleep?", task: { title: "Essay", mode: "daily-life" } } } as AiCall<"research">;
    const prompt = buildArticlePrompt(call, [{ title: "Sleep", extract: "Sleep is a state of rest." }]);
    expect(prompt.user).toContain("Use only the Wikipedia article extracts below");
    expect(prompt.user).toContain("Do not answer the question");
    expect(prompt.user).toContain("Sleep is a state of rest.");
    const articles = [{ title: "Sleep", url: "https://en.wikipedia.org/wiki/Sleep" }];
    expect(parseArticleAnswer({ text: "Look at the causes section.", why: "It defines sleep." }, articles, "teen")).toEqual({
      guide: "Look at the causes section.",
      sources: articles,
      why: "It defines sleep.",
      provider: "wikipedia",
    });
    expect(parseArticleAnswer({ text: "Rest helps.", why: "" }, articles, "child")?.summary).toBe("Rest helps.");
    expect(parseArticleAnswer({ text: "x" }, [], "child")).toBeNull();
  });

  it("prompts: teen research asks for no answer; step checks forbid rewriting", () => {
    const research = (stage: "child" | "teen") =>
      buildPrompt({ kind: "research", context: ctx(stage), payload: { question: "Why sleep?", task: { title: "Essay", mode: "daily-life" } } } as AiCall<"research">);
    expect(research("teen").user).toContain("Do not answer the question");
    expect(research("child").user).toContain("short summary");
    const check = buildPrompt({ kind: "checkSteps", context: ctx("teen"), payload: { task: aiTask, steps: ["a", "b"] } } as AiCall<"checkSteps">);
    expect(check.user).toContain("do not rewrite it");
    expect(check.user).toContain('"1. a"');
  });

  it("demo answers pass their own validators and never invent pages", () => {
    const research = mockResult({ kind: "research", context: ctx("teen"), payload: { question: "a b", task: { title: "x", mode: "chores" } } } as AiCall<"research">);
    expect(research.summary).toBeUndefined();
    expect(research.sources.every((x) => /^https:\/\/(en\.wikipedia\.org\/w\/index\.php\?search=|scholar\.google\.com\/scholar\?q=)a%20b$/.test(x.url))).toBe(true);
    expect(parseBreakdown(mockResult({ kind: "breakdown", context: ctx(), payload: { task: aiTask } } as AiCall<"breakdown">))).not.toBeNull();
    expect(parseCheckSteps(mockResult({ kind: "checkSteps", context: ctx("teen"), payload: { task: aiTask, steps: ["a", "bb", "c"] } } as AiCall<"checkSteps">), 3)?.notes[0].step).toBe(2);
    expect(parseReview(mockResult({ kind: "review", context: ctx(), payload: { task: { ...aiTask, estimateMinutes: 60, actualMinutes: 90, stepsDone: 0, stepsTotal: 0, onTime: null } } } as AiCall<"review">))?.questions).toHaveLength(3);
  });

  it("the B8 log reads the user's own work", () => {
    const e = { type: "own_work", at: at(0).toISOString(), stage: "teen", taskId: "t", kind: "summary" } as MiosEvent;
    expect(describeEvent(e, new Map([["t", makeTask({ id: "t", title: "Trip" })]]))).toBe('10:00 wrote their own research summary for "Trip" without AI writing it');
  });
});
