/**
 * Notes Store Student Voices — subject preference SETs.
 *
 * Distinct from store_subject_interest (per-product Coming Soon votes).
 * A returning voter updates one submission rather than creating a second person.
 * Interest is not marketing consent and never writes Academy identity tables.
 */
import { storeDb } from "./db";
import { clientIp, storeRateLimited } from "./rateLimit";
import { getOrCreateInterestVoterId } from "./interest";
import { listActiveCategories, listActiveProducts } from "./catalogue";
import {
  MAX_PREF_SUBJECTS,
  buildPreferenceSubjects,
  computeCoSelections,
  sanitizePreferenceSource,
  type PreferenceSubject,
} from "./preferenceLogic";

export {
  MAX_PREF_SUBJECTS,
  PREFERENCE_SOURCES,
  PUBLIC_DEMAND_MIN,
  buildPreferenceSubjects,
  combinations,
  computeCoSelections,
  isPreferenceSource,
  publicDemandView,
  sanitizePreferenceSource,
} from "./preferenceLogic";
export type { CoSelectionPair, CoSelectionTrio, PreferenceSource, PreferenceSubject } from "./preferenceLogic";

export const PREFERENCE_IP_MAX = 10;
export const PREFERENCE_IP_WINDOW_SEC = 10 * 60;
export const PREFERENCE_VOTER_MAX = 16;
export const PREFERENCE_VOTER_WINDOW_SEC = 24 * 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function demandCounts(): Promise<Map<string, number>> {
  const db = storeDb();
  const map = new Map<string, number>();
  if (!db) return map;
  const { data } = await db.from("store_interest_submission_subjects").select("category_id");
  for (const row of data || []) {
    const id = String(row.category_id);
    map.set(id, (map.get(id) || 0) + 1);
  }
  return map;
}

export async function listPreferenceSubjects(): Promise<PreferenceSubject[]> {
  const [categories, products, demand] = await Promise.all([
    listActiveCategories(),
    listActiveProducts({ kind: "single", limit: 80 }),
    demandCounts(),
  ]);
  const availability = new Map<string, boolean>();
  const meta = new Map<string, string | null>();
  for (const c of categories) {
    availability.set(c.id, false);
    meta.set(c.id, c.short_description);
  }
  for (const p of products) {
    const cat = categories.find((c) => c.slug === p.category_slug);
    if (!cat) continue;
    if (p.availability.purchasable) availability.set(cat.id, true);
    if (p.stage) meta.set(cat.id, p.stage);
  }
  return buildPreferenceSubjects(categories, availability, demand, meta);
}

export async function getVoterPreferenceIds(voterHash?: string): Promise<string[]> {
  const db = storeDb();
  if (!db) return [];
  const hash = voterHash || getOrCreateInterestVoterId().hash;
  const { data: sub } = await db
    .from("store_interest_submissions")
    .select("id")
    .eq("voter_hash", hash)
    .maybeSingle();
  if (!sub) return [];
  const { data: rows } = await db
    .from("store_interest_submission_subjects")
    .select("category_id")
    .eq("submission_id", sub.id);
  return (rows || []).map((r) => String(r.category_id));
}

export type SavePreferencesResult =
  | {
      ok: true;
      updated: boolean;
      selected: string[];
      available: PreferenceSubject[];
      waitlist: PreferenceSubject[];
    }
  | { ok: false; error: string; status: number };

export async function savePreferences(opts: {
  categoryIds: unknown;
  source: unknown;
  req: Request;
}): Promise<SavePreferencesResult> {
  const raw = Array.isArray(opts.categoryIds) ? opts.categoryIds : [];
  const requested = [...new Set(raw.map((id) => String(id || "").trim()).filter((id) => UUID_RE.test(id)))];
  if (!requested.length) return { ok: false, error: "Choose at least one subject.", status: 400 };
  if (requested.length > MAX_PREF_SUBJECTS) return { ok: false, error: "Too many subjects.", status: 400 };

  const subjects = await listPreferenceSubjects();
  const allowed = new Set(subjects.map((s) => s.id));
  const selected = requested.filter((id) => allowed.has(id));
  if (!selected.length) return { ok: false, error: "Choose at least one listed subject.", status: 400 };

  const ip = clientIp(opts.req);
  if (await storeRateLimited(`notes_pref:ip:${ip}`, PREFERENCE_IP_MAX, PREFERENCE_IP_WINDOW_SEC)) {
    return { ok: false, error: "Too many requests. Please try again later.", status: 429 };
  }

  const voter = getOrCreateInterestVoterId();
  if (await storeRateLimited(`notes_pref:voter:${voter.hash}`, PREFERENCE_VOTER_MAX, PREFERENCE_VOTER_WINDOW_SEC)) {
    return { ok: false, error: "Too many requests. Please try again later.", status: 429 };
  }

  const db = storeDb();
  if (!db) return { ok: false, error: "Unable to save preferences right now.", status: 503 };

  const source = sanitizePreferenceSource(opts.source);
  const { data: existing } = await db
    .from("store_interest_submissions")
    .select("id")
    .eq("voter_hash", voter.hash)
    .maybeSingle();

  let submissionId = existing?.id as string | undefined;
  let updated = false;
  if (submissionId) {
    const { error } = await db
      .from("store_interest_submissions")
      .update({ source, updated_at: new Date().toISOString() })
      .eq("id", submissionId);
    if (error) return { ok: false, error: "Unable to save preferences right now.", status: 500 };
    const { error: delErr } = await db.from("store_interest_submission_subjects").delete().eq("submission_id", submissionId);
    if (delErr) return { ok: false, error: "Unable to save preferences right now.", status: 500 };
    updated = true;
  } else {
    const { data: created, error } = await db
      .from("store_interest_submissions")
      .insert({ voter_hash: voter.hash, source })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "Unable to save preferences right now.", status: 500 };
    submissionId = created.id;
  }

  const { error: insErr } = await db
    .from("store_interest_submission_subjects")
    .insert(selected.map((category_id) => ({ submission_id: submissionId, category_id })));
  if (insErr) return { ok: false, error: "Unable to save preferences right now.", status: 500 };

  const chosen = subjects.filter((s) => selected.includes(s.id));
  return {
    ok: true,
    updated,
    selected,
    available: chosen.filter((s) => s.available),
    waitlist: chosen.filter((s) => !s.available),
  };
}

export interface PreferenceTrendPoint {
  date: string;
  submissions: number;
}

export interface PreferenceIntelligence {
  total_submissions: number;
  unique_respondents: number;
  subjects: Array<
    PreferenceSubject & {
      raw_count: number;
      available_demand: number;
      unavailable_demand: number;
    }
  >;
  pairs: Array<ReturnType<typeof computeCoSelections>["pairs"][number] & { a_name: string; b_name: string }>;
  trios: Array<ReturnType<typeof computeCoSelections>["trios"][number] & { names: string[] }>;
  also_selected: Record<string, Array<{ id: string; name: string; count: number; pct: number }>>;
  trend: PreferenceTrendPoint[];
}

export async function listPreferenceIntelligence(): Promise<PreferenceIntelligence> {
  const db = storeDb();
  const empty: PreferenceIntelligence = {
    total_submissions: 0,
    unique_respondents: 0,
    subjects: [],
    pairs: [],
    trios: [],
    also_selected: {},
    trend: [],
  };
  if (!db) return empty;

  const [subjects, { data: submissions }, { data: rows }] = await Promise.all([
    listPreferenceSubjects(),
    db.from("store_interest_submissions").select("id,created_at,updated_at"),
    db.from("store_interest_submission_subjects").select("submission_id,category_id"),
  ]);

  const bySubmission = new Map<string, string[]>();
  const raw = new Map<string, number>();
  for (const row of rows || []) {
    const sid = String(row.submission_id);
    const cid = String(row.category_id);
    const list = bySubmission.get(sid) || [];
    list.push(cid);
    bySubmission.set(sid, list);
    raw.set(cid, (raw.get(cid) || 0) + 1);
  }
  const co = computeCoSelections([...bySubmission.values()]);
  const nameOf = (id: string) => subjects.find((s) => s.id === id)?.name || id;

  const trendMap = new Map<string, number>();
  for (const sub of submissions || []) {
    const day = String(sub.created_at || "").slice(0, 10);
    if (!day) continue;
    trendMap.set(day, (trendMap.get(day) || 0) + 1);
  }
  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, submissionsCount]) => ({ date, submissions: submissionsCount }));

  return {
    total_submissions: submissions?.length || 0,
    unique_respondents: submissions?.length || 0,
    subjects: subjects.map((s) => ({
      ...s,
      raw_count: raw.get(s.id) || 0,
      available_demand: s.available ? raw.get(s.id) || 0 : 0,
      unavailable_demand: s.available ? 0 : raw.get(s.id) || 0,
    })),
    pairs: co.pairs.slice(0, 12).map((p) => ({ ...p, a_name: nameOf(p.a), b_name: nameOf(p.b) })),
    trios: co.trios.slice(0, 8).map((t) => ({ ...t, names: t.ids.map(nameOf) })),
    also_selected: Object.fromEntries(
      Object.entries(co.also_selected).map(([id, list]) => [
        id,
        list.slice(0, 5).map((row) => ({ ...row, name: nameOf(row.id) })),
      ]),
    ),
    trend,
  };
}
