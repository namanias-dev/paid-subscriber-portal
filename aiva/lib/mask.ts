/** PII masking helpers. AIVA never surfaces full phone/email in non-privileged views or events. */

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  const last = digits.slice(-4);
  return `••••••${last}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user, domain] = String(email).split("@");
  if (!domain) return "•••";
  const head = user.slice(0, 1);
  return `${head}•••@${domain}`;
}

export function maskName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = String(name).trim().split(/\s+/);
  return parts.map((p, i) => (i === 0 ? p : `${p.slice(0, 1)}.`)).join(" ");
}
