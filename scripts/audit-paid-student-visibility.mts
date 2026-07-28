/**
 * READ-ONLY forensics: paid students that staff cannot see or open.
 *
 * Answers, with real counts (a proven zero is a result):
 *   - which paid people have no buyers row / no login code / no STUDENTS row
 *   - which enrollments point at a missing course or batch
 *   - where exact-phone joins disagree with last-10-digit joins
 *
 * Performs no writes and sends nothing. All PII is masked in output.
 *   npx tsx scripts/audit-paid-student-visibility.mts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const digits10 = (v: string | null | undefined) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
};
const maskPhone = (v: string | null | undefined) => {
  const d = digits10(v);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(8)}` : d ? `${d.slice(0, 2)}***` : "(none)";
};
const maskName = (v: string | null | undefined) => {
  const parts = String(v ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "(none)";
  return `${parts[0]} ${parts.slice(1).map((p) => `${p[0]}.`).join(" ")}`.trim();
};
const maskId = (v: string | null | undefined) => (v ? String(v).slice(0, 8) : "(null)");

async function all<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

type Enr = {
  id: string; phone: string | null; student_name: string | null; course_id: string | null;
  course_title: string | null; batch_label: string | null; status: string;
  total_fee: number | null; amount_paid: number | null; created_at: string; email?: string | null;
};
type Buyer = { id: string; phone: string | null; name: string | null; login_code: string | null; last_seen_at: string | null; created_at: string };
type Student = { id: string; phone: string | null; name: string | null; access_code: string | null; created_at: string; is_active: boolean | null };

(async () => {
  const [enr, buyers, students, courses, pays] = await Promise.all([
    all<Enr>("course_enrollments", "id,phone,student_name,course_id,course_title,batch_label,status,total_fee,amount_paid,created_at"),
    all<Buyer>("buyers", "id,phone,name,login_code,last_seen_at,created_at"),
    all<Student>("students", "id,phone,name,access_code,created_at,is_active"),
    all<{ id: string; title: string | null }>("courses", "id,title"),
    all<{ id: string; phone: string | null; status: string | null; amount: number | null }>("payments", "id,phone,status,amount"),
  ]);

  console.log(`\n=== ROW COUNTS ===`);
  console.table([{ course_enrollments: enr.length, buyers: buyers.length, students: students.length, courses: courses.length, payments: pays.length }]);

  // Index both ways: EXACT (what the app does) and last-10-digit (normalised).
  const buyerExact = new Map(buyers.map((b) => [String(b.phone ?? "").trim(), b]));
  const buyerNorm = new Map(buyers.map((b) => [digits10(b.phone), b]));
  const studentExact = new Map(students.map((s) => [String(s.phone ?? "").trim(), s]));
  const studentNorm = new Map(students.map((s) => [digits10(s.phone), s]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const isPaid = (e: Enr) => (e.amount_paid ?? 0) > 0 || e.status === "fully_paid";
  const isActive = (e: Enr) => e.status !== "cancelled" && ((e.amount_paid ?? 0) > 0 || e.status === "fully_paid");

  console.log(`\n=== STATUS DISTRIBUTION ===`);
  const byStatus = new Map<string, { status: string; count: number; with_payment: number; zero_paid: number }>();
  for (const e of enr) {
    const r = byStatus.get(e.status) ?? { status: e.status, count: 0, with_payment: 0, zero_paid: 0 };
    r.count++;
    if ((e.amount_paid ?? 0) > 0) r.with_payment++; else r.zero_paid++;
    byStatus.set(e.status, r);
  }
  console.table([...byStatus.values()].sort((a, b) => b.count - a.count));

  console.log(`\n=== SWEEP: BROKEN CHAIN CATEGORIES (exact-phone join = what the app does) ===`);
  const paid = enr.filter(isPaid);
  const cat = (label: string, rows: unknown[]) => ({ category: label, count: rows.length });

  const noBuyerExact = paid.filter((e) => !buyerExact.get(String(e.phone ?? "").trim()));
  const noBuyerNorm = paid.filter((e) => !buyerNorm.get(digits10(e.phone)));
  const noStudentExact = paid.filter((e) => !studentExact.get(String(e.phone ?? "").trim()));
  const noStudentNorm = paid.filter((e) => !studentNorm.get(digits10(e.phone)));
  const blankCode = buyers.filter((b) => !String(b.login_code ?? "").trim());
  const blankAccessCode = students.filter((s) => !String(s.access_code ?? "").trim());
  const neverSeen = buyers.filter((b) => !b.last_seen_at);
  const nullCourseRef = enr.filter((e) => !e.course_id);
  const orphanCourseRef = enr.filter((e) => e.course_id && !courseById.get(e.course_id));
  const nullBatch = enr.filter((e) => !String(e.batch_label ?? "").trim());
  const nullPhone = enr.filter((e) => !digits10(e.phone));
  const fullyPaidZero = enr.filter((e) => e.status === "fully_paid" && (e.amount_paid ?? 0) === 0);
  const seatBooked = enr.filter((e) => e.status === "seat_booked");
  const seatBookedPaid = seatBooked.filter((e) => (e.amount_paid ?? 0) > 0);

  console.table([
    cat("paid enrollment, NO buyers row (exact phone)", noBuyerExact),
    cat("paid enrollment, NO buyers row (last-10 digits)", noBuyerNorm),
    cat("paid enrollment, NO students row (exact phone)", noStudentExact),
    cat("paid enrollment, NO students row (last-10 digits)", noStudentNorm),
    cat("buyers with null/blank login_code", blankCode),
    cat("students with null/blank access_code", blankAccessCode),
    cat("buyers never logged in (last_seen_at null)", neverSeen),
    cat("enrollment with null course_id", nullCourseRef),
    cat("enrollment with orphaned course_id", orphanCourseRef),
    cat("enrollment with null/blank batch_label", nullBatch),
    cat("enrollment with unusable phone", nullPhone),
    cat("fully_paid but amount_paid = 0", fullyPaidZero),
    cat("status = seat_booked (total)", seatBooked),
    cat("status = seat_booked AND paid", seatBookedPaid),
  ]);

  console.log(`\n=== PHONE-FORMAT DRIFT (exact join fails where normalised join succeeds) ===`);
  const drift = paid.filter(
    (e) => !studentExact.get(String(e.phone ?? "").trim()) && studentNorm.get(digits10(e.phone)),
  );
  const driftB = paid.filter(
    (e) => !buyerExact.get(String(e.phone ?? "").trim()) && buyerNorm.get(digits10(e.phone)),
  );
  console.table([
    { join: "course_enrollments -> students", exact_misses_but_normalised_hits: drift.length },
    { join: "course_enrollments -> buyers", exact_misses_but_normalised_hits: driftB.length },
  ]);

  console.log(`\n=== AFFECTED POPULATION: paid people with NO students row (invisible in Students & Enrollments) ===`);
  if (!noStudentNorm.length) {
    console.log("  none");
  } else {
    console.table(
      noStudentNorm
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((e) => ({
          enrollment: maskId(e.id),
          name: maskName(e.student_name),
          phone: maskPhone(e.phone),
          status: e.status,
          paid: e.amount_paid ?? 0,
          fee: e.total_fee ?? 0,
          course: (e.course_title ?? "(null)").slice(0, 34),
          batch: (e.batch_label ?? "(null)").slice(0, 24),
          has_buyer: buyerNorm.has(digits10(e.phone)) ? "yes" : "NO",
          login_code: buyerNorm.get(digits10(e.phone))?.login_code ? "present" : "MISSING",
          created: e.created_at.slice(0, 10),
        })),
    );
  }

  console.log(`\n=== ALL seat_booked ENROLLMENTS (visibility check) ===`);
  console.table(
    seatBooked
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((e) => ({
        enrollment: maskId(e.id),
        name: maskName(e.student_name),
        phone: maskPhone(e.phone),
        paid: e.amount_paid ?? 0,
        fee: e.total_fee ?? 0,
        in_students: studentNorm.has(digits10(e.phone)) ? "yes" : "NO",
        in_buyers: buyerNorm.has(digits10(e.phone)) ? "yes" : "NO",
        code: buyerNorm.get(digits10(e.phone))?.login_code ? "yes" : "NO",
        last_seen: buyerNorm.get(digits10(e.phone))?.last_seen_at?.slice(0, 10) ?? "never",
        created: e.created_at.slice(0, 10),
      })),
  );

  console.log(`\n=== DUPLICATE PHONES (flag only, never auto-merge) ===`);
  const dupe = (label: string, rows: { phone: string | null }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) { const d = digits10(r.phone); if (d) m.set(d, (m.get(d) ?? 0) + 1); }
    return [...m.entries()].filter(([, n]) => n > 1).map(([d, n]) => ({ table: label, phone: maskPhone(d), rows: n }));
  };
  const dupes = [...dupe("students", students), ...dupe("buyers", buyers)];
  if (dupes.length) console.table(dupes); else console.log("  none");

  console.log(`\n=== SUBJECT RECORD: the reported case ===`);
  const subject = enr.find((e) => e.id === "9f1b2e1b-b8f7-47a6-a53f-5cf8c42ae13f")
    ?? enr.find((e) => /tript?i\s*jain/i.test(e.student_name ?? ""));
  if (!subject) { console.log("  NOT FOUND"); return; }
  const sPhone = digits10(subject.phone);
  const sBuyer = buyerNorm.get(sPhone) ?? null;
  const sStudent = studentNorm.get(sPhone) ?? null;
  console.table([{
    enrollment_id: subject.id,
    name: maskName(subject.student_name),
    phone: maskPhone(subject.phone),
    phone_stored_format: String(subject.phone ?? "").replace(/\d(?=\d{2})/g, "#"),
    status: subject.status,
    total_fee: subject.total_fee,
    amount_paid: subject.amount_paid,
    course_id_resolves: subject.course_id ? (courseById.has(subject.course_id) ? "yes" : "ORPHAN") : "NULL",
    batch_label: subject.batch_label,
    created_at: subject.created_at,
  }]);
  console.table([{
    buyers_row: sBuyer ? maskId(sBuyer.id) : "MISSING",
    login_code: sBuyer?.login_code ? "present" : "MISSING",
    buyer_last_seen_at: sBuyer?.last_seen_at ?? "never",
    students_row: sStudent ? maskId(sStudent.id) : "MISSING  <-- not visible/openable in Students & Enrollments",
    students_access_code: sStudent?.access_code ? "present" : "n/a",
  }]);

  const { data: sms } = await db.from("sms_logs").select("trigger_event,template_id,status,created_at,mobile").ilike("mobile", `%${sPhone}%`).order("created_at");
  console.log(`\n=== SUBJECT SMS HISTORY (${(sms ?? []).length} rows) ===`);
  if ((sms ?? []).length) {
    console.table((sms ?? []).map((s: Record<string, unknown>) => ({
      trigger: s.trigger_event, template: s.template_id, status: s.status, at: String(s.created_at).slice(0, 19),
    })));
  } else console.log("  none");

  const sPays = pays.filter((p) => digits10(p.phone) === sPhone);
  console.log(`\n=== SUBJECT PAYMENTS (${sPays.length} rows) ===`);
  if (sPays.length) console.table(sPays.map((p) => ({ id: maskId(p.id), status: p.status, amount: p.amount }))); else console.log("  none");
})().catch((e) => { console.error(e); process.exit(1); });
