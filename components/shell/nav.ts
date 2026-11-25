export type NavKey = "calendario" | "planejamento" | "aprovacoes" | "criativos" | "insights" | "contas" | "ia" | "equipe";

export const SCREENS: Record<NavKey, { label: string; title: string; sub: (tenant: string) => string; phase?: number; icon: string[] }> = {
  calendario: { label: "Calendário", title: "Calendário", sub: (t) => `Tudo o que vai ao ar em ${t}, por conta e por status.`, icon: ["M7 3v3M17 3v3M4 9h16", "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"] },
  planejamento: { label: "Planejamento", title: "Planejamento", sub: () => "Dia, horário e tema. A IA escreve a legenda e cria a arte ou o vídeo.", phase: 2, icon: ["M4 6h11M4 11h11M4 16h6", "M14 20l.8-3.2 5-5 2.4 2.4-5 5z"] },
  aprovacoes: { label: "Aprovações", title: "Aprovações", sub: () => "Confira legenda e criativo antes de ir para o Instagram.", icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M8 12.5l2.7 2.7L16.2 9.6"] },
  criativos: { label: "Criativos prontos", title: "Criativos prontos", sub: () => "Fotos, vídeos e artes já finalizadas, prontos para agendar.", icon: ["M4 5h16v14H4z", "M4 16l5-5 4 4 2-2 5 5", "M15.5 9h.01"] },
  insights: { label: "Insights", title: "Insights", sub: () => "Curtidas, comentários e visitas ao perfil cruzados com horário, formato e público.", phase: 4, icon: ["M5 20V11", "M12 20V4", "M19 20v-8"] },
  contas: { label: "Contas do Instagram", title: "Contas do Instagram", sub: () => "Conecte quantas contas precisar e defina se cada uma pede aprovação.", icon: ["M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z", "M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2"] },
  ia: { label: "Integrações de IA", title: "Integrações de IA", sub: () => "Quais IAs escrevem e criam para este cliente, e quem paga o consumo.", phase: 3, icon: ["M9 3v5M15 3v5", "M7 8h10v3a5 5 0 0 1-10 0z", "M12 16v5"] },
  equipe: { label: "Equipe", title: "Equipe", sub: (t) => `Quem acessa ${t} e o que cada pessoa pode fazer.`, icon: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20a6.5 6.5 0 0 1 13 0", "M16 4.6a3.5 3.5 0 0 1 0 6.3M21.5 20a6 6 0 0 0-3.4-5.4"] },
};

export const NAV_GROUPS: Array<[string, NavKey[]]> = [
  ["Conteúdo", ["calendario", "planejamento", "aprovacoes", "criativos"]],
  ["Análise", ["insights"]],
  ["Configurações", ["contas", "ia", "equipe"]],
];

export const ADMIN_ICON = ["M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z", "M9 12l2 2 4-4"];
