/**
 * Who gets real AI. Shared by the server route and the app, so what users
 * are told always matches what the server does.
 *
 * NEXT_PUBLIC_GUEST_AI decides what guests (no account) get:
 *  - "real" (default for now): Gemini, so people can try MiOS without signing up
 *  - "demo": MiOS's built-in demo answers; real AI needs an account
 */
export type GuestAi = "real" | "demo";

export const GUEST_AI: GuestAi = process.env.NEXT_PUBLIC_GUEST_AI === "demo" ? "demo" : "real";

/** Real AI requests per person per day (the background review counts too). */
export const AI_DAILY_LIMIT = 100;

/** What each kind of user is told about AI. */
export const aiAccessNotice = (signedIn: boolean): string =>
  signedIn
    ? `Your account includes real AI, up to ${AI_DAILY_LIMIT} requests a day.`
    : GUEST_AI === "real"
      ? "As a guest you're using real AI for now. Later, guests will get demo answers, and real AI will need a free account."
      : "As a guest you get demo AI answers. Sign in for real AI.";
