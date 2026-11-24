import { describe, expect, it } from "vitest";
import { partialSyncMessage } from "../account";

describe("partial sync message", () => {
  it("joins two kinds of data with 'and'", () => {
    expect(partialSyncMessage(["meds", "medLogs"])).toBe(
      "Your daily medicines and medicine logs can't sync: the server's rules don't allow them yet. They're kept in this browser; everything else syncs.",
    );
  });

  it("lists three with commas and 'and'", () => {
    expect(partialSyncMessage(["meds", "medLogs", "wraps"])).toContain("Your daily medicines, medicine logs and stats cards can't sync");
  });

  it("says 'it' for a single thing", () => {
    expect(partialSyncMessage(["events"])).toContain("Your activity can't sync: the server's rules don't allow it yet.");
  });
});
