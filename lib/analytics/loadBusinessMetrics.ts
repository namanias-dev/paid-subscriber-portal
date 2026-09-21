/**
 * Load the inputs for {@link computePeople}. Money and admissions stay in memory
 * on the payment/enrollment arrays the digest already fetched — this module only
 * reads identity and activity, and returns null for a section whose query failed
 * so the report does not print a fake zero.
 */
import { getSupabaseAdmin } from "../supabase";
import type { _RangeablePage } from "../dataProvider";
import { getStaffPhoneSet } from "./queries";
import { normPhone } from "../phone";
import { LEADERBOARD_EXCLUDED_STUDENT_IDS } from "../leaderboardExclusions";
import { tgLog } from "../telegram/log";
import {
  computePeople,
  inWindow,
  personKey,
  type PeopleMetrics,
  type TimeWindow,
} from "./businessMetrics";

const ACTIVITY_AND_LOGIN = [
  "login",
  "portal_active",
  "course_opened",
  "zoom_link_clicked",
  "enrolled_card_viewed",
] as const;

interface EventRow {
  event_name: string;
  buyer_id: string | null;
  phone: string | null;
  props: { student_id?: string | null } | null;
  occurred_at: string;
}

interface AccessRow {
  student_id: string | null;
  timestamp: string;
}

interface BuyerRow {
  id: string;
  phone: string | null;
  is_staff?: boolean | null;
  is_lead?: boolean | null;
  created_at: string;
}

interface StudentRow {
  id: string;
  phone: string | null;
  created_at: string;
}

/** Fail closed: a query error returns null so the report omits the metric instead of under-counting. */
async function selectChecked<T>(label: string, build: () => _RangeablePage): Promise<T[] | null> {
  const out: T[] = [];
  try {
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error } = await build().range(from, from + 999);
      const err = error as { message?: string } | null;
      if (err) {
        tgLog("business_metrics_query_failed", { label, error: err.message || "query_failed" }, "warn");
        return null;
      }
      const rows = (data as T[]) ?? [];
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  } catch (e) {
    tgLog("business_metrics_query_failed", { label, error: (e as Error).message }, "warn");
    return null;
  }
  tgLog("business_metrics_query_failed", { label, error: "row_cap" }, "warn");
  return null;
}

export interface ReportExclusions {
  /** Admin, staff-test buyers, and documented internal students. Used for money and students. */
  staffPhones: Set<string>;
  /** Quiz-only leads. Excluded from student activity, not from money (a paid lead is a real collection). */
  leadPhones: Set<string>;
}

export async function loadReportExclusions(): Promise<ReportExclusions> {
  const staffPhones = new Set<string>();
  const leadPhones = new Set<string>();
  try {
    const staff = await getStaffPhoneSet();
    for (const p of staff) staffPhones.add(p);
  } catch {
    /* admin phone list is best-effort; is_staff still applies below */
  }
  const db = getSupabaseAdmin();
  if (!db) return { staffPhones, leadPhones };

  const { data: flagged, error } = await db
    .from("buyers")
    .select("phone,is_staff,is_lead")
    .or("is_staff.eq.true,is_lead.eq.true");
  if (!error && flagged) {
    for (const row of flagged as { phone?: string | null; is_staff?: boolean; is_lead?: boolean }[]) {
      const ph = normPhone(row.phone);
      if (!ph) continue;
      if (row.is_staff) staffPhones.add(ph);
      if (row.is_lead) leadPhones.add(ph);
    }
  }

  const ids = [...LEADERBOARD_EXCLUDED_STUDENT_IDS];
  if (ids.length) {
    const { data: internal } = await db.from("students").select("phone").in("id", ids);
    for (const row of (internal || []) as { phone?: string | null }[]) {
      const ph = normPhone(row.phone);
      if (ph) staffPhones.add(ph);
    }
  }
  return { staffPhones, leadPhones };
}

function excludedPerson(
  keyParts: { phone?: string | null; buyerId?: string | null; studentId?: string | null },
  staffPhones: Set<string>,
  leadBuyerIds: Set<string>,
  staffBuyerIds: Set<string>,
): boolean {
  const ph = normPhone(keyParts.phone);
  if (ph && staffPhones.has(ph)) return true;
  if (keyParts.buyerId && (leadBuyerIds.has(keyParts.buyerId) || staffBuyerIds.has(keyParts.buyerId))) {
    return true;
  }
  if (keyParts.studentId && LEADERBOARD_EXCLUDED_STUDENT_IDS.has(keyParts.studentId)) return true;
  return false;
}

/**
 * People metrics for one IST window.
 * `excludedPhones` should already contain staff, current leads, and documented
 * internal students. Lead/staff buyer ids are loaded here for events that have
 * a buyer id but no phone.
 */
export async function loadPeopleMetrics(
  window: TimeWindow,
  exclusions: ReportExclusions,
): Promise<PeopleMetrics> {
  const excludedPhones = new Set<string>([...exclusions.staffPhones, ...exclusions.leadPhones]);
  const db = getSupabaseAdmin();
  if (!db) {
    return computePeople({ newAccountKeys: null, loginEventKeys: null, activityKeys: null });
  }

  const fromIso = new Date(window.fromMs).toISOString();
  const toIso = new Date(window.toMs).toISOString();

  const [events, access, newBuyers, newStudents, flaggedBuyers] = await Promise.all([
    selectChecked<EventRow>("activity_events", () =>
      db
        .from("analytics_events")
        .select("event_name,buyer_id,phone,props,occurred_at")
        .in("event_name", [...ACTIVITY_AND_LOGIN])
        .gte("occurred_at", fromIso)
        .lt("occurred_at", toIso)
        .order("occurred_at", { ascending: true })
        .order("event_id", { ascending: true }),
    ),
    selectChecked<AccessRow>("access_logins", () =>
      db
        .from("access_logs")
        .select("student_id,timestamp")
        .eq("action", "login")
        .gte("timestamp", fromIso)
        .lt("timestamp", toIso)
        .order("timestamp", { ascending: true })
        .order("id", { ascending: true }),
    ),
    selectChecked<BuyerRow>("new_buyers", () =>
      db
        .from("buyers")
        .select("id,phone,is_staff,is_lead,created_at")
        .gte("created_at", fromIso)
        .lt("created_at", toIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ),
    selectChecked<StudentRow>("new_students", () =>
      db
        .from("students")
        .select("id,phone,created_at")
        .gte("created_at", fromIso)
        .lt("created_at", toIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ),
    selectChecked<Pick<BuyerRow, "id" | "is_staff" | "is_lead">>("flagged_buyers", () =>
      db
        .from("buyers")
        .select("id,is_staff,is_lead")
        .or("is_staff.eq.true,is_lead.eq.true")
        .order("id", { ascending: true }),
    ),
  ]);

  const leadBuyerIds = new Set<string>();
  const staffBuyerIds = new Set<string>();
  if (flaggedBuyers) {
    for (const b of flaggedBuyers) {
      if (b.is_staff) staffBuyerIds.add(b.id);
      if (b.is_lead) leadBuyerIds.add(b.id);
    }
  }

  let newAccountKeys: string[] | null = null;
  if (newBuyers && newStudents) {
    const keys: string[] = [];
    const buyerPhones = new Set<string>();
    for (const b of newBuyers) {
      if (!inWindow(b.created_at, window)) continue;
      if (b.is_staff || b.is_lead) continue;
      const key = personKey({ phone: b.phone, buyerId: b.id });
      if (!key) continue;
      if (excludedPerson({ phone: b.phone, buyerId: b.id }, excludedPhones, leadBuyerIds, staffBuyerIds)) {
        continue;
      }
      keys.push(key);
      const ph = normPhone(b.phone);
      if (ph) buyerPhones.add(ph);
    }

    const studentPhones = [...new Set(newStudents.map((s) => normPhone(s.phone)).filter(Boolean))] as string[];
    const existingBuyerPhones = new Set<string>();
    let studentMatchFailed = false;
    if (studentPhones.length) {
      const variants = studentPhones.flatMap((d) => [d, `+91${d}`, `91${d}`]);
      const { data, error } = await db.from("buyers").select("phone").in("phone", variants);
      if (error) {
        tgLog("business_metrics_query_failed", { label: "student_buyer_match", error: error.message }, "warn");
        studentMatchFailed = true;
      } else {
        for (const row of (data || []) as { phone?: string | null }[]) {
          const ph = normPhone(row.phone);
          if (ph) existingBuyerPhones.add(ph);
        }
      }
    }
    for (const s of newStudents) {
      if (!inWindow(s.created_at, window)) continue;
      if (LEADERBOARD_EXCLUDED_STUDENT_IDS.has(s.id)) continue;
      const ph = normPhone(s.phone);
      if (ph && (buyerPhones.has(ph) || existingBuyerPhones.has(ph) || excludedPhones.has(ph))) continue;
      const key = personKey({ phone: s.phone, studentId: s.id });
      if (key) keys.push(key);
    }
    newAccountKeys = studentMatchFailed ? null : keys;
  }

  const studentIds = new Set<string>();
  if (access) {
    for (const row of access) if (row.student_id) studentIds.add(row.student_id);
  }
  const studentPhone = new Map<string, string | null>();
  if (access && studentIds.size) {
    const { data, error } = await db
      .from("students")
      .select("id,phone")
      .in("id", [...studentIds]);
    if (error) {
      tgLog("business_metrics_query_failed", { label: "access_student_phones", error: error.message }, "warn");
      // Can't attribute dashboard logins — treat login source as failed rather than drop them silently.
      return computePeople({
        newAccountKeys,
        loginEventKeys: null,
        activityKeys: null,
      });
    }
    for (const row of (data || []) as { id: string; phone: string | null }[]) {
      studentPhone.set(row.id, row.phone);
    }
  }

  let loginEventKeys: string[] | null = null;
  let activityKeys: string[] | null = null;
  if (events && access) {
    const logins: string[] = [];
    const activity: string[] = [];
    for (const e of events) {
      if (!inWindow(e.occurred_at, window)) continue;
      const studentId = e.props?.student_id || null;
      if (
        excludedPerson(
          { phone: e.phone, buyerId: e.buyer_id, studentId },
          excludedPhones,
          leadBuyerIds,
          staffBuyerIds,
        )
      ) {
        continue;
      }
      const key = personKey({ phone: e.phone, buyerId: e.buyer_id, studentId });
      if (!key) continue;
      if (e.event_name === "login") logins.push(key);
      else activity.push(key);
    }
    for (const row of access) {
      if (!inWindow(row.timestamp, window)) continue;
      const sid = row.student_id;
      if (!sid || LEADERBOARD_EXCLUDED_STUDENT_IDS.has(sid)) continue;
      const phone = studentPhone.get(sid) || null;
      if (excludedPerson({ phone, studentId: sid }, excludedPhones, leadBuyerIds, staffBuyerIds)) continue;
      const key = personKey({ phone, studentId: sid });
      if (key) logins.push(key);
    }
    loginEventKeys = logins;
    activityKeys = activity;
  }

  return computePeople({ newAccountKeys, loginEventKeys, activityKeys });
}
