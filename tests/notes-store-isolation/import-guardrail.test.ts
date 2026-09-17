import assert from "node:assert/strict";
import { describe, test } from "node:test";
// @ts-expect-error — plain .mjs CI guard, deliberately untyped and shared with npm test
import { scanSource, scanStoreIsolation, STORE_DIRS } from "../../scripts/ci/guard-store-domain-isolation.mjs";

type Violation = { rel: string; line: number; kind: string; detail: string; why: string };
const scan = (rel: string, src: string): Violation[] => scanSource(rel, src) as Violation[];

describe("store domain isolation guardrail", () => {
  test("the live store tree is clean", () => {
    const violations = scanStoreIsolation() as Violation[];
    assert.deepEqual(
      violations.map((v) => `${v.rel}:${v.line} ${v.kind} ${v.detail}`),
      [],
    );
  });

  test("it guards every directory store code may live in", () => {
    assert.ok((STORE_DIRS as string[]).includes("lib/store"));
    assert.ok((STORE_DIRS as string[]).includes("app/api/notes"));
  });

  test("catches the academy data layer under any specifier shape", () => {
    for (const spec of ["@/lib/dataProvider", "../../lib/dataProvider", "@/lib/dataProvider.ts"]) {
      const v = scan("lib/store/x.ts", `import { getPayments } from "${spec}";`);
      assert.equal(v.length, 1, spec);
      assert.equal(v[0].kind, "forbidden-import");
    }
  });

  test("catches entitlements, paymentOutcome, installment* and enrollment*", () => {
    const cases = [
      'import { x } from "@/lib/entitlements";',
      'import { applyVerifyForReference } from "@/lib/paymentOutcome";',
      'import { y } from "@/lib/paymentOutcome/states";',
      'import { z } from "@/lib/installmentAllocation";',
      'import { w } from "@/lib/enrollmentFeeState";',
    ];
    for (const src of cases) {
      assert.equal(scan("lib/store/x.ts", src).length, 1, src);
    }
  });

  test("catches dynamic import and require, not just static import", () => {
    assert.equal(scan("lib/store/x.ts", 'const m = await import("@/lib/dataProvider");').length, 1);
    assert.equal(scan("lib/store/x.ts", 'const m = require("../../lib/entitlements");').length, 1);
  });

  test("catches a forbidden academy function by name even without an import", () => {
    const v = scan("lib/store/x.ts", "async function f() { await enrollStudentInCourse('x'); }");
    assert.equal(v.length, 1);
    assert.equal(v[0].kind, "forbidden-symbol");
  });

  test("catches a write to an academy money or identity table", () => {
    for (const table of ["payments", "students", "buyers", "course_enrollments"]) {
      const v = scan("lib/store/x.ts", `await db.from("${table}").insert({});`);
      assert.equal(v.length, 1, table);
      assert.equal(v[0].kind, "forbidden-table");
    }
  });

  test("allows the store's own tables and the shared infrastructure tables", () => {
    const allowed = ["store_orders", "store_order_payments", "app_feature_flags", "analytics_events", "auth_attempts"];
    for (const table of allowed) {
      assert.deepEqual(scan("lib/store/x.ts", `await db.from("${table}").select("*");`), [], table);
    }
  });

  test("does not flag ordinary store code", () => {
    const src = `
      import { getSupabaseAdmin } from "@/lib/supabase";
      import { encrypt } from "@/lib/eazypay";
      import { makeStoreReference } from "@/lib/store/references";
      export async function create() {
        const db = getSupabaseAdmin();
        await db!.from("store_orders").insert({ order_no: makeStoreReference() });
        encrypt("x");
      }
    `;
    assert.deepEqual(scan("lib/store/orders.ts", src), []);
  });
});
