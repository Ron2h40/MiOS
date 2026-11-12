import "server-only";

/**
 * B5 fallback when Google Search isn't available on the API key: Wikipedia's
 * own search, which is free and needs no key. Only article titles, links and
 * short intro extracts come back; the model then works from those alone.
 */

export interface Article {
  title: string;
  url: string;
  extract: string;
}

const API = "https://en.wikipedia.org/w/api.php";
const MAX_ARTICLES = 4;
const MAX_EXTRACT = 1200;

export const searchWikipedia = async (query: string): Promise<Article[]> => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: query.slice(0, 250),
    gsrlimit: String(MAX_ARTICLES),
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    exlimit: String(MAX_ARTICLES),
    inprop: "url",
  });
  const res = await fetch(`${API}?${params}`, {
    // Wikimedia asks API clients to name themselves.
    headers: { "User-Agent": "MiOS/1.0 (personal planning app)" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as {
    query?: { pages?: { title?: string; fullurl?: string; extract?: string; index?: number }[] };
  } | null;
  return (data?.query?.pages ?? [])
    .filter((p) => p.title && p.fullurl?.startsWith("https://") && p.extract?.trim())
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ title: p.title!, url: p.fullurl!, extract: p.extract!.trim().slice(0, MAX_EXTRACT) }));
};
