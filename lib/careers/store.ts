import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  CareerPosition,
  CareerApplication,
  CareersSettings,
  FormField,
  PublicPosition,
  ApplicationStatus,
  StatusHistoryEntry,
} from "./types";
import { DEFAULT_CAREER_SUBJECTS, defaultFacultyFormFields } from "./config";

/**
 * Careers data layer. Talks to Supabase via the shared service-role client. In
 * demo mode (no Supabase) every read returns empty/defaults and every write is a
 * no-op-ish failure surfaced to the caller — the module simply stays dormant.
 */

function db() {
  return getSupabaseAdmin();
}

function slugify(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function asArray<T = string>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// --------------------------------------------------------------------------
//  Row normalisation
// --------------------------------------------------------------------------
function normPosition(r: Record<string, unknown>): CareerPosition {
  return {
    id: String(r.id),
    title: String(r.title || ""),
    slug: String(r.slug || ""),
    role_type: String(r.role_type || "other"),
    location_city: (r.location_city as string) ?? null,
    location_state: (r.location_state as string) ?? null,
    job_type: (r.job_type as CareerPosition["job_type"]) || "full_time",
    salary_min: r.salary_min == null ? null : Number(r.salary_min),
    salary_max: r.salary_max == null ? null : Number(r.salary_max),
    salary_currency: String(r.salary_currency || "INR"),
    salary_period: (r.salary_period as CareerPosition["salary_period"]) || "month",
    subjects: asArray<string>(r.subjects),
    summary: (r.summary as string) ?? null,
    description_html: (r.description_html as string) ?? null,
    requirements_html: (r.requirements_html as string) ?? null,
    status: (r.status as CareerPosition["status"]) || "draft",
    accepting_applications: r.accepting_applications !== false,
    form_fields: asArray<FormField>(r.form_fields),
    display_order: Number(r.display_order || 0),
    created_at: String(r.created_at || ""),
    updated_at: String(r.updated_at || ""),
  };
}

function normApplication(r: Record<string, unknown>): CareerApplication {
  return {
    id: String(r.id),
    position_id: (r.position_id as string) ?? null,
    position_title: (r.position_title as string) ?? null,
    position_slug: (r.position_slug as string) ?? null,
    full_name: String(r.full_name || ""),
    phone: String(r.phone || ""),
    email: String(r.email || ""),
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    subjects: asArray<string>(r.subjects),
    upsc_attempts: r.upsc_attempts == null ? null : Number(r.upsc_attempts),
    interview_attempts: r.interview_attempts == null ? null : Number(r.interview_attempts),
    salary_expectation: r.salary_expectation == null ? null : Number(r.salary_expectation),
    upsc_roll_number: (r.upsc_roll_number as string) ?? null,
    answers: asObj(r.answers),
    files: asArray(r.files),
    status: (r.status as ApplicationStatus) || "new",
    admin_notes: (r.admin_notes as string) ?? null,
    status_history: asArray<StatusHistoryEntry>(r.status_history),
    source: (r.source as string) ?? null,
    ip: (r.ip as string) ?? null,
    created_at: String(r.created_at || ""),
    updated_at: String(r.updated_at || ""),
  };
}

// --------------------------------------------------------------------------
//  Settings
// --------------------------------------------------------------------------
export async function getCareersSettings(): Promise<CareersSettings> {
  const client = db();
  const fallback: CareersSettings = {
    id: "global",
    accepting_applications: true,
    subjects: DEFAULT_CAREER_SUBJECTS,
    default_form_fields: defaultFacultyFormFields(),
    notify_email: null,
    updated_at: "",
  };
  if (!client) return fallback;
  const { data } = await client.from("careers_settings").select("*").eq("id", "global").maybeSingle();
  if (!data) return fallback;
  const subjects = asArray<string>(data.subjects);
  const fields = asArray<FormField>(data.default_form_fields);
  return {
    id: "global",
    accepting_applications: data.accepting_applications !== false,
    subjects: subjects.length ? subjects : DEFAULT_CAREER_SUBJECTS,
    default_form_fields: fields.length ? fields : defaultFacultyFormFields(),
    notify_email: (data.notify_email as string) ?? null,
    updated_at: String(data.updated_at || ""),
  };
}

export async function updateCareersSettings(patch: Partial<CareersSettings>): Promise<CareersSettings> {
  const client = db();
  if (!client) throw new Error("Database not configured.");
  const row: Record<string, unknown> = { id: "global", updated_at: new Date().toISOString() };
  if (patch.accepting_applications !== undefined) row.accepting_applications = !!patch.accepting_applications;
  if (patch.subjects !== undefined) row.subjects = patch.subjects;
  if (patch.default_form_fields !== undefined) row.default_form_fields = patch.default_form_fields;
  if (patch.notify_email !== undefined) row.notify_email = patch.notify_email;
  await client.from("careers_settings").upsert(row, { onConflict: "id" });
  return getCareersSettings();
}

// --------------------------------------------------------------------------
//  Positions
// --------------------------------------------------------------------------
export async function listPositions(): Promise<CareerPosition[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("careers_positions")
    .select("*")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });
  return (data || []).map(normPosition);
}

export async function listOpenPositions(): Promise<CareerPosition[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("careers_positions")
    .select("*")
    .eq("status", "open")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });
  return (data || []).map(normPosition);
}

export async function getPositionById(id: string): Promise<CareerPosition | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.from("careers_positions").select("*").eq("id", id).maybeSingle();
  return data ? normPosition(data) : null;
}

export async function getPositionBySlug(slug: string): Promise<CareerPosition | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.from("careers_positions").select("*").eq("slug", slug).maybeSingle();
  return data ? normPosition(data) : null;
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const client = db();
  const root = slugify(base) || "position";
  if (!client) return root;
  let candidate = root;
  let n = 1;
  // Small linear probe; collisions are rare.
  for (;;) {
    const { data } = await client.from("careers_positions").select("id").eq("slug", candidate).maybeSingle();
    if (!data || (excludeId && data.id === excludeId)) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

export async function createPosition(input: Partial<CareerPosition>): Promise<CareerPosition> {
  const client = db();
  if (!client) throw new Error("Database not configured.");
  const slug = await uniqueSlug(input.slug || input.title || "position");
  const row: Record<string, unknown> = {
    title: (input.title || "Untitled position").trim(),
    slug,
    role_type: input.role_type || "faculty",
    location_city: input.location_city ?? null,
    location_state: input.location_state ?? null,
    job_type: input.job_type || "full_time",
    salary_min: input.salary_min ?? null,
    salary_max: input.salary_max ?? null,
    salary_currency: input.salary_currency || "INR",
    salary_period: input.salary_period || "month",
    subjects: input.subjects ?? [],
    summary: input.summary ?? null,
    description_html: input.description_html ?? null,
    requirements_html: input.requirements_html ?? null,
    status: input.status || "draft",
    accepting_applications: input.accepting_applications !== false,
    form_fields: input.form_fields ?? [],
    display_order: input.display_order ?? 0,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from("careers_positions").insert(row).select().single();
  if (error) throw new Error(error.message);
  return normPosition(data);
}

export async function updatePosition(id: string, patch: Partial<CareerPosition>): Promise<CareerPosition | null> {
  const client = db();
  if (!client) return null;
  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const copy: (keyof CareerPosition)[] = [
    "title", "role_type", "location_city", "location_state", "job_type",
    "salary_min", "salary_max", "salary_currency", "salary_period", "subjects",
    "summary", "description_html", "requirements_html", "status",
    "accepting_applications", "form_fields", "display_order",
  ];
  for (const k of copy) {
    if (patch[k] !== undefined) clean[k] = patch[k];
  }
  if (patch.slug !== undefined && patch.slug) {
    clean.slug = await uniqueSlug(patch.slug, id);
  }
  const { data } = await client.from("careers_positions").update(clean).eq("id", id).select().single();
  return data ? normPosition(data) : null;
}

export async function deletePosition(id: string): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const { error } = await client.from("careers_positions").delete().eq("id", id);
  return !error;
}

export async function duplicatePosition(id: string): Promise<CareerPosition | null> {
  const src = await getPositionById(id);
  if (!src) return null;
  return createPosition({
    ...src,
    title: `${src.title} (Copy)`,
    slug: `${src.slug}-copy`,
    status: "draft",
  });
}

/** position_id -> application count (for the admin list). */
export async function applicationCountsByPosition(): Promise<Record<string, number>> {
  const client = db();
  if (!client) return {};
  const { data } = await client.from("careers_applications").select("position_id");
  const out: Record<string, number> = {};
  for (const r of data || []) {
    const pid = (r as { position_id: string | null }).position_id;
    if (pid) out[pid] = (out[pid] || 0) + 1;
  }
  return out;
}

// --------------------------------------------------------------------------
//  Applications
// --------------------------------------------------------------------------
export interface ApplicationFilters {
  positionId?: string;
  status?: ApplicationStatus;
  q?: string;
  from?: string;
  to?: string;
}

export async function listApplications(filters: ApplicationFilters = {}): Promise<CareerApplication[]> {
  const client = db();
  if (!client) return [];
  let query = client.from("careers_applications").select("*").order("created_at", { ascending: false });
  if (filters.positionId) query = query.eq("position_id", filters.positionId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  const { data } = await query;
  let rows = (data || []).map(normApplication);
  const q = (filters.q || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (a) =>
        a.full_name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.includes(q) ||
        (a.city || "").toLowerCase().includes(q) ||
        (a.state || "").toLowerCase().includes(q) ||
        a.subjects.some((s) => s.toLowerCase().includes(q)),
    );
  }
  return rows;
}

export async function getApplicationById(id: string): Promise<CareerApplication | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.from("careers_applications").select("*").eq("id", id).maybeSingle();
  return data ? normApplication(data) : null;
}

export async function createApplication(input: Partial<CareerApplication>): Promise<CareerApplication> {
  const client = db();
  if (!client) throw new Error("Database not configured.");
  const row: Record<string, unknown> = {
    position_id: input.position_id ?? null,
    position_title: input.position_title ?? null,
    position_slug: input.position_slug ?? null,
    full_name: (input.full_name || "").trim(),
    phone: (input.phone || "").trim(),
    email: (input.email || "").trim(),
    city: input.city ?? null,
    state: input.state ?? null,
    subjects: input.subjects ?? [],
    upsc_attempts: input.upsc_attempts ?? null,
    interview_attempts: input.interview_attempts ?? null,
    salary_expectation: input.salary_expectation ?? null,
    upsc_roll_number: input.upsc_roll_number ?? null,
    answers: input.answers ?? {},
    files: input.files ?? [],
    status: "new",
    status_history: [{ status: "new", by: null, at: new Date().toISOString(), note: "Submitted" }],
    source: input.source ?? null,
    ip: input.ip ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from("careers_applications").insert(row).select().single();
  if (error) throw new Error(error.message);
  return normApplication(data);
}

export async function updateApplication(
  id: string,
  patch: { status?: ApplicationStatus; admin_notes?: string; by?: string | null; note?: string | null },
): Promise<CareerApplication | null> {
  const client = db();
  if (!client) return null;
  const current = await getApplicationById(id);
  if (!current) return null;
  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.admin_notes !== undefined) clean.admin_notes = patch.admin_notes;
  if (patch.status !== undefined && patch.status !== current.status) {
    clean.status = patch.status;
    const history: StatusHistoryEntry[] = [
      ...current.status_history,
      { status: patch.status, by: patch.by ?? null, at: new Date().toISOString(), note: patch.note ?? null },
    ];
    clean.status_history = history;
  }
  const { data } = await client.from("careers_applications").update(clean).eq("id", id).select().single();
  return data ? normApplication(data) : null;
}

export async function deleteApplication(id: string): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const { error } = await client.from("careers_applications").delete().eq("id", id);
  return !error;
}

// --------------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------------
/** The effective form fields for a position: its own, else the global default. */
export async function resolveFormFields(position: CareerPosition): Promise<FormField[]> {
  if (position.form_fields && position.form_fields.length) return position.form_fields;
  const settings = await getCareersSettings();
  return settings.default_form_fields.length ? settings.default_form_fields : defaultFacultyFormFields();
}

/** Strip a position down to what the public site is allowed to see. */
export function toPublicPosition(p: CareerPosition, formFields: FormField[]): PublicPosition {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    role_type: p.role_type,
    location_city: p.location_city,
    location_state: p.location_state,
    job_type: p.job_type,
    salary_min: p.salary_min,
    salary_max: p.salary_max,
    salary_currency: p.salary_currency,
    salary_period: p.salary_period,
    subjects: p.subjects,
    summary: p.summary,
    description_html: p.description_html,
    requirements_html: p.requirements_html,
    accepting_applications: p.accepting_applications,
    form_fields: formFields.filter((f) => f.enabled),
  };
}
