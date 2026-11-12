import { buildArticlePrompt, buildPrompt } from "@/ai/prompts";
import { mockResult } from "@/ai/mock";
import { GeminiError, generateGrounded, generateJson, geminiConfigured } from "@/ai/server/gemini";
import { searchWikipedia } from "@/ai/server/wikipedia";
import { GUEST_AI } from "@/ai/access";
import { verifyIdToken } from "@/ai/server/identity";
import { takeAiRequest } from "@/ai/server/limits";
import { AI_KINDS, type AiCall, type AiKind, type AiResponse } from "@/ai/types";
import { parseArticleAnswer, parseResearch, parseResult } from "@/ai/validate";

/**
 * POST /api/ai: the single server entry point for every AI feature.
 * The browser never sees the API key. Without a key, demo answers are used.
 */

const MAX_BODY_BYTES = 64_000;

const reply = (body: AiResponse, status = 200) => Response.json(body, { status });
const fail = (error: Extract<AiResponse, { ok: false }>["error"], message: string, status: number) =>
  reply({ ok: false, error, message }, status);

const isCall = (v: unknown): v is AiCall => {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<AiCall>;
  return (
    AI_KINDS.includes(c.kind as AiKind) &&
    typeof c.payload === "object" &&
    c.payload !== null &&
    typeof c.context === "object" &&
    c.context !== null &&
    ["child", "teen", "adult"].includes(c.context.stage) &&
    Array.isArray(c.context.notes)
  );
};

/** Ids the answer may refer to, so the validator can drop invented ones. For step checks: one per step. */
const taskIdsOf = (call: AiCall): string[] => {
  const p = call.payload as { tasks?: { id: string }[]; steps?: unknown[] };
  if (call.kind === "checkSteps") return Array.isArray(p.steps) ? p.steps.map((_, i) => String(i + 1)) : [];
  return Array.isArray(p.tasks) ? p.tasks.map((t) => String(t.id)) : [];
};

/**
 * B5: Google Search first. Free API keys often have no search allowance, and
 * Google then refuses (429 or 400); Wikipedia's free search takes over, and
 * the model works only from the articles it returns.
 */
const research = async (call: AiCall<"research">, system: string, user: string): Promise<AiResponse<"research">> => {
  try {
    const answer = await generateGrounded(system, user);
    const result = parseResearch(answer.text, answer.sources, call.context.stage, answer.searchWidget);
    if (result) return { ok: true, result, mock: false };
  } catch (e) {
    if (!(e instanceof GeminiError) || e.code === "bad_response") throw e;
  }
  const articles = await searchWikipedia(call.payload.question).catch(() => []);
  if (!articles.length) return { ok: false, error: "no_sources", message: "No sources came back for that question." };
  const prompt = buildArticlePrompt(call, articles);
  const raw = await generateJson(prompt.system, prompt.user, prompt.schema);
  const result = parseArticleAnswer(raw, articles.map(({ title, url }) => ({ title, url })), call.context.stage);
  return result ? { ok: true, result, mock: false } : { ok: false, error: "bad_response", message: "The AI answer didn't make sense. Try again." };
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail("bad_request", "Request too large.", 413);

  let call: unknown;
  try {
    call = JSON.parse(raw);
  } catch {
    return fail("bad_request", "Invalid JSON.", 400);
  }
  if (!isCall(call)) return fail("bad_request", "Unknown AI request.", 400);

  // Stage rule, enforced on the server too: adult stage has no AI at all.
  if (call.context.stage === "adult") return fail("bad_request", "AI is off at adult stage.", 403);

  if (!geminiConfigured()) {
    return reply({ ok: true, result: mockResult(call), mock: true, demoReason: "no_key" });
  }

  // Who's asking: a signed-in person (checked token) or a guest.
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const caller = token ? await verifyIdToken(token) : null;
  if (token && !caller) return fail("signed_out", "Your sign-in has expired. Sign in again.", 401);
  if (!caller && GUEST_AI === "demo") {
    return reply({ ok: true, result: mockResult(call), mock: true, demoReason: "guest" });
  }
  const who = caller ? `user:${caller.uid}` : `guest:${request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local"}`;
  if (!takeAiRequest(who)) return fail("daily_limit", "Today's AI requests are used up.", 429);

  try {
    const { system, user, schema } = buildPrompt(call);
    if (call.kind === "research") return reply(await research(call as AiCall<"research">, system, user));
    const rawResult = await generateJson(system, user, schema);
    const result = parseResult(call.kind, rawResult, taskIdsOf(call));
    if (!result) return fail("bad_response", "The AI answer didn't make sense. Try again.", 502);
    return reply({ ok: true, result, mock: false });
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.code, e.message, e.code === "rate_limited" ? 429 : 502);
    return fail("unavailable", "Something went wrong with the AI service.", 502);
  }
}
