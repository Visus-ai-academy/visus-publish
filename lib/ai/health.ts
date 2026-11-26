/**
 * Checagem de publicidade médica (CFM/CRO), feita no servidor sobre o texto final.
 * Não bloqueia: cada alerta leva o post para aprovação (SPEC §5).
 */
const RULES: { re: RegExp; flag: string }[] = [
  { re: /antes\s*(e|&|x|\/)\s*depois/i, flag: "Fala em antes e depois" },
  { re: /\b(garanti\w*|100\s?%|resultado(s)? certo|sem risco)/i, flag: "Promete resultado" },
  { re: /\b(cura|curar|curamos|cure)\b/i, flag: "Promete cura" },
  { re: /\b(sem dor|indolor)\b/i, flag: "Promete ausência de dor" },
  { re: /\b(o|a|os|as) melhor(es)? (médic|dentist|clínic|tratament|profission|especialist)/i, flag: "Usa superlativo" },
  { re: /\b(únic[oa]s? (na|no|que)|exclusiv[oa])\b/i, flag: "Afirma exclusividade" },
  { re: /\b(desconto|promoção|promo|preço|parcel\w*|grátis|gratuit\w*|r\$)/i, flag: "Fala de preço ou promoção" },
  { re: /\b(milagr\w*|revolucionári\w*|definitiv[oa])\b/i, flag: "Usa termo sensacionalista" },
];

export function healthFlags(text: string): string[] {
  return RULES.filter((r) => r.re.test(text)).map((r) => r.flag);
}

/** Junta alertas sem repetir e sem vazios, no máximo 10, cada um com até 140 caracteres. */
export function mergeFlags(...lists: (readonly string[] | null | undefined)[]): string[] {
  const out = new Map<string, string>();
  for (const list of lists)
    for (const f of list ?? []) {
      const v = f.trim().slice(0, 140);
      if (v && !out.has(v.toLowerCase())) out.set(v.toLowerCase(), v);
    }
  return [...out.values()].slice(0, 10);
}
