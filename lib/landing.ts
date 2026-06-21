import { normalizeIndianMobile } from "./phone";
import { sanitizeHtml } from "./sanitizeHtml";
import type {
  SeatConfig,
  WhatsAppConfig,
  MentorInfo,
  PageSection,
  Review,
} from "./types";

export interface LandingNormalizeResult {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate, sanitize and normalize the landing-page fields on an incoming
 * course/webinar create/update body. Only touches fields that are present so
 * partial PATCH updates never wipe existing data. Returns a 400-friendly error
 * string when seats or the WhatsApp number are invalid.
 */
export function normalizeLandingInput(body: Record<string, unknown>): LandingNormalizeResult {
  const out: Record<string, unknown> = { ...body };

  // --- Seats ---
  if (isObj(out.seat_config)) {
    const s = out.seat_config as SeatConfig;
    const total = s.total == null || s.total === ("" as unknown) ? null : Number(s.total);
    const remaining = s.remaining == null || s.remaining === ("" as unknown) ? null : Number(s.remaining);
    if (total != null && (Number.isNaN(total) || total < 0)) {
      return { ok: false, error: "Total seats must be 0 or more." };
    }
    if (remaining != null && (Number.isNaN(remaining) || remaining < 0)) {
      return { ok: false, error: "Seats remaining must be 0 or more." };
    }
    if (total != null && remaining != null && remaining > total) {
      return { ok: false, error: "Seats remaining cannot exceed total seats." };
    }
    out.seat_config = {
      show: !!s.show,
      total,
      remaining,
      text_override: (s.text_override || "").toString().trim() || null,
      show_filling_fast: !!s.show_filling_fast,
      filling_fast_text: (s.filling_fast_text || "").toString().trim() || null,
    } satisfies SeatConfig;
  }

  // --- WhatsApp / contact ---
  if (isObj(out.whatsapp_config)) {
    const w = out.whatsapp_config as WhatsAppConfig;
    const cfg: WhatsAppConfig = {
      show_cta: !!w.show_cta,
      cta_text: (w.cta_text || "").toString().trim() || null,
      prefill_message: (w.prefill_message || "").toString().trim() || null,
      phone: null,
      whatsapp: null,
    };
    const phoneRaw = (w.phone || "").toString().trim();
    const waRaw = (w.whatsapp || "").toString().trim();
    if (phoneRaw) {
      const n = normalizeIndianMobile(phoneRaw);
      if (!n.ok) return { ok: false, error: `Contact phone: ${n.error}` };
      cfg.phone = n.e164;
    }
    if (waRaw) {
      const n = normalizeIndianMobile(waRaw);
      if (!n.ok) return { ok: false, error: `WhatsApp number: ${n.error}` };
      cfg.whatsapp = n.wa;
    }
    // Don't advertise the CTA if there is no usable number.
    if (!cfg.whatsapp && !cfg.phone) cfg.show_cta = false;
    out.whatsapp_config = cfg;
  }

  // --- Rich HTML fields ---
  if (typeof out.about_html === "string") {
    out.about_html = sanitizeHtml(out.about_html) || null;
  }
  if (isObj(out.mentor)) {
    const m = out.mentor as MentorInfo;
    out.mentor = {
      name: (m.name || "").toString().trim() || null,
      credentials: (m.credentials || "").toString().trim() || null,
      bio: m.bio ? sanitizeHtml(m.bio) : null,
      image_url: (m.image_url || "").toString().trim() || null,
    } satisfies MentorInfo;
  }

  // --- Flexible sections (sanitize each content block) ---
  if (Array.isArray(out.sections)) {
    out.sections = (out.sections as PageSection[]).map((sec, i) => ({
      id: sec.id || `sec-${i}`,
      title: (sec.title || "").toString(),
      subtitle: (sec.subtitle || "").toString().trim() || null,
      content: sec.content ? sanitizeHtml(sec.content) : null,
      image_url: (sec.image_url || "").toString().trim() || null,
      video_url: (sec.video_url || "").toString().trim() || null,
      order: typeof sec.order === "number" ? sec.order : i,
      visible: sec.visible !== false,
    } satisfies PageSection));
  }

  // --- Reviews (clamp rating; keep text plain) ---
  if (Array.isArray(out.reviews)) {
    out.reviews = (out.reviews as Review[]).map((r, i) => ({
      id: r.id || `rev-${i}`,
      name: (r.name || "").toString(),
      photo_url: (r.photo_url || "").toString().trim() || null,
      rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 5))),
      text: (r.text || "").toString(),
      result: (r.result || "").toString().trim() || null,
      city: (r.city || "").toString().trim() || null,
      video_url: (r.video_url || "").toString().trim() || null,
      visible: r.visible !== false,
      order: typeof r.order === "number" ? r.order : i,
    } satisfies Review));
  }

  return { ok: true, value: out };
}
