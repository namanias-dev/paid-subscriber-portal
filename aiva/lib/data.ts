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
