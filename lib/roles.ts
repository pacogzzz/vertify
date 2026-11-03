import type { Role } from "./types";

/**
 * Catálogo de roles de colaborador (todo lo que NO es el dueño).
 * Un solo lugar para agregar roles nuevos: el selector de "Agregar
 * colaborador" y el de "Cambiar rol" en Colaboradores salen de aquí.
 */
export const COLLAB_ROLES: { value: Exclude<Role, "owner">; label: string }[] = [
  { value: "runner", label: "Encargado de compra" },
  { value: "chef", label: "Chef" },
  { value: "admin", label: "Administrador" },
  { value: "caja", label: "Caja" },
];

/** Roles que todavía no tienen interfaz propia: solo ven una pantalla de "llega pronto". */
export const PLACEHOLDER_ROLES: Role[] = ["chef", "caja"];

export function isCollabRole(role: string): role is Exclude<Role, "owner"> {
  return COLLAB_ROLES.some((r) => r.value === role);
}

export function roleLabel(role: string): string {
  if (role === "owner") return "Dueño";
  return COLLAB_ROLES.find((r) => r.value === role)?.label || role;
}
