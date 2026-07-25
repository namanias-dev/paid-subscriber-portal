/**
 * PHASE 2 — PAGINATING A TABLE THAT IS BEING WRITTEN TO.
 *
 * The public site captures leads continuously, so the live lead count is a
 * moving target — it grew 1,026 → 1,027 during a single QA run. Rows land at
 * the HEAD of the default (created_at desc, id desc) ordering while a
 * counsellor is part-way through paging the CRM.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * OFFSET pagination COUNTS rows rather than ADDRESSING them. Every row
 * inserted at the head shifts the entire tail down by one, so the next page
 * both repeats the row on the boundary and steps over the one behind it. The
 * row stepped over is a real lead that nobody ever sees, and nothing raises an
 * error — the table looks perfectly healthy. Measured against the real
 * 179,210-row table with 5 concurrent inserts (see
 * `supabase/qa/phase2-keyset-concurrency.sql`):
 *
 *     keyset : 40 rows · 0 duplicates · 0 pre-existing rows skipped
 *     offset : 40 rows · 5 duplicates · 10 pre-existing rows skipped
 *
 * A compound ROW(created_at, id) keyset is immune because the cursor is an
 * ABSOLUTE POSITION in the ordering, not a count of rows already consumed.
 * Nothing inserted above the cursor can move it.
 *
 * WHY A FAKE TABLE HERE
 * ---------------------
 * The SQL script above already proves the RPC's predicate against real
 * production data, but it cannot run in CI (no Postgres, and it must roll
 * back). What is NOT covered there is the client-side half of the loop, which
 * is equally capable of losing a lead: encoding the cursor, threading it into
 * the next request, and choosing it over `offset`. That is the production code
 * exercised here, against an in-memory relation that implements the same
 * row-value comparison semantics as the SQL and can be mutated mid-walk.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { _dbSelectLeadsPaged, type _LeadsPagedClient } from "../../lib/dataProvider";
import type { LeadWorklistRow } from "../../lib/types";

function makeRow(id: string, createdAt: string): LeadWorklistRow {
  return {
    id,
    name: `Person ${id}`,
    phone: "9800000000",
    city: null, state: null, source: "Legacy Sheet",
    campaign: null, campaign_clean: null, legacy_source_tab: "FB LEADS",
    status: "Not Replied",
    created_at: createdAt,
    counsellor: null, assigned_to: null, worklist_queue: null,
    follow_up_at: null, last_worked_at: null,
    consent_status: "unknown", dnd_status: null, last_contacted_at: null,
    contact_attempt_count: 0, suppression_reason: null,
    cohort: "legacy_promoted", is_legacy: true,
    legacy_call_status: "Not Replied", legacy_call_status_raw: "Not Replied ",
    work_status: null, work_status_at: null, work_status_by: null,
    import_batch: null, first_seen_at: createdAt, promoted_at: null,
  } as LeadWorklistRow;
}

/** Descending (created_at, id) — the same total order the SQL sorts by. */
function cmpDesc(a: LeadWorklistRow, b: LeadWorklistRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/**
 * An in-memory stand-in for `public.leads` that honours the keyset predicate
 * exactly as the SQL does: `(created_at, id) < (cursor_created_at, cursor_id)`
 * compared as a ROW, not field-by-field.
 */
class FakeLeadsTable implements _LeadsPagedClient {
  rows: LeadWorklistRow[];

  constructor(rows: LeadWorklistRow[]) {
    this.rows = [...rows].sort(cmpDesc);
  }

  /** Simulates the public site capturing a lead: it lands at the head. */
  insertAtHead(id: string): void {
    const newest = this.rows[0]!.created_at;
    const at = new Date(Date.parse(newest) + 60_000).toISOString();
    this.rows.unshift(makeRow(id, at));
    this.rows.sort(cmpDesc);
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    const ordered = [...this.rows].sort(cmpDesc);

    const curAt = (args.p_cursor_sort_value ?? args.p_cursor_created_at) as string | null;
    const curId = args.p_cursor_id as string | null;

    let visible = ordered;
    if (curAt && curId) {
      visible = ordered.filter((r) =>
        r.created_at !== curAt ? r.created_at < curAt : r.id < curId,
      );
    }

    if (fn === "leads_paged_count") return { data: visible.length, error: null };

    const offset = (args.p_offset as number) ?? 0;
    const limit = (args.p_limit as number) ?? 50;
    return { data: visible.slice(offset, offset + limit), error: null };
  }
}

/** Walks every page, invoking `onPage` after each so the test can mutate. */
async function walk(
  table: FakeLeadsTable,
  limit: number,
  maxPages: number,
  onPage: (page: number) => void,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;

  for (let page = 1; page <= maxPages; page++) {
    const res = await _dbSelectLeadsPaged(table, { limit, cursor: cursor ?? undefined });
    for (const r of res.rows) seen.push(r.id);
    onPage(page);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return seen;
}

describe("keyset pagination survives concurrent inserts at the head", () => {
  const BASE = Array.from({ length: 40 }, (_v, i) =>
    makeRow(`id-${String(i).padStart(3, "0")}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
  );

  it("returns no duplicates and skips no pre-existing row while the site captures leads", async () => {
    const table = new FakeLeadsTable(BASE);
    const snapshot = new Set(BASE.map((r) => r.id));

    // A lead is captured after every page — the worst realistic case.
    const seen = await walk(table, 10, 4, (page) => {
      table.insertAtHead(`live-${page}`);
    });

    assert.equal(new Set(seen).size, seen.length, "a lead was returned twice");

    const returned = new Set(seen);
    const missed = [...snapshot].filter((id) => !returned.has(id));
    assert.deepEqual(
      missed, [],
      "pre-existing leads were silently skipped — this is the OFFSET bug reappearing",
    );
  });

  it("never shows a lead captured after the walk began (a stable read, not a moving one)", async () => {
    const table = new FakeLeadsTable(BASE);
    const seen = await walk(table, 10, 4, (page) => table.insertAtHead(`live-${page}`));

    const leaked = seen.filter((id) => id.startsWith("live-"));
    assert.deepEqual(
      leaked, [],
      "rows inserted above the cursor must not appear mid-walk; the page is a point-in-time read",
    );
  });

  it("a tie group sharing one timestamp still advances (id breaks the tie)", async () => {
    // 25 rows on the SAME created_at. If the cursor compared only the
    // timestamp, page 2 would return the identical 10 rows forever.
    const tied = Array.from({ length: 25 }, (_v, i) =>
      makeRow(`tie-${String(i).padStart(3, "0")}`, "2026-03-01T00:00:00.000Z"),
    );
    const table = new FakeLeadsTable(tied);

    const seen = await walk(table, 10, 5, () => {});

    assert.equal(seen.length, 25, "every row in the tie group must be returned exactly once");
    assert.equal(new Set(seen).size, 25, "the tie group repeated a row");
  });

  it("deleting the row a cursor points at does not strand the walk", async () => {
    // The cursor is a POSITION, not a foreign key. A row vanishing between
    // pages must not halt the walk or skip its neighbours.
    const table = new FakeLeadsTable(BASE);

    const first = await _dbSelectLeadsPaged(table, { limit: 10 });
    const boundary = first.rows[first.rows.length - 1]!.id;
    table.rows = table.rows.filter((r) => r.id !== boundary);

    const second = await _dbSelectLeadsPaged(table, {
      limit: 10,
      cursor: first.nextCursor!,
    });

    assert.equal(second.rows.length, 10, "the walk stalled after its anchor row disappeared");
    assert.ok(
      !second.rows.some((r) => first.rows.some((f) => f.id === r.id)),
      "page 2 repeated a row from page 1",
    );
  });
});
