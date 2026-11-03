/**
 * Colaboradores entran con "usuario" + contraseña, sin correo real. Por
 * dentro, Supabase Auth siempre necesita un correo como identificador, así
 * que se arma uno sintético (`usuario@vertify.local`) que nadie ve ni usa
 * para recibir nada — nunca se le manda correo.
 */
export const COLLAB_EMAIL_DOMAIN = "vertify.local";

/** Minúsculas, sin acentos, solo letras/números/punto/guion/guion bajo. */
export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

/** 3 a 20 caracteres, sin empezar ni terminar en símbolo. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,18}[a-z0-9]$/.test(username);
}

export function usernameToEmail(username: string): string {
  return `${username}@${COLLAB_EMAIL_DOMAIN}`;
}

/** true si el correo es uno sintético de colaborador (no una bandeja real). */
export function isCollabEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${COLLAB_EMAIL_DOMAIN}`);
}
