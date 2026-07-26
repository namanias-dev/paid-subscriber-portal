/**
 * A small in-memory stand-in for the PostgREST client, good enough for the
 * bulk-assignment paths.
 *
 * It exists so the Phase 3 properties can be proven rather than sampled. The
 * headline requirement — "the preview count must equal what commits, under
 * concurrent inserts" — is not something you can test against a real database
 * by hoping a row lands in the right millisecond. Here the insert is staged
 * exactly between the two calls, every time.
 *
 * Supports only what `lib/legacy-crm/bulkAssign.ts` actually emits: select with
 * eq/is/in/not/gte/lte, ordering, limit, range, head+count, update-by-in, and
 * insert.
 *
 * IT ENFORCES A ROW CAP, and that is not incidental detail.
 *
 * PostgREST truncates every response at `db-max-rows` (1,000 on Supabase) and
 * signals nothing: a request for 5,001 rows returns 1,000 with a 200 and no
 * marker distinguishing "truncated" from "that was all". The first version of
 * this fake returned however many rows matched, so it was strictly more
 * generous than the real thing — and the suite passed while production
 * silently assigned a fifth of each batch and reverted a fifth of each undo.
 *
 * A fake that is more permissive than the system it stands in for does not
 * merely fail to catch a bug, it actively certifies one. So the cap is modelled
 * here, at the real default.
 */

export interface FakeLead {
  id: string;
  created_at: string;
  is_legacy: boolean;
  merged_into: string | null;
  assigned_to: string | null;
  work_status?: string | null;
  status?: string | null;
  legacy_source_tab?: string | null;
  [k: string]: unknown;
}

export interface FakeAudit {
  id: string;
  lead_id: string;
  actor: string;
  action: string;
  field: string | null;
  before_value: string | null;
  after_value: string | null;
  batch_id: string | null;
  reverses_id?: string | null;
  reverted_at?: string | null;
  reverted_by?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

/** Supabase's `db-max-rows` default. The number that caused the bug. */
export const PGRST_MAX_ROWS = 1_000;

export class FakeLeadsDb {
  leads: FakeLead[] = [];
  audit: FakeAudit[] = [];
  /** Every update issued, so tests can assert which columns were written. */
  updates: { table: string; patch: Row; ids: string[] }[] = [];
  /** Mirrors PostgREST's silent truncation. */
  maxRows: number = PGRST_MAX_ROWS;
  /** Every select issued, so tests can assert the caller actually paged. */
  selects: { table: string; from: number; to: number | null; returned: number }[] = [];
  /**
   * Fail every `leads` UPDATE once this many have succeeded, imitating the 8s
   * `statement_timeout` that killed a real run partway through a batch. The
   * point is not the timeout itself but what the code leaves behind when a
   * multi-chunk write dies in the middle.
   */
  failLeadUpdateAfter: number | null = null;
  private leadUpdateCount = 0;

  constructor(leads: FakeLead[] = []) { this.leads = leads; }

  private rowsFor(table: string): Row[] {
    if (table === "leads") return this.leads as unknown as Row[];
    if (table === "lead_worklist_audit") return this.audit as unknown as Row[];
    throw new Error(`FakeLeadsDb: unknown table ${table}`);
  }

  from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const preds: Pred[] = [];
    let headCount = false;
    const orders: { col: string; asc: boolean }[] = [];
    let limitN: number | null = null;
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;

    const resolve = () => {
      let rows = self.rowsFor(table).filter((r) => preds.every((p) => p(r)));
      for (const o of [...orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = a[o.col] as string | null;
          const bv = b[o.col] as string | null;
          if (av === bv) return 0;
          if (av === null || av === undefined) return o.asc ? -1 : 1;
          if (bv === null || bv === undefined) return o.asc ? 1 : -1;
          return (av < bv ? -1 : 1) * (o.asc ? 1 : -1);
        });
      }
      // head+count reports the true total; PostgREST does not cap a count.
      if (headCount) return { data: null, error: null, count: rows.length };

      let out = rows;
      if (rangeFrom !== null) out = out.slice(rangeFrom, (rangeTo ?? out.length - 1) + 1);
      if (limitN !== null) out = out.slice(0, limitN);

      // The cap, applied last and silently — exactly as PostgREST does it.
      const capped = out.slice(0, self.maxRows);
      self.selects.push({ table, from: rangeFrom ?? 0, to: rangeTo, returned: capped.length });
      return { data: capped.map((r) => ({ ...r })), error: null, count: capped.length };
    };

    const builder: Record<string, unknown> = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) headCount = true;
        return builder;
      },
      eq(col: string, v: unknown) { preds.push((r) => r[col] === v); return builder; },
      neq(col: string, v: unknown) { preds.push((r) => r[col] !== v); return builder; },
      is(col: string, v: unknown) {
        preds.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v));
        return builder;
      },
      not(col: string, op: string, v: unknown) {
        if (op === "is" && v === null) preds.push((r) => r[col] !== null && r[col] !== undefined);
        else preds.push((r) => r[col] !== v);
        return builder;
      },
      in(col: string, vs: unknown[]) {
        const set = new Set(vs);
        preds.push((r) => set.has(r[col]));
        return builder;
      },
      like(col: string, pattern: string) {
        // Only `%`, which is all the callers use.
        const rx = new RegExp("^" + pattern.split("%").map((s) =>
          s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
        preds.push((r) => rx.test(String(r[col] ?? "")));
        return builder;
      },
      gte(col: string, v: string) { preds.push((r) => String(r[col]) >= v); return builder; },
      lte(col: string, v: string) { preds.push((r) => String(r[col]) <= v); return builder; },
      order(col: string, o?: { ascending?: boolean }) {
        orders.push({ col, asc: o?.ascending !== false });
        return builder;
      },
      limit(n: number) { limitN = n; return Promise.resolve(resolve()); },
      range(from: number, to: number) {
        rangeFrom = from; rangeTo = to;
        return Promise.resolve(resolve());
      },
      update(patch: Row) {
        return {
          in(col: string, vs: unknown[]) {
            const set = new Set(vs);
            const target = self.rowsFor(table).filter((r) => set.has(r[col]) && preds.every((p) => p(r)));
            if (table === "leads" && self.failLeadUpdateAfter !== null) {
              if (self.leadUpdateCount >= self.failLeadUpdateAfter) {
                return Promise.resolve({
                  data: null,
                  error: { message: "canceling statement due to statement timeout" },
                });
              }
              self.leadUpdateCount += target.length;
            }
            for (const r of target) Object.assign(r, patch);
            self.updates.push({ table, patch, ids: target.map((r) => String(r.id ?? r.lead_id)) });
            return Promise.resolve({ data: null, error: null });
          },
          eq(col: string, v: unknown) {
            const target = self.rowsFor(table).filter((r) => r[col] === v);
            for (const r of target) Object.assign(r, patch);
            self.updates.push({ table, patch, ids: target.map((r) => String(r.id)) });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      insert(rows: Row | Row[]) {
        const list = Array.isArray(rows) ? rows : [rows];
        for (const r of list) self.rowsFor(table).push({ created_at: new Date().toISOString(), ...r });
        return Promise.resolve({ data: null, error: null });
      },
      // Thenable so `await q` works for the head+count form, which has no
      // terminal .limit().
      then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
        return Promise.resolve(resolve()).then(onOk, onErr);
      },
    };
    return builder;
  }
}

/** Build N legacy leads with sequential timestamps. */
export function makeLeads(n: number, opts: Partial<FakeLead> = {}): FakeLead[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `L${String(i).padStart(5, "0")}`,
    // Fixed base date so ordering is deterministic across runs.
    created_at: new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString(),
    is_legacy: true,
    merged_into: null,
    assigned_to: null,
    work_status: null,
    status: "New",
    legacy_source_tab: null,
    ...opts,
  }));
}
