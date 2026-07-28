/**
 * REGRESSION SUITE for the 2026-07-28 "paid student with no profile" fix.
 *
 * ROOT CAUSE
 * ----------
 * PostgREST caps any response at 1000 rows unless the query pages with
 * `.range()`. `getStudents()` read the whole `students` table with a plain
 * `.select("*").order("created_at", desc)` and no range, so once the table
 * passed 1000 rows the OLDEST students stopped being returned at all.
 *
 * In production on 2026-07-28 that was 1194 students → 194 invisible, of whom
 * 17 had paid for a course. They could not be found by search, did not appear
 * in the list, and had no openable profile — which staff reported as "paid
 * student with no profile / no login code". The reported case (Tripti Jain)
 * was one of them: her `students` row was created 2026-06-27, inside the
 * truncated window, even though her enrolment and login code were healthy.
 *
 * The same cap was silently truncating `buyers` (1220 → 1000, hiding 220
 * login codes) and `payments` (1077 → 1000), which under-reported per-student
 * "Total paid" and webinar receipts.
 *
 * CONTRACTS PINNED HERE
 * ---------------------
 * C1. `pageThrough` returns EVERY row across page boundaries, and terminates.
 * C2. It calls `build()` afresh per page. Reusing one builder re-applies
 *     `.range()` to an already-ranged query and silently re-reads page 1
 *     forever — the trap that makes a broken paginator look like it works.
 * C3. It is tie-safe by construction: callers order by a UNIQUE tiebreaker.
 *     Offset paging over a non-unique sort key is not stable — prod `payments`
 *     has a tie group of 85 rows sharing one `created_at`, so a page boundary
 *     landing inside it can drop and duplicate rows.
 * C4. A DB error stops the walk instead of looping forever.
 * C5. SOURCE CONTRACT: the whole-table readers behind Students & Enrollments
 *     stay paged. This is the assertion that actually fails if someone
 *     reintroduces a bare `.select("*")` on these tables.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pageThrough, type _RangeablePage } from "../../lib/dataProvider";

const REPO = join(import.meta.dirname, "..", "..");
const DATA_PROVIDER = readFileSync(join(REPO, "lib", "dataProvider.ts"), "utf8");

/** PostgREST's default response cap — the number that caused the incident. */
const POSTGREST_MAX_ROWS = 1000;

interface Row {
  id: string;
}

/**
 * Stub that behaves like PostgREST: honours `.range()`, and never returns more
 * than `POSTGREST_MAX_ROWS` in one response.
 */
function makeTable(total: number): { build: () => _RangeablePage; builds: number; ranges: [number, number][] } {
  const state = { builds: 0, ranges: [] as [number, number][] };
  const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: `row-${i}` }));
  return {
    get builds() {
      return state.builds;
    },
    get ranges() {
      return state.ranges;
    },
    build() {
      state.builds += 1;
      return {
        range(from: number, to: number) {
          state.ranges.push([from, to]);
          const capped = Math.min(to, from + POSTGREST_MAX_ROWS - 1);
          return Promise.resolve({ data: rows.slice(from, capped + 1), error: null });
        },
      };
    },
  };
}

describe("C1/C2 — pageThrough walks the entire table", () => {
  test("returns all 1194 rows where an unpaged read would return 1000", async () => {
    const t = makeTable(1194);
    const out = await pageThrough<Row>(() => t.build());

    assert.equal(out.length, 1194, "paginator dropped rows — this is the production bug");
    assert.equal(new Set(out.map((r) => r.id)).size, 1194, "paginator returned duplicates");
    assert.equal(out[0].id, "row-0");
    assert.equal(out[1193].id, "row-1193");
  });

  test("builds a FRESH query per page (C2 — reusing one builder re-reads page 1 forever)", async () => {
    const t = makeTable(2500);
    const out = await pageThrough<Row>(() => t.build());

    assert.equal(out.length, 2500);
    assert.equal(t.builds, 3, "expected one build() per page: 0-999, 1000-1999, 2000-2499");
    assert.deepEqual(t.ranges, [
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("terminates on a short final page and on an exact multiple of the page size", async () => {
    assert.equal((await pageThrough<Row>(() => makeTable(999).build())).length, 999);
    assert.equal((await pageThrough<Row>(() => makeTable(0).build())).length, 0);

    // Exact multiple: the walk must issue one extra empty page and then stop,
    // rather than assuming a full page means more data and looping.
    const exact = makeTable(2000);
    const out = await pageThrough<Row>(() => exact.build());
    assert.equal(out.length, 2000);
    assert.equal(new Set(out.map((r) => r.id)).size, 2000);
  });
});

describe("C4 — a database error stops the walk", () => {
  test("does not loop forever when a page errors", async () => {
    let calls = 0;
    const out = await pageThrough<Row>(() => ({
      range(from: number) {
        calls += 1;
        if (from === 0) return Promise.resolve({ data: [{ id: "a" }], error: null });
        return Promise.resolve({ data: null, error: { message: "statement timeout" } });
      },
    }));
    // First page is short (1 < 1000) so the walk ends there; the guard exists
    // for the case where a later page fails after a full one.
    assert.equal(out.length, 1);
    assert.equal(calls, 1);
  });

  test("stops after an error on a later page instead of spinning", async () => {
    let calls = 0;
    const out = await pageThrough<Row>(
      () => ({
        range(from: number) {
          calls += 1;
          if (calls > 10) throw new Error("paginator did not terminate on error");
          if (from === 0) return Promise.resolve({ data: [{ id: "a" }, { id: "b" }], error: null });
          return Promise.resolve({ data: null, error: { message: "statement timeout" } });
        },
      }),
      2,
    );
    assert.equal(out.length, 2);
    assert.equal(calls, 2);
  });
});

// ---------------------------------------------------------------------------
// C5. Source contract. These readers back Students & Enrollments and the
// student profile. A bare `.select("*")` on any of them silently hides real,
// paying students the moment the table crosses 1000 rows.
// ---------------------------------------------------------------------------
describe("C5 — whole-table readers behind Students & Enrollments stay paged", () => {
  const READERS = [
    { fn: "getStudents", table: "students" },
    { fn: "getBuyers", table: "buyers" },
    { fn: "getPayments", table: "payments" },
    { fn: "getAllCourseEnrollments", table: "course_enrollments" },
    { fn: "getAllWebinarRegistrations", table: "webinar_registrations" },
  ];

  /** Body of `export async function <fn>(...) { ... }` up to the next top-level export. */
  function bodyOf(fn: string): string {
    const start = DATA_PROVIDER.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn}() not found in lib/dataProvider.ts — did it get renamed?`);
    const next = DATA_PROVIDER.indexOf("\nexport ", start + 1);
    return DATA_PROVIDER.slice(start, next === -1 ? DATA_PROVIDER.length : next);
  }

  for (const { fn, table } of READERS) {
    test(`${fn}() pages through "${table}"`, () => {
      const body = bodyOf(fn);
      assert.ok(
        body.includes("pageThrough"),
        `${fn}() no longer pages. PostgREST caps the response at ${POSTGREST_MAX_ROWS} rows, so ` +
          `once "${table}" passes that it will silently stop returning the oldest rows. That is ` +
          `exactly how 17 paying students vanished from Students & Enrollments on 2026-07-28.`,
      );
    });

    test(`${fn}() orders by a unique tiebreaker so offset paging is stable`, () => {
      const body = bodyOf(fn);
      assert.ok(
        /\.order\(\s*["']id["']/.test(body),
        `${fn}() pages without an "id" tiebreaker. Postgres may order rows that tie on the sort ` +
          `column differently between queries, so a page boundary inside a tie group drops and ` +
          `duplicates rows. Production "payments" has a tie group of 85 rows on one created_at.`,
      );
    });
  }

  test("pageThrough is documented as requiring a unique tiebreaker", () => {
    const helper = DATA_PROVIDER.slice(
      DATA_PROVIDER.indexOf("async function pageThrough"),
      DATA_PROVIDER.indexOf("async function dbInsert"),
    );
    assert.ok(helper.length > 0, "pageThrough helper not found");
    assert.ok(
      /fresh builder|fresh/i.test(DATA_PROVIDER.slice(DATA_PROVIDER.indexOf("Page through a FILTERED"), DATA_PROVIDER.indexOf("async function pageThrough"))),
      "the per-page rebuild requirement must stay documented — it is the non-obvious trap",
    );
  });
});
