import { NextResponse } from "next/server";
import { getLeadsPaged, LEADS_PAGE_MAX_LIMIT } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import {
  LEAD_WORK_STATUSES,
  LEADS_SORT_KEYS,
  type LeadsPageParams,
  type LeadsSortDir,
  type LeadsSortKey,
  type LeadWorkStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * PHASE 2 — the server-side Lead CRM worklist reader.
 *
 * Everything is applied in Postgres: scope, filters, search, sort, and keyset
 * pagination. Nothing is ever fetched-then-filtered in JS, and the page size is
 * hard-capped at 100 both here and again inside the SQL function.
 *
 * =====================================================================
 * SCOPE IS AN EXPLICIT PARAMETER, NOT AN IMPLICIT DEFAULT
 * =====================================================================
 * `?scope=live` (default) · `legacy` · `all`
 *
 * This endpoint is the ONLY place legacy leads become visible, and it is
 * additive: the existing Kanban at /api/admin/leads is untouched, and `live`
 * remains the default landing state so nobody's default screen suddenly
 * contains 178,183 rows.
 *
 * Payments, Analytics, SMS audiences and the dashboards do NOT route through
 * here and must never gain a legacy scope — see
 * `tests/legacy-crm-phase2/protected-consumers.test.ts`.
 */

/** Free-text search shorter than this cannot use the trigram indexes. */
const MIN_SEARCH_CHARS = 3;

/**
 * Bound the exact count when a free-text search is active.
 *
 * Indexed filters count exactly and cheaply via a narrow index-only scan.
 * A trigram/ILIKE match cannot be counted that way (1,749 ms measured), so the
 * search path counts to this bound and the response flags `totalIsCapped` so
 * the UI renders "5,000+" rather than a number nobody computed.
 */
const SEARCH_COUNT_CAP = 5000;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  // PERMISSION IS ENFORCED HERE, AT THE API, not merely hidden in the UI.
  // A non-admin calling this endpoint directly gets a 401 with no rows.
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (k: string) => {
    const v = url.searchParams.get(k);
    return v === null || v === "" ? null : v;
  };

  // ---- scope -------------------------------------------------------
  const scopeParam = (q("scope") ?? "live").toLowerCase();
  const scopeMap: Record<string, LeadsPageParams["includeLegacy"]> = {
    live: false,
    legacy: "only",
    all: true,
  };
  if (!(scopeParam in scopeMap)) return bad(`Unknown scope "${scopeParam}". Use live, legacy, or all.`);
  const includeLegacy = scopeMap[scopeParam];

  // ---- sort --------------------------------------------------------
  const sort = (q("sort") ?? "created_at") as LeadsSortKey;
  if (!LEADS_SORT_KEYS.includes(sort)) {
    return bad(`Unknown sort "${sort}". Allowed: ${LEADS_SORT_KEYS.join(", ")}.`);
  }
  const dirRaw = (q("dir") ?? "desc").toLowerCase();
  if (dirRaw !== "asc" && dirRaw !== "desc") return bad(`Unknown dir "${dirRaw}". Allowed: asc, desc.`);
  const dir = dirRaw as LeadsSortDir;

  // ---- page size ---------------------------------------------------
  const limitRaw = Number(q("limit") ?? 50);
  if (!Number.isFinite(limitRaw) || limitRaw < 1) return bad("limit must be a positive number.");
  // Clamped, not rejected — matching the shipped contract and the SQL cap.
  const limit = Math.min(Math.trunc(limitRaw), LEADS_PAGE_MAX_LIMIT);

  // ---- search ------------------------------------------------------
  // Rejected rather than silently ignored. A 2-character needle would scan the
  // whole partition, and quietly dropping the filter would show the user an
  // unfiltered list that looks like a filtered one.
  const search = q("search");
  if (search !== null && search.trim().length > 0 && search.trim().length < MIN_SEARCH_CHARS) {
    return bad(`Search needs at least ${MIN_SEARCH_CHARS} characters.`);
  }

  // ---- work status -------------------------------------------------
  const workStatus = q("work_status") as LeadWorkStatus | null;
  if (workStatus !== null && !LEAD_WORK_STATUSES.includes(workStatus)) {
    return bad(`Unknown work_status "${workStatus}".`);
  }

  // ---- assignment / contacted --------------------------------------
  const assignedMode = q("assigned_mode");
  if (assignedMode !== null && assignedMode !== "assigned" && assignedMode !== "unassigned") {
    return bad(`Unknown assigned_mode "${assignedMode}". Allowed: assigned, unassigned.`);
  }
  const contacted = q("contacted");
  if (contacted !== null && contacted !== "yes" && contacted !== "no") {
    return bad(`Unknown contacted "${contacted}". Allowed: yes, no.`);
  }

  // ---- date range --------------------------------------------------
  const createdFrom = q("created_from");
  const createdTo = q("created_to");
  for (const [label, v] of [["created_from", createdFrom], ["created_to", createdTo]] as const) {
    if (v !== null && Number.isNaN(Date.parse(v))) return bad(`${label} is not a valid date.`);
  }

  const hasSearch = !!search && search.trim().length >= MIN_SEARCH_CHARS;

  try {
    const page = await getLeadsPaged({
      includeLegacy,
      limit,
      cursor: q("cursor"),
      withCount: q("count") !== "0",
      countCap: hasSearch ? SEARCH_COUNT_CAP : null,
      sort,
      dir,
      status: q("status"),
      sourceTag: q("source_tag"),
      assignedTo: q("assigned_to"),
      search,
      consentStatus: q("consent_status") as LeadsPageParams["consentStatus"],
      workStatus,
      assignedMode: assignedMode as LeadsPageParams["assignedMode"],
      contacted: contacted as LeadsPageParams["contacted"],
      createdFrom,
      createdTo,
    });

    return NextResponse.json({
      ok: true,
      scope: scopeParam,
      rows: page.rows,
      nextCursor: page.nextCursor,
      total: page.total,
      totalIsCapped: page.totalIsCapped,
      limit: page.limit,
      sort,
      dir,
    });
  } catch (e) {
    // HONEST FAILURE. Never a fixture, never an empty list dressed up as "no
    // results" — a DB error renders a real error state in the UI. Regression
    // 9f567b64 shipped 24 seed cards labelled as real leads because this
    // returned a fallback instead of throwing.
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[leads/worklist] read failed:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load the lead worklist.", detail: message },
      { status: 500 },
    );
  }
}
