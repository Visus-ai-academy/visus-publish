import { describe, expect, it } from "vitest";
import { POST_STATUSES, STATUS_LABELS, TRANSITIONS, canTransition } from "./transitions";

describe("máquina de estados do post", () => {
  it("pessoa não publica nem marca como gerado", () => {
    expect(canTransition("scheduled", "publishing", "user")).toBe(false);
    expect(canTransition("generating", "pending_approval", "user")).toBe(false);
    expect(canTransition("planned", "published", "user")).toBe(false);
  });

  it("aprovação e cancelamento são de pessoa", () => {
    expect(canTransition("pending_approval", "scheduled", "user")).toBe(true);
    expect(canTransition("pending_approval", "rejected", "user")).toBe(true);
    expect(canTransition("scheduled", "planned", "user")).toBe(true);
  });

  it("publicado é final", () => {
    expect(Object.keys(TRANSITIONS.published)).toEqual([]);
  });

  it("todo status tem rótulo em português", () => {
    for (const s of POST_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
  });
});
