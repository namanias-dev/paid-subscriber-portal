import { SITE_URL } from "./config";
import { seedById, renderTemplate } from "./sms/templates";
import { buildWhatsAppLink } from "./whatsapp";

/** Render the existing DLT login_code_resend body — never invent a new template. */
export function renderPortalLoginCodeMessage(opts: {
  name: string;
  loginCode: string;
}): { text: string; missing: string[] } {
  const seed = seedById("login_code_resend");
  const body =
    seed?.body ||
    "Hi {first_name}, your login code is {login_code}. Login: {login_url}. Naman Sharma IAS Academy";
  const first_name = (opts.name || "there").trim().split(/\s+/)[0] || "there";
  return renderTemplate(body, {
    first_name,
    login_code: opts.loginCode,
    login_url: `${SITE_URL}/login`,
  });
}

export function portalLoginWhatsAppLink(phone: string, name: string, loginCode: string): string | null {
  const { text } = renderPortalLoginCodeMessage({ name, loginCode });
  return buildWhatsAppLink(phone, text);
}
