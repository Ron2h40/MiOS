import { beforeEach, describe, expect, it } from "vitest";
import { checkBeforeSignOut, useAccount } from "../account";
import { useMios } from "../store";

const st = () => useMios.getState();
const account = (verified: boolean) => ({ uid: "u1", email: "a@b.c", name: null, verified, provider: "password" as const });

beforeEach(() => {
  st().reset();
  useAccount.setState({ status: "guest", account: null, phase: "off", message: undefined });
});

describe("before signing out", () => {
  it("nothing to lose when signed out already", async () => {
    expect(await checkBeforeSignOut()).toEqual({ kind: "safe" });
  });

  it("an unverified email account never synced: signing out would delete its data, so it warns", async () => {
    st().addTask({ title: "Essay", mode: "daily-life", priority: 3 });
    st().addTask({ title: "Laundry", mode: "chores", priority: 3 });
    useAccount.setState({ status: "signed-in", account: account(false) });
    expect(await checkBeforeSignOut()).toEqual({ kind: "unverified", tasks: 2 });
  });

  it("an unverified account with an empty browser has nothing to lose", async () => {
    useAccount.setState({ status: "signed-in", account: account(false) });
    expect(await checkBeforeSignOut()).toEqual({ kind: "safe" });
  });

  it("a verified account whose sync never started here: everything unsynced counts, with the reason", async () => {
    st().addTask({ title: "Essay", mode: "daily-life", priority: 3 });
    useAccount.setState({ status: "signed-in", account: account(true), phase: "error", message: "No connection." });
    const risk = await checkBeforeSignOut();
    expect(risk.kind).toBe("unsaved");
    expect(risk.kind === "unsaved" && risk.items).toBeGreaterThan(0);
    expect(risk.kind === "unsaved" && risk.reason).toBe("No connection.");
  });
});
