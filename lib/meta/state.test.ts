import { describe, expect, it } from "vitest";
import { createState, verifyState } from "./state";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const SECRET = "segredo-de-teste-com-tamanho-ok";

describe("state do OAuth", () => {
  it("aceita state válido com o nonce do cookie", () => {
    const { state, nonce } = createState(T, U, SECRET);
    expect(verifyState(state, nonce, SECRET)).toMatchObject({ tenantId: T, userId: U });
  });

  it("recusa assinatura adulterada, outro cookie, outro segredo e expirado", () => {
    const { state, nonce } = createState(T, U, SECRET);
    const [body, mac] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), t: U })).toString("base64url");
    expect(verifyState(`${forged}.${mac}`, nonce, SECRET)).toBeNull();
    expect(verifyState(state, "outro-nonce-qualquer-aqui", SECRET)).toBeNull();
    expect(verifyState(state, undefined, SECRET)).toBeNull();
    expect(verifyState(state, nonce, "outro-segredo-qualquer-aqui")).toBeNull();
    expect(verifyState(state, nonce, SECRET, Date.now() + 11 * 60_000)).toBeNull();
  });
});
