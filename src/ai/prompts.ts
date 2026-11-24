/**
 * Prompt and JSON-schema builders, one per AI kind. Pure functions, so they
 * can be tested and reviewed without calling a model.
 */
import { AI_FEATURES, type AiCall, type AiKind, type AiRequestMap } from "./types";

export interface BuiltPrompt {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

const BASE_RULES = [
  "You are the assistant inside MiOS, an app that trains people to plan and prioritize on their own.",
  "Never decide for the user. Suggest, explain briefly, and leave the choice to them.",
  "Write short plain sentences. No emoji. No em dashes.",
  "Facts over flattery: only praise something the data shows.",
  "No medical advice.",
  "Name app features in plain words. Never write internal codes or IDs such as B4.",
  "Reply with only one JSON object that matches the schema.",
].join("\n");

const stageRule = (stage: AiCall["context"]["stage"]) =>
  stage === "teen"
    ? "The user is at teen stage, learning to work without AI. Lean toward questions: end every `why` with one short question that makes them check your reasoning."
    : "The user is at child stage. Help actively, and explain your reasoning so they can learn from it.";

const contextBlock = (call: AiCall) =>
  [
    `Now: ${call.context.now} (time zone ${call.context.timeZone}).`,
    call.context.notes.length ? `What MiOS has learned about this user:\n- ${call.context.notes.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

const json = (v: unknown) => JSON.stringify(v);

const S = {
  str: { type: "string" },
  num: { type: "number" },
  obj: (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
    type: "object",
    properties,
    required,
  }),
  arr: (items: unknown) => ({ type: "array", items }),
  enum: (values: string[]) => ({ type: "string", enum: values }),
};

type Builder<K extends AiKind> = (payload: AiRequestMap[K], call: AiCall<K>) => Omit<BuiltPrompt, "system">;

const builders: { [K in AiKind]: Builder<K> } = {
  priority: (p) => ({
    user: `Suggest the order to do these Ready tasks in. Weigh deadlines, priority (1 is highest), and time needed. Use the task ids exactly.\nTasks: ${json(p.tasks)}`,
    schema: S.obj({
      order: S.arr(S.str),
      reasons: S.arr(S.obj({ taskId: S.str, why: S.str })),
      why: S.str,
    }),
  }),
  schedule: (p) => ({
    user: `Draft today's schedule as start times (24-hour local "HH:MM") for these tasks, starting after now. Never place a task inside protected time. Leave short gaps. Skip a task rather than squeeze it in. Unknown durations take ${p.defaultEstimateMinutes} minutes.\nProtected time: ${json(p.protectedBlocks)}\nTasks: ${json(p.tasks)}`,
    schema: S.obj({ slots: S.arr(S.obj({ taskId: S.str, start: S.str })), why: S.str }),
  }),
  interrupt: (p) => ({
    user: `The user is deciding whether to handle an interrupt first. Warn them if it hurts a deadline. Do not tell them what to pick.\nInterrupt: ${json(p.interrupt)} (about ${p.interruptMinutes} minutes)\nWhat it would push back: ${json(p.pushedBack)}`,
    schema: S.obj({ severity: S.enum(["none", "low", "high"]), warning: S.str, why: S.str }),
  }),
  estimate: (p) => ({
    user: `Estimate how long this task will take in minutes and how much effort it needs. Use the user's past guesses versus actual times to correct for their habits.\nTask: ${json(p.task)}\nPast tasks: ${json(p.history)}`,
    schema: S.obj({ minutes: S.num, effort: S.enum(["low", "medium", "high"]), why: S.str }),
  }),
  analyze: (p) => ({
    user: `Review the user's recent activity in MiOS. Write a short summary and up to 5 notes about their habits (for example: tends to underestimate chores, often reorders after interrupts). Notes help MiOS give better help later. Be specific and neutral. Build on the previous summary.\nWhat just happened: ${json(p.triggers)}\nRecent activity: ${json(p.recentEvents)}\nOpen tasks: ${json(p.tasks)}\nPrevious summary: ${p.previousSummary || "none"}${p.habits?.length ? `\nHabits (neutral observations, not judgments; never guess what a medicine is): ${json(p.habits)}` : ""}`,
    schema: S.obj({ summary: S.str, notes: S.arr(S.str) }),
  }),
  research: (p, call) => ({
    user: [
      `The user is working on the task "${p.task.title}" and wants to research: ${json(p.question)}`,
      "Search the web for good, reliable sources on it.",
      call.context.stage === "teen"
        ? "Do not answer the question or summarize the sources: the user will read them and write the summary. In 2 to 4 short lines, say what to look for in the sources and how to judge them."
        : "Write a short summary of what the sources say, in 3 to 6 plain sentences. Say where sources disagree.",
      "Plain text only: no headings, no bullet symbols, no links.",
      'End with one last line that starts with "Why:" and says how you chose these sources.',
    ].join("\n"),
    schema: {},
  }),
  breakdown: (p) => ({
    user: `Split this task into 3 to 8 concrete steps, in the order to do them. Each step is a short action that starts with a verb and takes under an hour. Steps are a suggestion the user will edit.\nTask: ${json(p.task)}`,
    schema: S.obj({ steps: S.arr(S.str), why: S.str }),
  }),
  checkSteps: (p) => ({
    user: [
      "The user split this task into steps on their own. Check their plan, but do not rewrite it and do not give your own list of steps.",
      "Give up to 4 short notes: a missing step, a step that is too big or vague, or steps in a risky order. Refer to a step by its number (1 is the first), or 0 for the plan as a whole.",
      "If the plan looks fine, give one note with step 0 that says so.",
      `Task: ${json(p.task)}`,
      `Their steps: ${json(p.steps.map((st, i) => `${i + 1}. ${st}`))}`,
    ].join("\n"),
    schema: S.obj({ notes: S.arr(S.obj({ step: S.num, note: S.str })), why: S.str }),
  }),
  review: (p) => ({
    user: [
      "The user just finished a big task. Ask 2 or 3 short reflection questions that help them plan the next one better.",
      "No judgment, no praise, no advice: only questions, each one sentence. Base them on what the data shows (time guess against actual time, the deadline, the steps).",
      `Task: ${json(p.task)}`,
    ].join("\n"),
    schema: S.obj({ questions: S.arr(S.str), why: S.str }),
  }),
  popup: (p) => {
    const f = AI_FEATURES[p.feature];
    return {
      user: [
        `Write ${p.formats.length} quick practice questions, one per format in this order: ${json(p.formats)}.`,
        `They train the skill of ${f.skill}. They appear right before the user gets ${f.label}, to make them think first.`,
        "Each is a short made-up everyday scenario (two or three facts), answerable in 10 to 20 seconds. Never about the user's real tasks.",
        'Example for priority: "You need to do your laundry today, you are very hungry, and you have a class in 30 minutes. What should you do first?"',
        "There is no single right answer. `suggested` is one sensible way to think about it, in one or two sentences.",
        'Formats: "choice" = 3 or 4 `options`; "order" = 3 or 4 `options` to put in order; "number" = asks for a number, set `unit`; "text" = one-line answer.',
        p.avoid.length ? `Do not repeat or closely copy these earlier questions:\n- ${p.avoid.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      schema: S.obj({
        questions: S.arr(
          S.obj(
            {
              format: S.enum(["choice", "text", "order", "number"]),
              prompt: S.str,
              options: S.arr(S.str),
              unit: S.str,
              suggested: S.str,
            },
            ["format", "prompt", "suggested"],
          ),
        ),
      }),
    };
  },
};

/**
 * B5 fallback: the model works only from Wikipedia extracts MiOS fetched
 * itself, so every claim can be traced to a listed article.
 */
export const buildArticlePrompt = (
  call: AiCall<"research">,
  articles: readonly { title: string; extract: string }[],
): BuiltPrompt => {
  const teen = call.context.stage === "teen";
  return {
    system: `${BASE_RULES}\n${stageRule(call.context.stage)}`,
    user: [
      contextBlock(call),
      "",
      `The user is working on the task "${call.payload.task.title}" and wants to research: ${json(call.payload.question)}`,
      "Use only the Wikipedia article extracts below. Do not add facts from elsewhere. If they don't cover the question, say so.",
      teen
        ? "Do not answer the question or summarize the articles: the user will read them and write the summary. In `text`, say in 2 to 4 short sentences what to look for in them and how to judge them."
        : "In `text`, sum up what the articles say about the question in 3 to 6 plain sentences.",
      "In `why`, say in one sentence how these articles relate to the question.",
      `Articles: ${json(articles)}`,
    ].join("\n"),
    schema: S.obj({ text: S.str, why: S.str }),
  };
};

export const buildPrompt = <K extends AiKind>(call: AiCall<K>): BuiltPrompt => {
  const built = (builders[call.kind] as Builder<K>)(call.payload, call);
  const system = call.kind === "popup" ? BASE_RULES : `${BASE_RULES}\n${stageRule(call.context.stage)}`;
  return { system, user: `${contextBlock(call)}\n\n${built.user}`, schema: built.schema };
};
