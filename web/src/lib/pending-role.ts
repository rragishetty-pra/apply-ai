"use client";
/** A role picked on the landing page, remembered across sign-up so onboarding can use it. */
const KEY = "applyai_pending_role";

export function savePendingRole(role: string | null) {
  try {
    if (role) localStorage.setItem(KEY, role.slice(0, 80));
  } catch {}
}
export function readPendingRole(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function clearPendingRole() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
/** Put the role first (so Hunter searches it), without duplicates, max 5. */
export function withRole(roles: string[], role: string | null): string[] {
  if (!role) return roles;
  const rest = roles.filter((r) => r.toLowerCase() !== role.toLowerCase());
  return [role, ...rest].slice(0, 5);
}
