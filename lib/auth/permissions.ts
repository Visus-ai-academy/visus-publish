export const ROLES = ["admin", "editor", "approver", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "view"
  | "edit_content"
  | "approve"
  | "publish"
  | "manage_tenant";

/** Matriz de permissões da SPEC §3. O banco aplica a mesma regra via RLS. */
const MATRIX: Record<Action, readonly Role[]> = {
  view: ["admin", "editor", "approver", "viewer"],
  edit_content: ["admin", "editor"],
  approve: ["admin", "approver"],
  publish: ["admin", "editor"],
  manage_tenant: ["admin"],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && MATRIX[action].includes(role);
}

export const ROLE_LABELS: Record<Role, { name: string; description: string }> = {
  admin: { name: "Administrador", description: "Conecta contas, convida pessoas, configura IA e cobrança." },
  editor: { name: "Editor", description: "Planeja, gera conteúdo, sobe criativos e agenda." },
  approver: {
    name: "Aprovador",
    description: "Recebe a fila e aprova ou reprova. Ideal para o cliente final ou o médico responsável.",
  },
  viewer: { name: "Visualizador", description: "Consulta calendário e insights." },
};
