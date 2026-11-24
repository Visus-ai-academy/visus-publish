import { describe, expect, it } from "vitest";
import { monthRange, shiftMonth, utcToZoned, zonedToUtc } from "./time";

describe("fuso do cliente", () => {
  it("converte horário de São Paulo (UTC−3) para UTC", () => {
    expect(zonedToUtc("2026-12-03", "18:30", "America/Sao_Paulo").toISOString()).toBe("2026-12-03T21:30:00.000Z");
  });
  it("respeita horário de verão em outro fuso", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "Europe/Lisbon").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtc("2026-01-01", "09:00", "Europe/Lisbon").toISOString()).toBe("2026-01-01T09:00:00.000Z");
  });
  it("volta de UTC para o fuso", () => {
    expect(utcToZoned(new Date("2026-12-04T01:15:00Z"), "America/Sao_Paulo")).toEqual({ date: "2026-12-03", time: "22:15" });
  });
  it("mês no fuso e navegação", () => {
    const r = monthRange("2026-12", "America/Sao_Paulo");
    expect(r.start.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(r.end.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
