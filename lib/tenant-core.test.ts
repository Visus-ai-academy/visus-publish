import { describe, expect, it } from "vitest";
import { pickDefaultTenant, slugify, tenantSlugSchema } from "./tenant-core";

const a = { id: "1", slug: "clinica-a", name: "Clínica A", plan: "Profissional" };
const b = { id: "2", slug: "bela-pele", name: "Bela Pele", plan: "Essencial" };

describe("pickDefaultTenant", () => {
  it("usa o cookie quando ainda tem acesso", () => {
    expect(pickDefaultTenant([a, b], "clinica-a")).toBe(a);
  });
  it("ignora cookie de cliente sem acesso e cai no primeiro por nome", () => {
    expect(pickDefaultTenant([a, b], "outro")).toBe(b);
  });
  it("sem clientes devolve null", () => {
    expect(pickDefaultTenant([], "clinica-a")).toBeNull();
  });
});

describe("slugify", () => {
  it("gera slug válido a partir do nome", () => {
    const s = slugify("Clínica São João & Cia");
    expect(s).toBe("clinica-sao-joao-cia");
    expect(tenantSlugSchema.safeParse(s).success).toBe(true);
  });
});
