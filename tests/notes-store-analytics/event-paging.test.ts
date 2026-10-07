/**
 * The KPI loader must read every behaviour event in the range, not the newest 8,000.
 * The fake client mimics Supabase: at most 1,000 rows per request, exact counts on head reads.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadEvents, MAX_NOTES_EVENTS } from "../../lib/analytics/notesReport";

type Row = { event_id: string; event_name: string; session_id: string; occurred_at: string; is_bot: boolean };

function fakeDb(rows: Row[], onRequest: () => void = () => {}) {
  const sorted = [...rows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id));
  return {
    from() {
      let head = false;
      const builder = {
        select(_cols: string, opts?: { head?: boolean }) { head = Boolean(opts?.head); return builder; },
        in() { return builder; },
        gte() { return builder; },
        lt() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        range(from: number, to: number) {
          onRequest();
          const end = Math.min(to + 1, from + 1000);
          return Promise.resolve({ data: sorted.slice(from, end), error: null });
        },
        then(resolve: (value: unknown) => void) {
          onRequest();
          resolve(head ? { count: rows.length, error: null } : { data: sorted.slice(0, 1000), error: null });
        },
      };
      return builder;
    },
  };
}

function events(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    event_id: `e${String(i).padStart(6, "0")}`,
    event_name: i % 3 ? "notes_store_viewed" : "notes_product_viewed",
    session_id: `s${i}`,
    occurred_at: new Date(Date.UTC(2026, 8, 5) + i * 60000).toISOString(),
    is_bot: false,
  }));
}

describe("behaviour event paging", () => {
  it("reads every event when the range holds more than the old 8,000 cap", async () => {
    const all = events(16720);
    const out = await loadEvents(fakeDb(all) as never, new Date("2026-09-01"), new Date("2026-10-31"));
    assert.equal(out.ok, true);
    assert.equal(out.capped, false);
    assert.equal(out.events.length, 16720);
    assert.equal(new Set(out.events.map((e) => (e as { event_id?: string }).event_id)).size, 16720);
  });

  it("reads a small range in one page", async () => {
    let requests = 0;
    const out = await loadEvents(fakeDb(events(250), () => requests++) as never, new Date("2026-09-01"), new Date("2026-10-31"));
    assert.equal(out.events.length, 250);
    assert.equal(requests, 2, "one count request and one page");
  });

  it("flags the range when it exceeds the safety ceiling instead of truncating silently", async () => {
    const db = fakeDb(events(10)) as unknown as { from: () => { then: (r: (v: unknown) => void) => void } };
    const original = db.from;
    db.from = () => {
      const b = original() as unknown as { select: (c: string, o?: { head?: boolean }) => unknown; then: (r: (v: unknown) => void) => void };
      const select = b.select.bind(b);
      b.select = (c: string, o?: { head?: boolean }) => {
        select(c, o);
        if (o?.head) b.then = (r) => r({ count: MAX_NOTES_EVENTS + 1, error: null });
        return b;
      };
      return b as never;
    };
    const out = await loadEvents(db as never, new Date("2026-09-01"), new Date("2026-10-31"));
    assert.equal(out.capped, true);
  });
});
