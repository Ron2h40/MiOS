/**
 * Demo answers used when no GEMINI_API_KEY is set, so every AI feature can be
 * tried and tested offline. Answers are built from the request with simple
 * rules; the UI labels them as demo answers.
 */
import type { AiCall, AiKind, AiResultMap, PopupFormat, PopupResult } from "./types";

const byDeadline = (a?: string, b?: string) => (a ?? "9999").localeCompare(b ?? "9999");

const POPUP_BANK: Record<string, Record<PopupFormat, Omit<PopupResult["questions"][number], "format">[]>> = {
  priority: {
    choice: [
      { prompt: "You need to do laundry today, you're very hungry, and class starts in 30 minutes. What first?", options: ["Laundry", "Eat something quick", "Head to class early"], suggested: "Eat something quick. Hunger hurts focus in class, and laundry can wait until tonight." },
      { prompt: "A bill is due tonight, a friend texted, and your room is messy. What first?", options: ["Pay the bill", "Reply to the friend", "Clean the room"], suggested: "Pay the bill. It has a hard deadline and a cost if missed." },
    ],
    text: [
      { prompt: "Your phone is at 5%, you leave in 10 minutes, and you still need to pack lunch. What do you do first?", suggested: "Plug in the phone first. It charges while you pack lunch." },
      { prompt: "An essay is due Friday, a quiz is tomorrow, and the gym closes in an hour. What comes first today?", suggested: "Study for tomorrow's quiz. It's the nearest deadline." },
    ],
    order: [
      { prompt: "Put these in the order you'd do them this morning.", options: ["Shower", "Reply to an urgent email", "Make coffee"], suggested: "Start the coffee, answer the urgent email while it brews, then shower." },
      { prompt: "Order these for a free afternoon.", options: ["Return a library book due today", "Start next week's project", "Grocery run"], suggested: "The library book first since it's due today, then groceries, then the project." },
    ],
    number: [
      { prompt: "You have 3 tasks due today and 2 free hours. How many can you fully finish?", unit: "tasks", suggested: "Usually 2. Plan for fewer and finish them well." },
    ],
  },
  schedule: {
    choice: [
      { prompt: "You have a 90-minute essay and a 20-minute call at 4pm. It's 2pm. When do you start the essay?", options: ["2:00", "2:30", "After the call"], suggested: "2:00. It finishes at 3:30 with a buffer before the call." },
    ],
    text: [
      { prompt: "Gym is 6 to 7pm, dinner takes 40 minutes, and you want 2 hours of study before 11pm. How do you lay out the evening?", suggested: "Dinner at 7:15, study 8 to 10, with a break in the middle." },
    ],
    order: [
      { prompt: "You have one morning. Order these blocks.", options: ["Deep work, 2 hours", "Errands, 45 minutes", "Email, 20 minutes"], suggested: "Deep work first while your energy is high, then email, then errands." },
    ],
    number: [
      { prompt: "Class ends at 3:00 and you need 25 minutes to get home. What's the earliest a home task can start?", unit: "minutes after 3:00", suggested: "About 30 minutes after, giving a small buffer." },
    ],
  },
  interrupt: {
    choice: [
      { prompt: "A friend asks for help moving right now, and your report is due tonight. What do you do?", options: ["Help now", "Offer help after the report", "Say no"], suggested: "Offer help after the report. The deadline is fixed, the move can shift." },
    ],
    text: [
      { prompt: "Your manager asks for a quick 10-minute fix while you're halfway through studying. What gets pushed?", suggested: "Studying slips 10 minutes. Fine if nothing is due soon." },
    ],
    order: [
      { prompt: "Three interruptions arrive at once. Order them.", options: ["Delivery at the door", "Group chat message", "Call from your doctor"], suggested: "The doctor's call, then the door, then the chat." },
    ],
    number: [
      { prompt: "An interrupt takes 30 minutes and you have 4 tasks queued. How many minutes later does the last one finish?", unit: "minutes", suggested: "30 minutes. Every queued task shifts by the interrupt's length." },
    ],
  },
  estimate: {
    choice: [
      { prompt: "How long does cleaning a small bedroom usually take?", options: ["10 minutes", "30 minutes", "90 minutes"], suggested: "About 30 minutes, more if it hasn't been done in a while." },
    ],
    text: [
      { prompt: "You need to write a one-page cover letter. How long will it take, and why?", suggested: "About an hour: drafting, tailoring to the role, and a final read." },
    ],
    order: [
      { prompt: "Order these from shortest to longest.", options: ["Doing the dishes", "Writing a 2-page report", "Replying to 5 emails"], suggested: "Dishes, emails, then the report." },
    ],
    number: [
      { prompt: "How many minutes does a weekly grocery run take you, door to door?", unit: "minutes", suggested: "Most people say 30 and take 60. Count travel and checkout." },
    ],
  },
};

export const mockResult = <K extends AiKind>(call: AiCall<K>): AiResultMap[K] => {
  const c = call as AiCall;
  switch (c.kind) {
    case "priority": {
      const tasks = [...(call as AiCall<"priority">).payload.tasks].sort(
        (a, b) => a.priority - b.priority || byDeadline(a.deadline, b.deadline),
      );
      return {
        order: tasks.map((t) => t.id),
        reasons: tasks.map((t) => ({
          taskId: t.id,
          why: t.deadline ? `Priority ${t.priority}, due ${t.deadline.slice(0, 10)}.` : `Priority ${t.priority}, no deadline.`,
        })),
        why: "Highest priority first, then the earliest deadline. Does that match what matters most to you today?",
      } as AiResultMap[K];
    }
    case "schedule": {
      const p = (call as AiCall<"schedule">).payload;
      const start = new Date(call.context.now);
      start.setMinutes(Math.ceil((start.getMinutes() + 15) / 15) * 15, 0, 0);
      const slots = p.tasks.map((t) => {
        const hhmm = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
        start.setMinutes(start.getMinutes() + (t.estimateMinutes ?? p.defaultEstimateMinutes) + 10);
        return { taskId: t.id, start: hhmm };
      });
      return { slots, why: "Back to back from the next quarter hour with 10-minute gaps." } as AiResultMap[K];
    }
    case "interrupt": {
      const p = (call as AiCall<"interrupt">).payload;
      const late = p.pushedBack.filter((x) => x.newlyLate);
      return (
        late.length
          ? { severity: "high", warning: `Running it first makes ${late.map((x) => x.title).join(", ")} miss a deadline.`, why: "Its time pushes everything after it back." }
          : { severity: p.pushedBack.length ? "low" : "none", warning: p.pushedBack.length ? `Everything shifts about ${p.interruptMinutes} minutes, but no deadline slips.` : "Nothing is waiting, so nothing gets pushed back.", why: "No queued deadline falls inside the delay." }
      ) as AiResultMap[K];
    }
    case "estimate": {
      const p = (call as AiCall<"estimate">).payload;
      const ratio = p.history.length ? p.history.reduce((s, h) => s + h.actual / h.estimate, 0) / p.history.length : 1;
      const base = p.task.estimateMinutes ?? 30;
      const minutes = Math.max(5, Math.round((base * ratio) / 5) * 5);
      return {
        minutes,
        effort: minutes > 90 ? "high" : minutes > 30 ? "medium" : "low",
        why: p.history.length ? `Your past tasks ran ${ratio.toFixed(1)}x your guesses, so this adjusts for that.` : "No past tasks to compare yet, so this is a rough guess.",
      } as AiResultMap[K];
    }
    case "analyze": {
      const p = (call as AiCall<"analyze">).payload;
      return {
        summary: `Reviewed ${p.recentEvents.length} recent actions and ${p.tasks.length} open tasks.`,
        notes: [`Most recent: ${p.triggers.slice(-2).join(", ") || "no activity"}.`],
      } as AiResultMap[K];
    }
    case "popup": {
      const p = (call as AiCall<"popup">).payload;
      const avoid = new Set(p.avoid);
      const used = new Set<string>();
      const questions = p.formats.flatMap((format) => {
        const pool = POPUP_BANK[p.feature]?.[format] ?? [];
        const q = pool.find((x) => !avoid.has(x.prompt) && !used.has(x.prompt)) ?? pool.find((x) => !used.has(x.prompt));
        if (!q) return [];
        used.add(q.prompt);
        return [{ format, ...q }];
      });
      return { questions } as AiResultMap[K];
    }
    default:
      throw new Error("Unknown AI kind");
  }
};
