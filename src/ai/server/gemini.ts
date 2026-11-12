import "server-only";

/**
 * Minimal Gemini client over the REST generateContent endpoint.
 * Runs only on the server, so the API key never reaches the browser.
 *
 * Checked 2026-11-05 against Google's docs: gemini-3.1-flash-lite is the
 * cheapest stable model with a free tier. Free-tier prompts may be used by
 * Google to improve its products (see /privacy). Override with GEMINI_MODEL.
 */

export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 20_000;

export class GeminiError extends Error {
  constructor(
    readonly code: "rate_limited" | "unavailable" | "bad_response",
    message: string,
  ) {
    super(message);
  }
}

export const geminiConfigured = (): boolean => Boolean(process.env.GEMINI_API_KEY);

const request = async (body: unknown): Promise<Response> => {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  return fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
};

export interface GroundedAnswer {
  text: string;
  sources: { title: string; url: string }[];
  /** Google's search suggestions (HTML). Google requires showing them with grounded answers. */
  searchWidget?: string;
}

/** Grounding links go through a Google redirect that doesn't last; keep the page they point to. */
const resolveSource = async (url: string): Promise<string> => {
  if (!/^https:\/\/vertexaisearch\.cloud\.google\.com\//.test(url)) return url;
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(4000), cache: "no-store" });
    const to = res.headers.get("location");
    return to && /^https?:\/\//i.test(to) ? to : url;
  } catch {
    return url;
  }
};

/**
 * B5: answer with Google Search grounding. The sources are the search
 * results Google reports, never links the model writes. Plain text out:
 * not every model accepts a JSON schema together with search.
 */
export const generateGrounded = async (system: string, user: string): Promise<GroundedAnswer> => {
  let res: Response;
  try {
    res = await request({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      tools: [{ google_search: {} }],
    });
  } catch {
    throw new GeminiError("unavailable", "Couldn't reach the AI service.");
  }
  if (res.status === 429) throw new GeminiError("rate_limited", "The free search limit is used up for now.");
  if (!res.ok) throw new GeminiError("unavailable", `The AI service answered ${res.status}.`);

  const data = (await res.json().catch(() => null)) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
        searchEntryPoint?: { renderedContent?: string };
      };
    }[];
  } | null;
  const c = data?.candidates?.[0];
  const text = c?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const chunks = (c?.groundingMetadata?.groundingChunks ?? []).flatMap((g) =>
    g.web?.uri ? [{ title: g.web.title ?? "", url: g.web.uri }] : [],
  );
  const sources = await Promise.all(chunks.slice(0, 8).map(async (src) => ({ ...src, url: await resolveSource(src.url) })));
  const widget = c?.groundingMetadata?.searchEntryPoint?.renderedContent;
  return { text, sources, ...(widget ? { searchWidget: widget } : {}) };
};

/** Ask the model for JSON. Returns the parsed object (still unvalidated). */
export const generateJson = async (system: string, user: string, schema: Record<string, unknown>): Promise<unknown> => {
  const base = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
  };

  let res: Response;
  try {
    res = await request({ ...base, generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema } });
    // If this model rejects the schema field, retry once with JSON mode only;
    // the prompt still describes the shape and the app validates the result.
    if (res.status === 400) res = await request({ ...base, generationConfig: { responseMimeType: "application/json" } });
  } catch {
    throw new GeminiError("unavailable", "Couldn't reach the AI service.");
  }

  if (res.status === 429) throw new GeminiError("rate_limited", "The free AI limit is used up for now.");
  if (!res.ok) throw new GeminiError("unavailable", `The AI service answered ${res.status}.`);

  const data = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    // Tolerate a ```json fence around the object.
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new GeminiError("bad_response", "The AI answer came back in the wrong shape.");
  }
};
