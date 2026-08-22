/** Tiny module so dataProvider can exclude archived students without a cycle. */
import { getSupabaseAdmin } from "./supabase";

export const ARCHIVE_NOTES_PREFIX = "⟦ARCHIVED⟧";

export function isArchivedStudent(s: { archived_at?: string | null; notes?: string | null } | null | undefined): boolean {
  if (!s) return false;
  if (s.archived_at) return true;
  return String(s.notes || "").startsWith(ARCHIVE_NOTES_PREFIX);
}

export async function archivedPhoneSet(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const out = new Set<string>();
  if (!supabase) return out;
  try {
    const { data, error } = await supabase.from("students").select("phone,archived_at,notes");
    const rows = error
      ? ((await supabase.from("students").select("phone,notes")).data || [])
      : (data || []);
    for (const r of rows) {
      if (isArchivedStudent(r)) out.add(String((r as { phone: string }).phone));
    }
  } catch {
    /* empty */
  }
  return out;
}
