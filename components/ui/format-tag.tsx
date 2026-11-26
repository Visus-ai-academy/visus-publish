import { FORMAT_LABELS, type Format } from "@/lib/posts/upload";

/**
 * Etiqueta do formato do post (Foto, Carrossel, Reels, Stories): ícone + texto,
 * cada formato com uma cor suave. O texto escuro mantém contraste acima de 4.5:1.
 */
const STYLE: Record<Format, { box: string; icon: string[] }> = {
  image: { box: "bg-[#eef2e3] text-[#3d4d1c]", icon: ["M3 4h10v8H3z", "M3 10l3-3 2.5 2.5L10 8l3 3"] },
  carousel: { box: "bg-[#e6eef8] text-[#1f4a7a]", icon: ["M5 4h8v8H5z", "M3 6v8h8"] },
  reels: { box: "bg-[#f8e8ee] text-[#8a2347]", icon: ["M3 3.5h10v9H3z", "M7 6l3 2-3 2z"] },
  story: { box: "bg-[#fbefd9] text-[#7a4b0c]", icon: ["M5.5 2.5h5v11h-5z", "M7.5 11.5h1"] },
};

export function FormatTag({ format }: { format: Format }) {
  const s = STYLE[format];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ${s.box}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        {s.icon.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      {FORMAT_LABELS[format]}
    </span>
  );
}
