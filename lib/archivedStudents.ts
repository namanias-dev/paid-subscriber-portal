/** Tiny module so dataProvider can exclude archived students without a cycle. */
import { getSupabaseAdmin } from "./supabase";

/** Legacy notes marker — never used as archive state. Kept only to strip/migrate. */
export const ARCHIVE_NOTES_PREFIX = "⟦ARCHIVED⟧";

const PAGE = 1000;

export function isArchivedStudent(s: { archived_at?: string | null; notes?: string | null } | null | undefined): boolean {
  if (!s) return false;
  return !!(s.archived_at && String(s.archived_at).trim());
}

export function stripArchiveNotesPrefix(notes: string | null | undefined): string | null {
  const n = String(notes || "");
  if (!n.startsWith(ARCHIVE_NOTES_PREFIX)) return notes == null || notes === "" ? null : notes;
  const rest = n.slice(ARCHIVE_NOTES_PREFIX.length).replace(/^[^\n]*\n?/, "").trim();
  return rest || null;
}

export async function excludeArchivedRows<T extends { phone?: string | null }>(rows: T[]): Promise<T[]> {
  const set = await archivedPhoneSet();
  if (!set.size) return rows;
  return rows.filter((r) => !set.has(String(r.phone || "")));
}

async function migrateNotesMarkersIfColumnPresent(): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const probe = await supabase.from("students").select("id").not("archived_at", "is", null).limit(1);
  if (probe.error) return;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("students")
      .select("id,phone,notes,archived_at")
      .like("notes", `${ARCHIVE_NOTES_PREFIX}%`)
      .range(from, from + PAGE - 1);
    if (error) return;
    const rows = data || [];
    for (const r of rows) {
      const stamp = (r as { archived_at?: string | null }).archived_at || new Date().toISOString();
      const notes = stripArchiveNotesPrefix((r as { notes?: string | null }).notes);
      await supabase.from("students").update({ archived_at: stamp, notes, is_active: false }).eq("id", (r as { id: string }).id);
      const phone = String((r as { phone?: string }).phone || "");
      if (phone) await supabase.from("buyers").update({ archived_at: stamp }).eq("phone", phone);
    }
    if (rows.length < PAGE) break;
  }
}

/**
 * Phones excluded from live revenue, enrolments, student lists, and pulses.
 * Uses archived_at. Pages until exhausted — never a 1000-row cap.
 * If the column is missing, falls back to inactive + legacy notes marker so
 * exclusion still works until DDL lands; isArchivedStudent itself ignores notes.
 */
export async function archivedPhoneSet(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const out = new Set<string>();
  if (!supabase) return out;

  const colOk = await supabase.from("students").select("phone").not("archived_at", "is", null).limit(1);
  if (!colOk.error) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("students")
        .select("phone,archived_at")
        .not("archived_at", "is", null)
        .range(from, from + PAGE - 1);
      if (error) break;
      const rows = data || [];
      for (const r of rows) {
        if (isArchivedStudent(r)) out.add(String((r as { phone: string }).phone));
      }
      if (rows.length < PAGE) break;
    }
    try {
      await migrateNotesMarkersIfColumnPresent();
    } catch {
      /* best-effort */
    }
    return out;
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("students")
      .select("phone,notes")
      .eq("is_active", false)
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = data || [];
    for (const r of rows) {
      if (String((r as { notes?: string }).notes || "").startsWith(ARCHIVE_NOTES_PREFIX)) {
        out.add(String((r as { phone: string }).phone));
      }
    }
    if (rows.length < PAGE) break;
  }
  return out;
}
