import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logWebinarAudit } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/**
 * BUILD 4 — Historical webinar-registrant CSV recovery (portal-side plumbing, NOT an AIVA action).
 *
 * POST /api/admin/webinars/registrants-import
 *   { webinarId, csv, apply?: boolean }
 *   - apply !== true → DRY RUN: parse + validate + dedupe, report new / duplicate / invalid /
 *     would-link-to-enrollment counts + a small masked sample. No writes.
 *   - apply === true → INSERT the new rows into webinar_registrations (additive, insert-only;
 *     never updates/duplicates existing rows). Rows are stamped attribution_source='historical_csv_import'
 *     so the whole batch is reversible with a single DELETE.
 *
 * Super-Admin / content_webinars gated. Never touches payments or enrollments → finance unaffected.
 */

const IMPORT_TAG = "historical_csv_import";

function norm(p: unknown): string {
  return String(p ?? "").replace(/\D/g, "").slice(-10);
}

/** Minimal CSV parser: handles quoted fields, escaped quotes, CRLF. Returns header + row objects. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => (o[h] = (r[idx] ?? "").trim()));
    return o;
  });
}

function pick(o: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return "";
}

function truthy(v: string): boolean {
  return /^(1|true|yes|y|present|attended)$/i.test(v.trim());
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_webinars"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const webinarId = String(body.webinarId || "").trim();
    const csv = String(body.csv || "");
    const apply = body.apply === true;
    if (!webinarId || !csv.trim()) {
      return NextResponse.json({ ok: false, error: "webinarId and csv are required." }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });

    const parsed = parseCsv(csv);
    if (parsed.length === 0) {
      return NextResponse.json({ ok: false, error: "No data rows found (need a header row + at least one row)." }, { status: 400 });
    }

    // Normalize + validate + dedupe within the file.
    const seen = new Set<string>();
    const valid: { name: string; phone: string; email: string | null; attended: boolean }[] = [];
    let invalid = 0;
    let dupInFile = 0;
    for (const rec of parsed) {
      const name = pick(rec, ["name", "student", "student_name", "full name", "fullname"]);
      const phone = norm(pick(rec, ["phone", "mobile", "number", "contact", "phone number"]));
      const email = pick(rec, ["email", "e-mail"]) || null;
      const attended = truthy(pick(rec, ["attended", "attendance", "present"]));
      if (!name || phone.length !== 10) { invalid++; continue; }
      if (seen.has(phone)) { dupInFile++; continue; }
      seen.add(phone);
      valid.push({ name, phone, email, attended });
    }

    // Existing registrant phones for THIS webinar (dedupe target — never duplicate).
    const existing = new Set<string>();
    {
      const { data } = await db.from("webinar_registrations").select("phone").eq("webinar_id", webinarId);
      for (const r of data || []) existing.add(norm((r as { phone?: string }).phone));
    }

    // Active-enrollment phones (link estimate).
    const enrollPhones = new Set<string>();
    {
      const { data } = await db.from("course_enrollments").select("phone, status, amount_paid");
      for (const e of data || []) {
        const st = String((e as { status?: string }).status || "");
        const paid = Number((e as { amount_paid?: number }).amount_paid || 0);
        if (st !== "cancelled" && (paid > 0 || st === "fully_paid")) enrollPhones.add(norm((e as { phone?: string }).phone));
      }
    }

    const toInsert = valid.filter((v) => !existing.has(v.phone));
    const duplicatesExisting = valid.length - toInsert.length;
    const wouldLink = toInsert.filter((v) => enrollPhones.has(v.phone)).length;
    const sample = toInsert.slice(0, 5).map((v) => ({ name: v.name, phoneMasked: `••••••${v.phone.slice(-4)}`, attended: v.attended, willLink: enrollPhones.has(v.phone) }));

    const summary = {
      totalParsed: parsed.length,
      invalid,
      duplicateInFile: dupInFile,
      duplicateExisting: duplicatesExisting,
      newRows: toInsert.length,
      wouldLinkToEnrollment: wouldLink,
      sample,
    };

    if (!apply) {
      return NextResponse.json({ ok: true, mode: "dry-run", webinarId, ...summary });
    }

    if (toInsert.length === 0) {
      return NextResponse.json({ ok: true, mode: "apply", webinarId, inserted: 0, ...summary });
    }

    // Insert-only. Stamp provenance so the batch is reversible with one DELETE.
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500).map((v) => ({
        webinar_id: webinarId,
        name: v.name,
        phone: v.phone,
        attended: v.attended,
        attribution_source: IMPORT_TAG,
      }));
      const { error } = await db.from("webinar_registrations").insert(chunk);
      if (error) return NextResponse.json({ ok: false, error: error.message, insertedBeforeError: inserted }, { status: 500 });
      inserted += chunk.length;
    }

    // Keep the AIVA marker consistent: this webinar now has row-level data.
    await db.from("webinars").update({ registrations_source: "row_level" }).eq("id", webinarId);

    const actor = await getActionActor();
    await logWebinarAudit({
      action: "attendance_marked",
      webinar_id: webinarId,
      actor: actor?.id ?? "system",
      count: inserted,
      detail: { kind: "historical_csv_import", inserted, wouldLink },
    }).catch(() => {});

    return NextResponse.json({ ok: true, mode: "apply", webinarId, inserted, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
