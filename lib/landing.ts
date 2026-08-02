import { normalizeIndianMobile } from "./phone";
import { sanitizeHtml } from "./sanitizeHtml";
import { isValidZoomUrl } from "./courseZoom";
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

  // --- After-registration / Class Hub config (sanitize HTML blocks) ---
  if (isObj(out.after_registration)) {
    const a = out.after_registration as Record<string, unknown>;
    const videos = Array.isArray(a.videos)
      ? (a.videos as Record<string, unknown>[])
          .map((v) => ({
            title: (v.title || "").toString().trim() || null,
            description: (v.description || "").toString().trim() || null,
            url: (v.url || "").toString().trim(),
          }))
          .filter((v) => v.url)
      : [];
    const blocks = Array.isArray(a.blocks)
      ? (a.blocks as PageSection[]).map((sec, i) => ({
          id: sec.id || `blk-${i}`,
          title: (sec.title || "").toString(),
          subtitle: (sec.subtitle || "").toString().trim() || null,
          content: sec.content ? sanitizeHtml(sec.content) : null,
          image_url: (sec.image_url || "").toString().trim() || null,
          video_url: (sec.video_url || "").toString().trim() || null,
          order: typeof sec.order === "number" ? sec.order : i,
          visible: sec.visible !== false,
        } satisfies PageSection))
      : [];
    const courseZoom = (a.zoom_link || "").toString().trim() || null;
    if (courseZoom && !isValidZoomUrl(courseZoom)) {
      return { ok: false, error: "Course Zoom link must be a valid zoom.us / zoom.com URL." };
    }
    out.after_registration = {
      welcome_html: a.welcome_html ? sanitizeHtml(a.welcome_html as string) || null : null,
      zoom_link: courseZoom,
      zoom_note: (a.zoom_note || "").toString().trim() || null,
      class_timing: (a.class_timing || "").toString().trim() || null,
      next_class_at: (a.next_class_at || "").toString().trim() || null,
      videos,
      doc_ids: Array.isArray(a.doc_ids) ? (a.doc_ids as unknown[]).filter((x): x is string => typeof x === "string") : [],
      blocks,
    };
  }

  // --- Per-batch Zoom (join URL validated; host URL kept but never student-facing) ---
  if (Array.isArray(out.batches)) {
    const normalized: Record<string, unknown>[] = [];
    for (let i = 0; i < (out.batches as unknown[]).length; i++) {
      const raw = (out.batches as unknown[])[i];
      if (!raw || typeof raw !== "object") continue;
      const b = { ...(raw as Record<string, unknown>) };
      const zl = (b.zoom_link || "").toString().trim() || null;
      if (zl && !isValidZoomUrl(zl)) {
        return { ok: false, error: `Batch ${i + 1}: Zoom link must be a valid zoom.us / zoom.com URL.` };
      }
      const host = (b.zoom_host_url || "").toString().trim() || null;
      if (host && !isValidZoomUrl(host)) {
        return { ok: false, error: `Batch ${i + 1}: Host/start URL must be a valid Zoom URL.` };
      }
      b.zoom_link = zl;
      b.zoom_meeting_id = (b.zoom_meeting_id || "").toString().trim() || null;
      b.zoom_passcode = (b.zoom_passcode || "").toString().trim() || null;
      b.zoom_host_url = host;
      b.zoom_note = (b.zoom_note || "").toString().trim() || null;
      normalized.push(b);
    }
    out.batches = normalized;
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

/** New courses / newly added batches must carry a structured start_date. */
export function assertBatchesHaveStartDates(
  batches: unknown,
  opts?: { previousIds?: Set<string>; requireAll?: boolean },
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(batches)) return { ok: true };
  const prev = opts?.previousIds;
  const requireAll = opts?.requireAll === true;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i] as Record<string, unknown>;
    const id = String(b.id || "");
    const isNew = requireAll || !prev || !prev.has(id);
    if (!isNew) continue;
    const start = b.start_date == null || b.start_date === "" ? null : String(b.start_date);
    if (!start) {
      return {
        ok: false,
        error: `Batch ${i + 1}: a structured start date is required. Free-text labels cannot replace it.`,
      };
    }
    if (!Number.isFinite(Date.parse(start))) {
      return { ok: false, error: `Batch ${i + 1}: start date is invalid.` };
    }
  }
  return { ok: true };
}
