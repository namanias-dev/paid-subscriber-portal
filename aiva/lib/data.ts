import { getSupabase } from "./supabase";
import type {
  Payment,
  CourseEnrollment,
  PaymentProofStatus,
  WebinarRegistration,
  Webinar,
} from "@portal/lib/types";

/**
 * Read-only data access for AIVA against the shared DB. Paginates past Supabase's 1000-row cap.
 * These reads never mutate. Column shapes mirror @portal/lib/types.
 */

const PAGE = 1000;

async function fetchAll<T>(table: string, columns: string, order = "created_at", opts?: { notDeleted?: boolean }): Promise<T[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).order(order, { ascending: false }).range(from, from + PAGE - 1);
    if (opts?.notDeleted) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    out.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
    if (from > PAGE * 50) break; // hard safety ceiling (50k rows)
  }
  return out;
}

export async function fetchPayments(): Promise<Payment[]> {
  return fetchAll<Payment>("payments", "*", "created_at", { notDeleted: true });
}

export async function fetchCourseEnrollments(): Promise<CourseEnrollment[]> {
  return fetchAll<CourseEnrollment>("course_enrollments", "*", "created_at");
}

export async function fetchWebinarRegistrations(): Promise<WebinarRegistration[]> {
  return fetchAll<WebinarRegistration>("webinar_registrations", "*", "created_at");
}

export async function fetchWebinars(): Promise<Webinar[]> {
  return fetchAll<Webinar>("webinars", "*", "created_at");
}

/** Batch shape read from courses.batches[] (only the fields AIVA needs for timeline/seat-fill). */
export type CourseBatchLite = {
  id?: string | null;
  label?: string | null;
  start_date?: string | null;
  capacity?: number | string | null;
};

export type CourseLite = {
  id: string;
  title: string | null;
  slug: string | null;
  capacity: number | null;
  default_batch_id: string | null;
  batches: CourseBatchLite[] | null;
};

/** Minimal courses read for batch timeline / seat-fill (avoids pulling heavy jsonb blobs). */
export async function fetchCoursesLite(): Promise<CourseLite[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("courses")
    .select("id, title, slug, capacity, default_batch_id, batches");
  if (error || !data) return [];
  return data as unknown as CourseLite[];
}

/** A single SMS log row (subset AIVA needs to summarise comms history). Read-only. */
export type SmsLogLite = {
  normalized_mobile: string | null;
  mobile: string | null;
  template_name: string | null;
  trigger_event: string | null;
  status: string | null;
  sent_at: string | null;
  created_at: string | null;
};

/**
 * On-demand SMS history for a SMALL set of phones (a drill-down page), joined by the
 * portal's own normalized_mobile. Never pulls the whole sms_logs table.
 */
export async function fetchSmsForPhones(phones: string[]): Promise<SmsLogLite[]> {
  const sb = getSupabase();
  if (!sb || phones.length === 0) return [];
  const keys = Array.from(new Set(phones.map((p) => String(p).replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10)));
  if (keys.length === 0) return [];
  const out: SmsLogLite[] = [];
  // Chunk the IN() list to stay well under URL limits.
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const { data } = await sb
      .from("sms_logs")
      .select("normalized_mobile, mobile, template_name, trigger_event, status, sent_at, created_at")
      .in("normalized_mobile", chunk);
    if (data) out.push(...(data as unknown as SmsLogLite[]));
  }
  return out;
}

/** Resolve students.id for a small set of phones (last-10 key) so AIVA can deep-link record-level. */
export async function fetchStudentIdsByPhone(phones: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const sb = getSupabase();
  if (!sb || phones.length === 0) return out;
  const keys = Array.from(new Set(phones.map((p) => String(p).replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10)));
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const { data } = await sb.from("students").select("id, phone").in("phone", chunk);
    for (const r of data || []) {
      const ph = String((r as { phone?: string }).phone || "").replace(/\D/g, "").slice(-10);
      const id = (r as { id?: string }).id;
      if (ph && id && !out.has(ph)) out.set(ph, id);
    }
  }
  return out;
}

/** A minimal student identity row for the Student 360 lookup. Read-only. */
export type StudentLite = { id: string; name: string | null; phone: string | null; email: string | null };

/**
 * Resolve a small candidate set of students for a free-text query (name substring OR phone
 * last-10). Read-only, capped, used only by the Student 360 tool. Never returns full PII to the
 * client — callers mask before rendering.
 */
export async function fetchStudentsSearch(query: string, limit = 8): Promise<StudentLite[]> {
  const sb = getSupabase();
  const q = String(query || "").trim();
  if (!sb || q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  try {
    if (digits.length >= 4) {
      const { data } = await sb
        .from("students")
        .select("id, name, phone, email")
        .ilike("phone", `%${digits.slice(-10)}%`)
        .limit(limit);
      return (data as unknown as StudentLite[]) || [];
    }
    const { data } = await sb
      .from("students")
      .select("id, name, phone, email")
      .ilike("name", `%${q}%`)
      .limit(limit);
    return (data as unknown as StudentLite[]) || [];
  } catch {
    return [];
  }
}

/** Map of payment_id -> proof status, for group-status derivation. */
export async function fetchProofStatuses(): Promise<Record<string, PaymentProofStatus | undefined>> {
  const sb = getSupabase();
  if (!sb) return {};
  const out: Record<string, PaymentProofStatus | undefined> = {};
  try {
    const { data } = await sb.from("payment_proofs").select("payment_id, status");
    for (const r of data || []) out[String(r.payment_id)] = (r.status as PaymentProofStatus) || undefined;
  } catch { /* best-effort */ }
  return out;
}

export async function countOpenProofs(): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { count } = await sb
    .from("payment_proofs")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "reupload_requested"]);
  return count || 0;
}
