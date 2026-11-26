/**
 * Reduz imagens e tira quadros de vídeos no navegador, para mandar à IA
 * só JPEGs pequenos (o arquivo original não sai do aparelho nesta etapa).
 */
const MAX_SIDE = 768;
const QUALITY = 0.72;

function canvasFor(w: number, h: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  return c;
}

async function imageFrame(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const c = canvasFor(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", QUALITY);
}

function once(el: HTMLVideoElement, ev: "loadeddata" | "seeked", ms = 8000) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    el.addEventListener(ev, () => (clearTimeout(t), resolve()), { once: true });
    el.addEventListener("error", () => (clearTimeout(t), reject(new Error("decode"))), { once: true });
  });
}

/** Até `count` quadros espalhados pelo vídeo. Lança erro se o navegador não decodificar o vídeo. */
async function videoFrames(file: File, count: number): Promise<{ frames: string[]; duration: number }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await once(v, "loadeddata");
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    if (!v.videoWidth || !d) throw new Error("decode");
    const c = canvasFor(v.videoWidth, v.videoHeight);
    const ctx = c.getContext("2d")!;
    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      v.currentTime = Math.min(d - 0.05, (d * (i + 0.5)) / count);
      await once(v, "seeked");
      ctx.drawImage(v, 0, 0, c.width, c.height);
      frames.push(c.toDataURL("image/jpeg", QUALITY));
    }
    return { frames, duration: d };
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

export class FrameError extends Error {}

/** Quadros para a IA: imagens reduzidas (até 6) ou 4 quadros do vídeo. */
export async function framesFor(files: File[]): Promise<{ kind: "image" | "video"; frames: string[] }> {
  const video = files.find((f) => f.type.startsWith("video/"));
  if (video) {
    try {
      return { kind: "video", frames: (await videoFrames(video, 4)).frames };
    } catch {
      throw new FrameError("Não consegui ler este vídeo no navegador. Vídeos .mov gravados em HEVC às vezes não abrem; tente um .mp4.");
    }
  }
  try {
    return { kind: "image", frames: await Promise.all(files.slice(0, 6).map(imageFrame)) };
  } catch {
    throw new FrameError("Não consegui ler esta imagem.");
  }
}
