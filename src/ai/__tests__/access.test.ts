import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { takeAiRequest, resetAiLimits } = await import("../server/limits");
const { verifyIdToken } = await import("../server/identity");
const { AI_DAILY_LIMIT, aiAccessNotice } = await import("../access");

describe("daily AI allowance", () => {
  beforeEach(() => resetAiLimits());

  it("allows the limit, then refuses, per person", () => {
    for (let i = 0; i < AI_DAILY_LIMIT; i++) expect(takeAiRequest("user:a")).toBe(true);
    expect(takeAiRequest("user:a")).toBe(false);
    expect(takeAiRequest("user:b")).toBe(true);
  });

  it("starts over the next day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    expect(takeAiRequest("guest:x", 1)).toBe(true);
    expect(takeAiRequest("guest:x", 1)).toBe(false);
    vi.setSystemTime(new Date("2026-11-12T00:00:01Z"));
    expect(takeAiRequest("guest:x", 1)).toBe(true);
    vi.useRealTimers();
  });
});

describe("sign-in tokens", () => {
  it("anything that isn't a valid Google-signed token for this project is refused", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
    expect(await verifyIdToken("")).toBeNull();
    expect(await verifyIdToken("not.a.token")).toBeNull();
    // A token signed with "none" (no signature) must never pass.
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "x", aud: "test-project", iss: "https://securetoken.google.com/test-project" })}.`;
    expect(await verifyIdToken(forged)).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("what users are told", () => {
  it("signed-in people hear about their allowance; guests hear what guests get", () => {
    expect(aiAccessNotice(true)).toContain(`${AI_DAILY_LIMIT} requests a day`);
    expect(aiAccessNotice(false)).toMatch(/guest/i);
  });
});
