import { describe, expect, it } from "vitest";
import { hashInviteToken, newInviteToken } from "./token";

describe("token de convite", () => {
  it("gera token único com hash sha256 hex", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(a.token)).toBe(a.hash);
  });
});
