import { describe, expect, it } from "vitest";
import { checkKey } from "../keys";
import { higgsfieldProvider } from "./higgsfield";
import { veoProvider } from "./veo";

const reply = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;

describe("Veo", () => {
  const base = "http://g/v1beta";
  it("filtro de conteúdo e erro viram mensagem clara", async () => {
    const filtered = veoProvider({ baseUrl: base, fetch: reply({ done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ["x"] } } }) });
    expect(await filtered.checkVideo({ apiKey: "k", externalId: "models/v/operations/1" })).toEqual({ state: "failed", error: expect.stringMatching(/filtro de conteúdo/) });
    const failed = veoProvider({ baseUrl: base, fetch: reply({ done: true, error: { message: "quota" } }) });
    expect(await failed.checkVideo({ apiKey: "k", externalId: "models/v/operations/1" })).toEqual({ state: "failed", error: expect.stringMatching(/quota/) });
  });
  it("instabilidade do provedor espera o próximo minuto", async () => {
    const p = veoProvider({ baseUrl: base, fetch: reply({ error: { message: "x" } }, 503) });
    expect(await p.checkVideo({ apiKey: "k", externalId: "models/v/operations/1" })).toEqual({ state: "running" });
  });
  it("não baixa vídeo de endereço estranho nem aceita id malformado", async () => {
    const p = veoProvider({ baseUrl: base, fetch: reply({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "http://evil/x.mp4" } }] } } }) });
    expect((await p.checkVideo({ apiKey: "k", externalId: "models/v/operations/1" })).state).toBe("failed");
    expect((await p.checkVideo({ apiKey: "k", externalId: "../../x?y" })).state).toBe("failed");
  });
});

describe("Higgsfield", () => {
  it("modelos image-to-video pedem quadro inicial", async () => {
    const p = higgsfieldProvider({ baseUrl: "http://h", fetch: reply({ request_id: "r1" }) });
    expect(p.needsImage("wan/v2.6/image-to-video")).toBe(true);
    expect(p.needsImage("wan/v2.6/text-to-video")).toBe(false);
    await expect(p.startVideo({ apiKey: "a:b", model: "wan/v2.6/image-to-video", prompt: "x", aspect: "9:16" })).rejects.toThrow(/imagem inicial/);
    expect(await p.startVideo({ apiKey: "a:b", model: "wan/v2.6/text-to-video", prompt: "x", aspect: "9:16" })).toEqual({ externalId: "r1" });
  });
  it("nsfw e falha viram mensagem; fila segue rodando", async () => {
    const st = (body: unknown) => higgsfieldProvider({ baseUrl: "http://h", fetch: reply(body) }).checkVideo({ apiKey: "a:b", externalId: "r1" });
    expect(await st({ status: "queued" })).toEqual({ state: "running" });
    expect(await st({ status: "nsfw" })).toEqual({ state: "failed", error: expect.stringMatching(/filtro de conteúdo/) });
    expect(await st({ status: "failed", error: "sem créditos" })).toEqual({ state: "failed", error: expect.stringMatching(/sem créditos/) });
  });
  it("chave no formato KEY_ID:KEY_SECRET; 404 num pedido inexistente quer dizer chave boa", async () => {
    expect(await checkKey("higgsfield", "so-uma-parte-sem-dois-pontos")).toMatch(/KEY_ID:KEY_SECRET/);
    expect(await checkKey("higgsfield", "id:segredo", { higgsfield: { baseUrl: "http://h", fetch: reply({ detail: "Not found" }, 404) } })).toBeNull();
    expect(await checkKey("higgsfield", "id:segredo", { higgsfield: { baseUrl: "http://h", fetch: reply({ detail: "Invalid credentials" }, 401) } })).toMatch(/recusada/);
  });
});
