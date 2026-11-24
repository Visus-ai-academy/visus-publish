import { describe, expect, it } from "vitest";
import { can } from "./permissions";

describe("matriz de permissões", () => {
  it("segue a SPEC §3", () => {
    expect(can("viewer", "view")).toBe(true);
    expect(can("viewer", "edit_content")).toBe(false);
    expect(can("editor", "edit_content")).toBe(true);
    expect(can("editor", "approve")).toBe(false);
    expect(can("approver", "approve")).toBe(true);
    expect(can("approver", "publish")).toBe(false);
    expect(can("editor", "publish")).toBe(true);
    expect(can("editor", "manage_tenant")).toBe(false);
    expect(can("admin", "manage_tenant")).toBe(true);
  });

  it("sem papel não pode nada", () => {
    expect(can(null, "view")).toBe(false);
    expect(can(undefined, "view")).toBe(false);
  });
});
