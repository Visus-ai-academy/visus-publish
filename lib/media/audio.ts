/**
 * Áudio do vídeo para a IA: decodifica no navegador, junta os canais, reduz para 16 kHz mono
 * e devolve WAV em data URL. Até 3 minutos (o suficiente para Reels). null se não houver áudio.
 */
const RATE = 16_000;
const MAX_SECONDS = 180;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

function wav(samples: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function audioFor(file: File): Promise<string | null> {
  if (!file.type.startsWith("video/") || file.size > MAX_FILE_BYTES) return null;
  try {
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer()).finally(() => ctx.close());
    const seconds = Math.min(decoded.duration, MAX_SECONDS);
    if (seconds < 0.5) return null;
    const off = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0, 0, seconds);
    const mono = (await off.startRendering()).getChannelData(0);
    // Sem som (vídeo mudo): não manda
    let peak = 0;
    for (let i = 0; i < mono.length; i += 64) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak < 0.01) return null;
    return `data:audio/wav;base64,${toBase64(wav(mono))}`;
  } catch {
    return null; // sem trilha de áudio ou codec que o navegador não abre
  }
}
