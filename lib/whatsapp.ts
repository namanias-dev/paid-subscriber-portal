import { ACADEMY, PORTAL_URL } from "./config";
import { formatDate } from "./dates";

interface WhatsAppParams {
  name: string;
  code: string;
  phone: string;
  planName: string;
  expiry: string | null;
}

export function buildWelcomeMessage({
  name,
  code,
  phone,
  planName,
  expiry,
}: WhatsAppParams): string {
  const expiryText = expiry ? formatDate(expiry) : "Lifetime (∞)";
  return (
    `Hello ${name}! 🎯 Welcome to ${ACADEMY.name} Premium Community. ` +
    `Your access code is: ${code}. ` +
    `Login at ${PORTAL_URL} using mobile ${phone} and this code. ` +
    `Your ${planName} access is valid till ${expiryText}. ` +
    `Support: ${ACADEMY.phone}. — Naman Sir's Team`
  );
}

/** Build a wa.me deep link to send the welcome message to a student. */
export function buildWhatsAppLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, "");
  const withCountry = cleaned.length === 10 ? `91${cleaned}` : cleaned;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
