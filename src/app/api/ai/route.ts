import { buildPrompt } from "@/ai/prompts";
import { mockResult } from "@/ai/mock";
import { GeminiError, generateJson, geminiConfigured } from "@/ai/server/gemini";
import { AI_KINDS, type AiCall, type AiKind, type AiResponse } from "@/ai/types";
import { parseResult } from "@/ai/validate";

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

/** Ids the answer may refer to, so the validator can drop invented ones. */
const taskIdsOf = (call: AiCall): string[] => {
  const p = call.payload as { tasks?: { id: string }[] };
  return Array.isArray(p.tasks) ? p.tasks.map((t) => String(t.id)) : [];
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
    return reply({ ok: true, result: mockResult(call), mock: true });
  }

  try {
    const { system, user, schema } = buildPrompt(call);
    const rawResult = await generateJson(system, user, schema);
    const result = parseResult(call.kind, rawResult, taskIdsOf(call));
    if (!result) return fail("bad_response", "The AI answer didn't make sense. Try again.", 502);
    return reply({ ok: true, result, mock: false });
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.code, e.message, e.code === "rate_limited" ? 429 : 502);
    return fail("unavailable", "Something went wrong with the AI service.", 502);
  }
}
