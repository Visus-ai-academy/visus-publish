import { describe, expect, it } from "vitest";
import { hashtagCount, storagePath, validateFiles } from "./upload";

const img = (n = "a.jpg", size = 1000) => ({ name: n, type: "image/jpeg", size });
const vid = (n = "a.mp4") => ({ name: n, type: "video/mp4", size: 5_000_000 });

describe("validação de arquivos por formato", () => {
  it("foto, reels, stories e carrossel", () => {
    expect(validateFiles("image", [img()])).toBeNull();
    expect(validateFiles("image", [vid()])).toMatch(/uma imagem/);
    expect(validateFiles("reels", [vid()])).toBeNull();
    expect(validateFiles("reels", [img()])).toMatch(/um vídeo/);
    expect(validateFiles("story", [vid()])).toBeNull();
    expect(validateFiles("carousel", [img()])).toMatch(/2 a 10/);
    expect(validateFiles("carousel", [img(), vid()])).toBeNull();
    expect(validateFiles("carousel", Array.from({ length: 11 }, () => img()))).toMatch(/2 a 10/);
  });
  it("tipo e tamanho", () => {
    expect(validateFiles("image", [{ name: "a.gif", type: "image/gif", size: 1 }])).toMatch(/JPG, PNG/);
    expect(validateFiles("image", [img("g.jpg", 9 * 1024 * 1024)])).toMatch(/8 MB/);
    expect(validateFiles("image", [])).toMatch(/pelo menos/);
  });
});

describe("utilidades", () => {
  it("caminho fica na pasta do cliente e do post, sem nome original", () => {
    expect(storagePath("t", "p", 3, "Minha Foto Final.JPEG")).toBe("t/p/03.jpeg");
    expect(storagePath("t", "p", 0, "../../x.sh")).toBe("t/p/00.bin");
  });
  it("conta hashtags", () => {
    expect(hashtagCount("Oi #saude #pele e #clínica_sp. email@x.com")).toBe(3);
  });
});
