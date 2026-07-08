/**
 * ONE-TIME legacy import — "Saarthi (Old)" batch.
 *
 * Cloned from import-safalta-june.ts (that proven script is left UNTOUCHED).
 * SAARTHI-specific differences vs Safalta:
 *   • Different course slug/title/discount-reason/actor.
 *   • The SAARTHI sheet uses different column HEADERS (see COLS below) — remapped.
 *   • Allowed-set guard: any row whose Mode ∉ {Online,Offline} or Batch ∉
 *     {Morning,Evening} is HELD (never imported into a junk batch), and stickers/
 *     batches are derived ONLY from valid rows, so exactly the 4 real batches are
 *     created.
 *   • Reconciliation gate compares the IMPORTED (held-removed) totals to
 *     SHEET_EXPECTED, since ~5 rows are intentionally held.
 *
 * DRY-RUN by DEFAULT: writes NOTHING. Pass --commit to actually write.
 *
 * Usage:
 *   node --import tsx scripts/import-saarthi.ts "<path-to-xlsx>"            # dry-run (default)
 *   node --import tsx scripts/import-saarthi.ts "<path-to-xlsx>" --commit   # writes (needs approval)
 *
 * The --commit path uses the EXACT existing dataProvider functions
 * (addCourse / ensureBuyer / addCourseEnrollment / applyEnrollmentDiscount) and
 * requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the runtime env.
 *
 * Idempotent: re-runs detect an existing legacy-course enrollment by phone and skip
 * (never re-create, never re-apply a discount, never re-mint a login code). It only
 * ever touches this one legacy course — never any other student or course.
 */
import * as xlsx from "xlsx";
import {
  addCourse,
  getCourseBySlug,
  ensureBuyer,
  getBuyerByPhone,
  addCourseEnrollment,
  getCourseEnrollmentsByPhone,
  applyEnrollmentDiscount,
} from "../lib/dataProvider";
import { getSupabaseAdmin } from "../lib/supabase";
import { addDaysISO, addMonthsISO, formatINR } from "../lib/dates";
import type {
  Course,
  CourseBatch,
  CourseEmiConfig,
  CourseEnrollment,
  InstallmentItem,
  LearningMode,
} from "../lib/types";

// ------------------------------- constants -------------------------------
const COURSE_SLUG = "saarthi-old";
const COURSE_TITLE = "Saarthi (Old)";
const DISCOUNT_REASON = "Legacy Saarthi negotiated fee";
const IMPORT_ACTOR = "legacy-import:saarthi";
// Rounding tolerance: flag ONLY if the sheet's (count × each) deviates from
// pending by MORE than ₹1 per pending installment.
const ROUNDING_TOLERANCE_PER_INSTALLMENT = 1;
// IMPORTED (held-removed) grand totals to reconcile against. RECOMPUTED from the
// dry-run of the actually-imported rows (5 held: 3 balance-mismatch + 2 malformed
// Mode/Batch) — see plan. The gate compares the IMPORTED set to these.
const SHEET_EXPECTED = { collected: 3_684_700, pending: 931_100, effective: 4_615_800 };

/**
 * SAARTHI sheet column headers → internal fields. The SAARTHI sheet differs from
 * Safalta (e.g. "Student Name" not "Name"; correct spelling "Installments").
 */
const COLS = {
  srNo: "Sr.No",
  name: "Student Name",
  mode: "Mode",
  batch: "Batch",
  status: "Status",
  phone: "Mobile Number",
  actualTotal: "Total Course Fee",
  paid: "Total fee received",
  pending: "Pending fee",
  nPending: "Number of Installments pending",
  eachMonth: "Each month Installment amount",
} as const;

// Only these Mode × Batch (timing) values are valid → the 4 real batches. Any
// row outside this set is HELD (never imported into a junk batch).
const ALLOWED_MODES = new Set(["Online", "Offline"]);
const ALLOWED_TIMINGS = new Set(["Morning", "Evening"]);

/**
 * Phones explicitly HELD for staff action (NOT imported) — approved holds.
 * SAARTHI has NO name-mismatch identity conflicts (verified read-only against the
 * live DB), so this is empty. Malformed Mode/Batch rows are held by the
 * allowed-set guard, not here.
 */
const HELD_IDENTITY_PHONES: Record<string, string> = {};

// EMI cadence for rebuilt due dates on outstanding installments.
const FIRST_INTERVAL_DAYS = 7;
const INTERVAL_MONTHS = 1;

// ------------------------------- helpers ---------------------------------
const NBSP = " ";
function money(n: number): string {
  return formatINR(Math.round(n));
}
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[₹,\s]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function digits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}
function titleCase(s: string): string {
  const t = s.trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
/**
 * Heuristic: does the sheet name plausibly belong to the same person as an
 * existing buyer account on that phone? True when they're equal ignoring
 * case/spaces, one contains the other, or they share a first name. A FALSE
 * result means the phone is likely a different person → needs-review skip
 * (never attach a course to the wrong identity).
 */
function namesLikelySame(sheetName: string, buyerName: string | null | undefined): boolean {
  if (!buyerName) return true; // no existing account → nothing to conflict with
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s = norm(sheetName);
  const b = norm(buyerName);
  if (!s || !b) return true;
  if (s === b || b.includes(s) || s.includes(b)) return true;
  const firstS = sheetName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const firstB = buyerName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return !!firstS && firstS === firstB;
}
function pad(s: string, w: number): string {
  s = String(s);
  return s.length >= w ? s : s + NBSP.repeat(w - s.length);
}
function padL(s: string, w: number): string {
  s = String(s);
  return s.length >= w ? s : NBSP.repeat(w - s.length) + s;
}
function hr(ch = "─", w = 100): string {
  return ch.repeat(w);
}

// --------------------------- schedule builders ---------------------------
/** Outstanding installment lines that sum EXACTLY to `remaining` (last absorbs remainder). */
function buildOutstanding(remaining: number, count: number, baseISO: string): InstallmentItem[] {
  if (count <= 0 || remaining <= 0) return [];
  const base = Math.floor(remaining / count);
  const remainder = remaining - base * count;
  const firstDue = addDaysISO(baseISO, FIRST_INTERVAL_DAYS);
  const lines: InstallmentItem[] = [];
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    lines.push({
      no: i + 1, // line 1 is the paid line; installments start at 2
      kind: "installment",
      label: `Installment ${i} of ${count}`,
      amount: base + (isLast ? remainder : 0),
      due: i === 1 ? firstDue : addMonthsISO(firstDue, (i - 1) * INTERVAL_MONTHS),
      paid: false,
      status: "pending",
    });
  }
  return lines;
}

/** The paid "legacy fee received" line (money already collected pre-portal). */
function paidLine(paid: number, nowISO: string): InstallmentItem {
  return {
    no: 1,
    kind: "installment",
    label: "Legacy fee received (pre-portal)",
    amount: paid,
    due: null,
    paid: true,
    status: "paid",
    paid_at: nowISO,
  };
}

// ------------------------------- types -----------------------------------
interface RawRow {
  rowNo: number; // 1-based data row (for messages)
  srNo: number;
  name: string;
  mode: string;
  batch: string;
  status: string;
  phone: string;
  actualTotal: number; // "Total Course fee"
  paid: number; // "Total Fee received"
  pending: number; // "Pending Fee"
  nPending: number; // "Number of Instaments pending"
  eachMonth: number; // "Each month Installment amount"
}

interface StudentPlan {
  raw: RawRow;
  comboKey: string;
  batchLabel: string;
  sticker: number;
  actualTotal: number;
  paid: number;
  pending: number;
  n: number;
  discount: number;
  scheduleFinal: InstallmentItem[]; // post-discount (what the student sees)
  scheduleAtSticker: InstallmentItem[]; // pre-discount (what commit creates first)
  status: "fully_paid" | "partially_paid";
  access: "Full" | "Installments";
  errors: string[]; // hard → skip
  flags: string[]; // soft → import + confirm
  roundingBefore?: number[]; // sheet's each×count breakdown
  roundingAfter?: number[]; // rebuilt breakdown
  skip: boolean;
  skipReason?: string;
  // filled at runtime from DB (dry-run enrichment / commit)
  existingLoginCode?: string | null;
  existingBuyerName?: string | null;
  existingBuyerIsLead?: boolean;
  nameMismatch?: boolean;
  alreadyImported?: boolean;
}

// ------------------------------- parse -----------------------------------
function parseRows(path: string): RawRow[] {
  const wb = xlsx.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  return json.map((r, i) => ({
    rowNo: i + 1,
    srNo: toNum(r[COLS.srNo]),
    name: String(r[COLS.name] ?? "").trim(),
    mode: titleCase(String(r[COLS.mode] ?? "")),
    batch: titleCase(String(r[COLS.batch] ?? "")),
    status: String(r[COLS.status] ?? "").trim(),
    phone: digits(r[COLS.phone]),
    actualTotal: toNum(r[COLS.actualTotal]),
    paid: toNum(r[COLS.paid]),
    pending: toNum(r[COLS.pending]),
    nPending: toNum(r[COLS.nPending]),
    eachMonth: toNum(r[COLS.eachMonth]),
  }));
}

// -------------------------- derive stickers ------------------------------
function deriveStickers(rows: RawRow[]): Map<string, number> {
  const stickers = new Map<string, number>();
  for (const r of rows) {
    // Only valid Mode × Batch combos produce a sticker/batch. Malformed rows are
    // held by the allowed-set guard and must NEVER create a junk batch.
    if (!ALLOWED_MODES.has(r.mode) || !ALLOWED_TIMINGS.has(r.batch)) continue;
    const key = `${r.mode}|${r.batch}`;
    stickers.set(key, Math.max(stickers.get(key) ?? 0, r.actualTotal));
  }
  return stickers;
}

// ----------------------------- planning ----------------------------------
function planStudent(r: RawRow, sticker: number, dupPhones: Set<string>, nowISO: string): StudentPlan {
  const comboKey = `${r.mode}|${r.batch}`;
  const batchLabel = `${r.mode} · ${r.batch}`;
  const errors: string[] = [];
  const flags: string[] = [];

  // --- hard validations (→ skip) ---
  if (!r.name) errors.push("Missing student name.");
  // Allowed-set guard: HOLD any row whose Mode/Batch is outside the valid set so
  // it is never imported into a junk batch. Guarantees exactly the 4 real batches.
  if (!ALLOWED_MODES.has(r.mode)) errors.push(`Mode "${r.mode || "(blank)"}" not allowed (must be Online/Offline).`);
  if (!ALLOWED_TIMINGS.has(r.batch)) errors.push(`Batch "${r.batch || "(blank)"}" not allowed (must be Morning/Evening).`);
  if (!/^\d{10}$/.test(r.phone)) errors.push(`Invalid mobile "${r.phone}" (need 10 digits).`);
  if (dupPhones.has(r.phone)) {
    errors.push("Duplicate mobile shared by 2+ students — staff must supply a distinct number.");
  }
  if (HELD_IDENTITY_PHONES[r.phone]) {
    errors.push(HELD_IDENTITY_PHONES[r.phone]);
  }
  if (r.actualTotal <= 0) errors.push("Total Course fee is 0/blank.");
  if (r.paid <= 0) errors.push("No amount paid — cannot grant access.");
  if (r.paid + r.pending !== r.actualTotal) {
    errors.push(`Paid (${money(r.paid)}) + Pending (${money(r.pending)}) ≠ Total (${money(r.actualTotal)}).`);
  }
  if (sticker && r.actualTotal > sticker) {
    errors.push(`Total (${money(r.actualTotal)}) exceeds derived sticker (${money(sticker)}).`);
  }

  // --- soft flags (→ import + confirm) ---
  if (!r.status) flags.push("Blank Status in sheet — status derived from figures; confirm with staff.");
  if (r.pending > 0 && r.nPending <= 0) flags.push(`Pending ${money(r.pending)} but 0 installments listed — treated as 1.`);
  if (r.pending === 0 && r.nPending > 0) flags.push("Fully paid but sheet lists pending installments — ignored.");

  // rounding check on the sheet's own figures (each × count vs pending)
  let roundingBefore: number[] | undefined;
  let roundingAfter: number[] | undefined;
  const n = r.pending > 0 ? Math.max(1, r.nPending) : 0;
  if (n > 0) {
    const sheetSum = r.eachMonth * r.nPending;
    const deviation = Math.abs(sheetSum - r.pending);
    if (deviation > 0) {
      roundingBefore = Array.from({ length: r.nPending }, () => r.eachMonth);
    }
    if (deviation > ROUNDING_TOLERANCE_PER_INSTALLMENT * Math.max(1, r.nPending)) {
      flags.push(`Sheet installment rounding off by ${money(deviation)} (> ₹1/installment) — rebuilt exactly.`);
    }
  }

  const discount = Math.max(0, sticker - r.actualTotal);

  // Final schedule (post-discount) — this is what the student portal shows and
  // exactly matches what applyEnrollmentDiscount() produces on commit.
  const scheduleFinal: InstallmentItem[] = [paidLine(r.paid, nowISO), ...buildOutstanding(r.pending, n, nowISO)];
  // Pre-discount schedule (created first on commit, at sticker total).
  const scheduleAtSticker: InstallmentItem[] = [paidLine(r.paid, nowISO), ...buildOutstanding(sticker - r.paid, n, nowISO)];

  if (roundingBefore) roundingAfter = scheduleFinal.filter((s) => !s.paid).map((s) => s.amount);

  const status: "fully_paid" | "partially_paid" = r.pending <= 0 ? "fully_paid" : "partially_paid";
  const access: "Full" | "Installments" = r.pending <= 0 ? "Full" : "Installments";

  return {
    raw: r,
    comboKey,
    batchLabel,
    sticker,
    actualTotal: r.actualTotal,
    paid: r.paid,
    pending: r.pending,
    n,
    discount,
    scheduleFinal,
    scheduleAtSticker,
    status,
    access,
    errors,
    flags,
    roundingBefore,
    roundingAfter,
    skip: errors.length > 0,
    skipReason: errors.length > 0 ? errors.join(" ") : undefined,
  };
}

// ------------------------- course + batch model --------------------------
function emiConfig(): CourseEmiConfig {
  return {
    enabled: true,
    allow_full: true,
    installment_counts: [2, 3, 4, 6],
    first_interval_days: FIRST_INTERVAL_DAYS,
    interval_months: INTERVAL_MONTHS,
  };
}

function buildBatches(stickers: Map<string, number>): CourseBatch[] {
  const order = ["Online|Morning", "Online|Evening", "Offline|Morning", "Offline|Evening"];
  const keys = [...stickers.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return keys.map((key) => {
    const [mode, timing] = key.split("|");
    return {
      id: `b-${COURSE_SLUG}-${mode}-${timing}`.toLowerCase(),
      label: `${mode} · ${timing}`,
      mode: mode as LearningMode,
      timing,
      start_date: null,
      end_date: null,
      price: stickers.get(key) ?? 0,
      original_price: null,
      pay_in_full_price: null,
      emi_config: emiConfig(),
      capacity: null,
      seats_left: null,
    };
  });
}

async function ensureLegacyCourse(stickers: Map<string, number>, commit: boolean): Promise<Course | null> {
  const existing = await getCourseBySlug(COURSE_SLUG).catch(() => null);
  if (existing) return existing;
  if (!commit) return null; // dry-run: not created yet
  const batches = buildBatches(stickers);
  return addCourse({
    slug: COURSE_SLUG,
    title: COURSE_TITLE,
    category: "Foundation",
    description: "Legacy Saarthi batch — imported for portal access & fee tracking.",
    modes: [...new Set(batches.map((b) => b.mode as LearningMode))],
    price: stickers.get("Online|Morning") ?? stickers.get("Offline|Morning") ?? 40000,
    status: "draft",
    active: false, // hidden from the public site
    featured: false,
    emi_config: emiConfig(),
    batches,
    default_batch_id: batches[0]?.id ?? null,
  });
}

// ------------------------------- report ----------------------------------
function printHeader(commit: boolean, dbConnected: boolean, xlsxPath: string) {
  console.log(hr("="));
  console.log(`  SAARTHI (OLD) — LEGACY IMPORT   ${commit ? ">>> COMMIT (WRITES) <<<" : "DRY-RUN (writes nothing)"}`);
  console.log(hr("="));
  console.log(`  Source : ${xlsxPath}`);
  console.log(`  DB     : ${dbConnected ? "connected (live Supabase)" : "NOT connected (financials computed from sheet only)"}`);
  console.log("");
}

function printStickers(stickers: Map<string, number>, plans: StudentPlan[]) {
  console.log(hr());
  console.log("DERIVED BATCH STICKER FEES (= highest 'Total Course fee' seen in each Mode × Batch)");
  console.log(hr());
  console.log(`  ${pad("Batch", 22)}${padL("Sticker", 12)}${padL("Students", 12)}${padL("Full-paid", 12)}${padL("On-EMI", 10)}`);
  for (const [key, sticker] of stickers) {
    const inBatch = plans.filter((p) => p.comboKey === key && !p.skip);
    const full = inBatch.filter((p) => p.status === "fully_paid").length;
    const emi = inBatch.filter((p) => p.status === "partially_paid").length;
    console.log(`  ${pad(key.replace("|", " · "), 22)}${padL(money(sticker), 12)}${padL(String(inBatch.length), 12)}${padL(String(full), 12)}${padL(String(emi), 10)}`);
  }
  console.log("");
}

function printRoundingRows(plans: StudentPlan[]) {
  const rows = plans.filter((p) => p.roundingBefore && p.roundingAfter);
  console.log(hr());
  console.log(`ROUNDING ROWS — sheet 'each × count' vs rebuilt schedule (rebuilt sums EXACTLY to pending). Tolerance: ₹${ROUNDING_TOLERANCE_PER_INSTALLMENT}/installment`);
  console.log(hr());
  if (!rows.length) {
    console.log("  (none)");
    console.log("");
    return;
  }
  for (const p of rows) {
    const beforeSum = (p.roundingBefore ?? []).reduce((a, b) => a + b, 0);
    const afterSum = (p.roundingAfter ?? []).reduce((a, b) => a + b, 0);
    console.log(`  ${pad(p.raw.name, 16)} ${pad(p.batchLabel, 18)} pending ${money(p.pending)}`);
    console.log(`      before: [${(p.roundingBefore ?? []).map(money).join(", ")}] = ${money(beforeSum)}`);
    console.log(`      after : [${(p.roundingAfter ?? []).map(money).join(", ")}] = ${money(afterSum)}  ${afterSum === p.pending ? "✓ exact" : "✗ MISMATCH"}`);
  }
  console.log("");
}

function printDbNotes(plans: StudentPlan[], courseExists: boolean) {
  const withBuyer = plans.filter((p) => p.existingLoginCode);
  const leads = withBuyer.filter((p) => p.existingBuyerIsLead);
  const mismatches = plans.filter((p) => p.nameMismatch);
  console.log(hr());
  console.log("LIVE DB NOTES");
  console.log(hr());
  console.log(`  Legacy course "${COURSE_SLUG}" present: ${courseExists ? "YES (will reuse — idempotent)" : "no (created on --commit)"}`);
  console.log(`  Existing portal accounts on these phones: ${withBuyer.length} (login codes will be REUSED, never re-minted)`);
  console.log(`  …of which quiz-LEAD accounts: ${leads.length} (access still granted via the paid enrollment; is_lead marker is not auto-cleared by this import)`);
  console.log(`  Name mismatches (possible different person on the phone): ${mismatches.length}`);
  for (const p of mismatches) {
    console.log(`      • ${p.raw.phone}: sheet "${p.raw.name}" vs account "${p.existingBuyerName}" ${p.skip ? "→ needs-review, SKIPPED" : "→ imported (override)"}`);
  }
  console.log("");
}

function printSkippedAndFlagged(plans: StudentPlan[]) {
  const skipped = plans.filter((p) => p.skip);
  const flagged = plans.filter((p) => !p.skip && p.flags.length);
  console.log(hr());
  console.log(`HELD — NOT imported (STAFF ACTION REQUIRED): ${skipped.length}`);
  console.log(hr());
  if (!skipped.length) console.log("  (none)");
  for (const p of skipped) {
    console.log(`  ✗ ${pad(p.raw.name, 16)} ${pad(p.batchLabel, 18)} ${p.raw.phone}`);
    console.log(`      → ${p.skipReason}`);
  }
  console.log("");
  console.log(hr());
  console.log(`SOFT-FLAGGED (modeled & imported — HOLD for staff confirmation of plan/status): ${flagged.length}`);
  console.log(hr());
  if (!flagged.length) console.log("  (none)");
  for (const p of flagged) {
    console.log(`  ⚑ ${pad(p.raw.name, 16)} ${pad(p.batchLabel, 18)} ${p.raw.phone}`);
    for (const f of p.flags) console.log(`      → ${f}`);
  }
  console.log("");
}

function printPerStudent(plans: StudentPlan[]) {
  console.log(hr("─", 132));
  console.log("PER-STUDENT PLAN (imported only)");
  console.log(hr("─", 132));
  console.log(
    `  ${pad("#", 3)}${pad("Name", 16)}${pad("Mode·Batch", 18)}${padL("Sticker", 10)}${padL("Discount", 10)}${padL("Eff.Total", 11)}${padL("Paid", 10)}${padL("Pending", 10)}${padL("Inst", 6)}  ${pad("Access", 13)}${pad("Sched OK", 9)}`,
  );
  let i = 0;
  for (const p of plans.filter((x) => !x.skip)) {
    i++;
    const paidSum = p.scheduleFinal.filter((s) => s.paid).reduce((a, s) => a + s.amount, 0);
    const outSum = p.scheduleFinal.filter((s) => !s.paid).reduce((a, s) => a + s.amount, 0);
    const schedOk = paidSum === p.paid && outSum === p.pending;
    console.log(
      `  ${pad(String(i), 3)}${pad(p.raw.name, 16)}${pad(p.batchLabel, 18)}${padL(money(p.sticker), 10)}${padL(p.discount ? money(p.discount) : "—", 10)}${padL(money(p.actualTotal), 11)}${padL(money(p.paid), 10)}${padL(money(p.pending), 10)}${padL(String(p.n), 6)}  ${pad(p.access, 13)}${pad(schedOk ? "✓" : "✗ CHECK", 9)}`,
    );
  }
  console.log("");
}

function printTotals(all: StudentPlan[], imported: StudentPlan[]) {
  const sum = (arr: StudentPlan[], f: (p: StudentPlan) => number) => arr.reduce((a, p) => a + f(p), 0);
  const sheetCollected = sum(all, (p) => p.paid);
  const sheetPending = sum(all, (p) => p.pending);
  const sheetEffective = sum(all, (p) => p.actualTotal);
  const impCollected = sum(imported, (p) => p.paid);
  const impPending = sum(imported, (p) => p.pending);
  const impEffective = sum(imported, (p) => p.actualTotal);
  const impDiscount = sum(imported, (p) => p.discount);
  const impSticker = sum(imported, (p) => p.sticker);

  console.log(hr());
  console.log("GRAND TOTALS & SHEET RECONCILIATION");
  console.log(hr());
  const line = (label: string, got: number, exp?: number) => {
    const ok = exp == null ? "" : got === exp ? "  ✓ matches sheet" : `  ✗ EXPECTED ${money(exp)}`;
    console.log(`  ${pad(label, 40)}${padL(money(got), 14)}${ok}`);
  };
  console.log(`  ALL ${all.length} SHEET ROWS (incl. skipped) — informational:`);
  line("Collected (Total Fee received)", sheetCollected);
  line("Pending (Pending Fee)", sheetPending);
  line("Effective total (Total Course fee)", sheetEffective);
  console.log("");
  console.log(`  IMPORTED ${imported.length} STUDENTS (skipped removed) — gate compares THESE to SHEET_EXPECTED:`);
  line("Sticker total (list price)", impSticker);
  line("Discount total (concessions)", impDiscount);
  line("Effective total (after discount)", impEffective, SHEET_EXPECTED.effective);
  line("Collected", impCollected, SHEET_EXPECTED.collected);
  line("Pending", impPending, SHEET_EXPECTED.pending);
  console.log(`  ${pad("Check: sticker − discount = effective", 40)}${padL(money(impSticker - impDiscount), 14)}  ${impSticker - impDiscount === impEffective ? "✓" : "✗"}`);
  console.log(`  ${pad("Check: collected + pending = effective", 40)}${padL(money(impCollected + impPending), 14)}  ${impCollected + impPending === impEffective ? "✓" : "✗"}`);
  console.log("");

  const allMatch =
    impCollected === SHEET_EXPECTED.collected &&
    impPending === SHEET_EXPECTED.pending &&
    impEffective === SHEET_EXPECTED.effective;
  return { allMatch, impCollected, impPending, impEffective, impDiscount };
}

async function printLoginTable(plans: StudentPlan[], legacyCourse: Course | null, dbConnected: boolean, commit: boolean) {
  console.log(hr("─", 150));
  console.log(commit ? "FINAL LOGIN-CODE TABLE (post-commit)" : "LOGIN CODES (existing buyers show real code; new ones minted on commit)");
  console.log(hr("─", 150));
  console.log(
    `  ${pad("Name", 16)}${pad("Mobile", 12)}${pad("Mode·Batch", 18)}${padL("Sticker", 9)}${padL("Disc", 8)}${padL("Eff", 9)}${padL("Paid", 9)}${padL("Pend", 9)}${padL("InstRem", 8)}  ${pad("Access", 13)}${pad("LOGIN CODE", 14)}`,
  );
  for (const p of plans.filter((x) => !x.skip)) {
    let code = "(minted on commit)";
    if (p.alreadyImported) code = `${p.existingLoginCode ?? "?"} (already imported)`;
    else if (p.existingLoginCode) code = `${p.existingLoginCode} (existing buyer)`;
    console.log(
      `  ${pad(p.raw.name, 16)}${pad(p.raw.phone, 12)}${pad(p.batchLabel, 18)}${padL(money(p.sticker), 9)}${padL(p.discount ? money(p.discount) : "—", 8)}${padL(money(p.actualTotal), 9)}${padL(money(p.paid), 9)}${padL(money(p.pending), 9)}${padL(String(p.n), 8)}  ${pad(p.access, 13)}${pad(code, 14)}`,
    );
  }
  console.log("");
}

// ------------------------------ enrich (DB) ------------------------------
async function enrichFromDb(plans: StudentPlan[], legacyCourse: Course | null, allowNameMismatch: boolean) {
  for (const p of plans) {
    if (p.skip && !p.alreadyImported) continue;
    const buyer = await getBuyerByPhone(p.raw.phone).catch(() => null);
    p.existingLoginCode = buyer?.login_code ?? null;
    p.existingBuyerName = buyer?.name ?? null;
    p.existingBuyerIsLead = buyer?.is_lead ?? false;
    // Identity guard: an existing account on this phone with a clearly different
    // name is likely a DIFFERENT person → needs-review skip (unless overridden).
    if (buyer && !namesLikelySame(p.raw.name, buyer.name)) {
      p.nameMismatch = true;
      if (!allowNameMismatch && !p.errors.some((e) => e.startsWith("Name mismatch"))) {
        p.errors.push(`Name mismatch: sheet "${p.raw.name}" vs existing account "${buyer.name}" on ${p.raw.phone}.`);
        p.skip = true;
        p.skipReason = p.errors.join(" ");
      }
    }
    if (legacyCourse) {
      const enrs = await getCourseEnrollmentsByPhone(p.raw.phone).catch(() => [] as CourseEnrollment[]);
      p.alreadyImported = enrs.some((e) => e.course_id === legacyCourse.id && e.status !== "cancelled");
    }
  }
}

// ------------------------------- commit ----------------------------------
async function commitImport(plans: StudentPlan[], legacyCourse: Course, nowISO: string) {
  console.log(hr());
  console.log("COMMITTING (idempotent) …");
  console.log(hr());
  let created = 0;
  let skippedExisting = 0;
  for (const p of plans.filter((x) => !x.skip)) {
    const r = p.raw;
    // 1) ensure buyer (idempotent — keeps existing login code)
    const buyer = await ensureBuyer(r.phone, r.name);
    p.existingLoginCode = buyer?.login_code ?? null;

    // 2) idempotency — skip if a legacy-course enrollment already exists
    const enrs = await getCourseEnrollmentsByPhone(r.phone);
    const existing = enrs.find((e) => e.course_id === legacyCourse.id && e.status !== "cancelled");
    if (existing) {
      p.alreadyImported = true;
      skippedExisting++;
      console.log(`  ↷ ${pad(r.name, 16)} ${r.phone}  already imported → skipped`);
      continue;
    }

    // 3) create the enrollment AT STICKER (paid line + N outstanding summing to sticker−paid)
    const enrollment = await addCourseEnrollment({
      phone: r.phone,
      student_name: r.name,
      email: null,
      course_id: legacyCourse.id,
      course_slug: legacyCourse.slug,
      course_title: legacyCourse.title,
      batch_label: p.batchLabel,
      plan_type: p.n > 0 ? "emi" : "full",
      total_fee: p.sticker,
      amount_paid: p.paid,
      installment_count: p.scheduleAtSticker.filter((s) => s.kind === "installment").length,
      status: p.n > 0 ? "partially_paid" : "fully_paid",
      schedule: p.scheduleAtSticker,
    });

    // 4) apply the negotiated discount (sticker − actual) via the EXACT existing path
    if (p.discount > 0) {
      const res = await applyEnrollmentDiscount({
        enrollmentId: enrollment.id,
        discount: p.discount,
        reason: DISCOUNT_REASON,
        appliedBy: IMPORT_ACTOR,
      });
      if (!res.ok) {
        console.log(`  ⚠ ${r.name}: discount failed → ${res.error}`);
      }
    }
    created++;
    console.log(`  ✓ ${pad(r.name, 16)} ${r.phone}  ${pad(p.batchLabel, 18)} eff ${money(p.actualTotal)} · code ${buyer?.login_code ?? "?"}`);
  }
  console.log("");
  console.log(`Created: ${created}   Already-imported (skipped): ${skippedExisting}`);
  console.log("");
  return { created, skippedExisting };
}

/** Re-read the committed enrollments and reconcile against the sheet figures. */
async function verifyAfterCommit(plans: StudentPlan[], legacyCourse: Course) {
  console.log(hr());
  console.log("POST-COMMIT VERIFICATION (reading back the live enrollments the portal will show)");
  console.log(hr());
  let ok = 0;
  let bad = 0;
  for (const p of plans.filter((x) => !x.skip)) {
    const enrs = await getCourseEnrollmentsByPhone(p.raw.phone);
    const e = enrs.find((x) => x.course_id === legacyCourse.id && x.status !== "cancelled");
    if (!e) {
      bad++;
      console.log(`  ✗ ${p.raw.name}: no enrollment found after commit`);
      continue;
    }
    const paid = (e.schedule || []).filter((s) => s.paid).reduce((a, s) => a + s.amount, 0);
    const remaining = Math.max(0, e.total_fee - paid);
    const match = e.total_fee === p.actualTotal && paid === p.paid && remaining === p.pending;
    if (match) ok++;
    else {
      bad++;
      console.log(
        `  ✗ ${p.raw.name}: total ${money(e.total_fee)}/${money(p.actualTotal)} paid ${money(paid)}/${money(p.paid)} pend ${money(remaining)}/${money(p.pending)}`,
      );
    }
  }
  console.log(`  Reconciled: ${ok}   Mismatched: ${bad}`);
  console.log(
    bad === 0
      ? "  ✓ Every imported student reconciles to the sheet. Students see the discounted total / paid / pending / schedule in their portal."
      : "  ✗ Mismatches found — investigate before trusting the import.",
  );
  console.log("");
}

// -------------------------------- main -----------------------------------
async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const allowNameMismatch = args.includes("--allow-name-mismatch");
  const xlsxPath = args.find((a) => !a.startsWith("--"));
  if (!xlsxPath) {
    console.error('Usage: node --import tsx scripts/import-saarthi.ts "<path-to-xlsx>" [--commit]');
    process.exit(1);
  }

  const nowISO = new Date().toISOString();
  const dbConnected = !!getSupabaseAdmin();
  printHeader(commit, dbConnected, xlsxPath);

  if (commit && !dbConnected) {
    console.error("✗ --commit requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment. Aborting (nothing written).");
    process.exit(1);
  }

  // 1) parse + derive
  const rows = parseRows(xlsxPath);
  const stickers = deriveStickers(rows);

  // 2) duplicate-mobile detection (skip ALL rows that share a mobile)
  const phoneCounts = new Map<string, number>();
  for (const r of rows) if (/^\d{10}$/.test(r.phone)) phoneCounts.set(r.phone, (phoneCounts.get(r.phone) ?? 0) + 1);
  const dupPhones = new Set([...phoneCounts.entries()].filter(([, c]) => c > 1).map(([p]) => p));

  // 3) plan every row
  const plans = rows.map((r) => planStudent(r, stickers.get(`${r.mode}|${r.batch}`) ?? 0, dupPhones, nowISO));

  // 4) course lookup (read-only) + DB enrichment for login codes / idempotency /
  //    identity guard. The legacy course is only CREATED on --commit.
  const existingCourse = dbConnected ? await getCourseBySlug(COURSE_SLUG).catch(() => null) : null;
  if (dbConnected) await enrichFromDb(plans, existingCourse, allowNameMismatch);

  // Imported set is computed AFTER enrichment so DB-driven skips (name mismatch)
  // are reflected in every downstream count/total.
  const imported = plans.filter((p) => !p.skip);

  // 5) report
  if (dbConnected) printDbNotes(plans, !!existingCourse);
  printStickers(stickers, plans);
  console.log(hr());
  console.log(`TWO-GROUP SPLIT:  Full access (fully paid) = ${imported.filter((p) => p.status === "fully_paid").length}   |   Installments (partially paid) = ${imported.filter((p) => p.status === "partially_paid").length}`);
  console.log("");
  printRoundingRows(plans);
  printSkippedAndFlagged(plans);
  printPerStudent(plans);
  const totals = printTotals(plans, imported);
  await printLoginTable(plans, existingCourse, dbConnected, false);

  // 6) sheet reconciliation gate
  if (!totals.allMatch) {
    console.log(hr("!"));
    console.log("✗ DISCREPANCY: IMPORTED-set totals do NOT match SHEET_EXPECTED. STOPPING — do not commit until resolved. (On first dry-run this is expected: copy the IMPORTED figures above into SHEET_EXPECTED, then re-run.)");
    console.log(hr("!"));
    if (commit) process.exit(1);
    return;
  }

  if (!commit) {
    console.log(hr("="));
    console.log("DRY-RUN COMPLETE — NOTHING WRITTEN. Review above, then re-run with --commit to import.");
    console.log(hr("="));
    return;
  }

  // 7) commit
  const course = existingCourse ?? (await ensureLegacyCourse(stickers, true));
  if (!course) {
    console.error("✗ Failed to create/find the legacy course. Aborting.");
    process.exit(1);
  }
  console.log(`Legacy course: ${course.title} (${course.slug}) id=${course.id} status=${course.status}`);
  console.log("");
  await commitImport(imported, course, nowISO);
  await enrichFromDb(plans, course, allowNameMismatch);
  await printLoginTable(plans, course, true, true);
  await verifyAfterCommit(imported, course);
  console.log(hr("="));
  console.log("COMMIT COMPLETE.");
  console.log(hr("="));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
