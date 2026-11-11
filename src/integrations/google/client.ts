import type { GEvent } from "./mapping";

/**
 * E2: talking to Google from the browser. Sign-in uses Google Identity
 * Services' token model: no server, no client secret, no refresh token. The
 * access token lives in memory only and is never saved.
 */

export const GOOGLE_SCOPES = [
  // Read the user's own calendar.
  "https://www.googleapis.com/auth/calendar.events.readonly",
  // Create the separate MiOS calendar and manage events on it, and nothing else.
  "https://www.googleapis.com/auth/calendar.app.created",
].join(" ");

const API = "https://www.googleapis.com/calendar/v3";
const GIS_SRC = "https://accounts.google.com/gsi/client";

export const googleClientId = (): string | undefined => process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || undefined;

// ---------------------------------------------------------------------------
// Sign-in (token model)
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let gisLoading: Promise<GoogleOAuth2> | null = null;

const loadGis = (): Promise<GoogleOAuth2> => {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  gisLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error("Google sign-in didn't load.")));
    script.onerror = () => {
      gisLoading = null;
      reject(new Error("Couldn't reach Google sign-in. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
};

/** Load the sign-in library early, so the Connect click can open the popup right away. */
export const preloadGoogle = () => {
  void loadGis().catch(() => {});
};

let token: { value: string; expiresAt: number } | null = null;

export const hasValidToken = () => !!token && token.expiresAt > Date.now() + 60_000;

export class GoogleAuthError extends Error {}

/**
 * Ask Google for an access token. Call from a click: Google shows a popup.
 * Once the user has agreed, later calls close the popup by themselves.
 */
export const requestToken = async (clientId: string, prompt: "" | "consent" = ""): Promise<void> => {
  const oauth2 = await loadGis();
  await new Promise<void>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new GoogleAuthError(r.error_description || r.error || "Google sign-in failed."));
        const scopes = GOOGLE_SCOPES.split(" ");
        if (!oauth2.hasGrantedAllScopes(r, scopes[0], ...scopes.slice(1))) {
          return reject(new GoogleAuthError("MiOS needs both calendar permissions to sync. Please tick both boxes."));
        }
        token = { value: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
        resolve();
      },
      error_callback: (e) =>
        reject(new GoogleAuthError(e.type === "popup_closed" ? "The Google window was closed." : e.type === "popup_failed_to_open" ? "Your browser blocked the Google window. Allow pop-ups for this site." : e.message || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt });
  });
};

/** Forget the token and tell Google to revoke MiOS's access. */
export const revokeGoogle = async (): Promise<void> => {
  const t = token?.value;
  token = null;
  if (!t) return;
  const oauth2 = await loadGis().catch(() => null);
  await new Promise<void>((resolve) => (oauth2 ? oauth2.revoke(t, resolve) : resolve()));
};

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const call = async <T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> => {
  if (!hasValidToken()) throw new GoogleAuthError("Google sign-in expired.");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token!.value}`, "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 401) {
    token = null;
    throw new GoogleAuthError("Google sign-in expired.");
  }
  // Rate limits: back off and retry a few times (Google's advice).
  if ((res.status === 429 || res.status === 403) && attempt < 3) {
    const body = await res.clone().json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    if (res.status === 429 || /rateLimit|usageLimit/i.test(reason)) {
      await sleep(2 ** attempt * 1000 + Math.random() * 500);
      return call<T>(path, init, attempt + 1);
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new GoogleApiError(res.status, body?.error?.message ?? `Google Calendar error ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
};

const enc = encodeURIComponent;

export const createCalendar = (summary: string, timeZone: string) =>
  call<{ id: string }>("/calendars", {
    method: "POST",
    body: JSON.stringify({ summary, description: "Tasks planned in MiOS. MiOS keeps this calendar up to date.", timeZone }),
  });

export const getCalendar = (id: string) => call<{ id: string }>(`/calendars/${enc(id)}`);

export interface ListResult {
  items: GEvent[];
  nextSyncToken?: string;
}

/**
 * Every event page by page. Pass a sync token for "what changed since last
 * time", or timeMin for a first full read. Google answers 410 when a sync
 * token is too old; the caller then starts over with a full read.
 */
export const listEvents = async (calendarId: string, opts: { syncToken?: string; timeMin?: string }): Promise<ListResult> => {
  const items: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const q = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
    if (opts.syncToken) q.set("syncToken", opts.syncToken);
    else if (opts.timeMin) q.set("timeMin", opts.timeMin);
    if (pageToken) q.set("pageToken", pageToken);
    const page = await call<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
      `/calendars/${enc(calendarId)}/events?${q}`,
    );
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
};

export const insertEvent = (calendarId: string, body: object & { id: string }) =>
  call<GEvent>(`/calendars/${enc(calendarId)}/events`, { method: "POST", body: JSON.stringify(body) });

/** Full replace; also brings back an event the user deleted (status "confirmed"). */
export const updateEvent = (calendarId: string, id: string, body: object) =>
  call<GEvent>(`/calendars/${enc(calendarId)}/events/${enc(id)}`, {
    method: "PUT",
    body: JSON.stringify({ ...body, status: "confirmed" }),
  });

export const deleteEvent = (calendarId: string, id: string) =>
  call<void>(`/calendars/${enc(calendarId)}/events/${enc(id)}`, { method: "DELETE" });
