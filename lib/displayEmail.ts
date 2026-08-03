/**
 * Admin/CRM display helper — never surface gateway placeholder emails as real data.
 */
export function displayPublicEmail(email: string | null | undefined): string {
  const e = (email || "").trim();
  if (!e) return "—";
  if (e.toLowerCase().endsWith("@guest.namanias.com")) return "—";
  return e;
}

export function isGatewayPlaceholderEmail(email: string | null | undefined): boolean {
  const e = (email || "").trim().toLowerCase();
  return !!e && e.endsWith("@guest.namanias.com");
}
