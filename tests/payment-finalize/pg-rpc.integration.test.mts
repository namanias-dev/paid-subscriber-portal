/**
 * Real PostgreSQL multi-connection tests for finalize_course_payment().
 *
 * Requires:
 *   PAYMENT_FINALIZE_PG_URL=postgres://finalize_test:finalize_test@127.0.0.1:5432/finalize_test
 *
 * Skips cleanly when the URL is unset. These tests — not the demoFinalize suite —
 * are the proof of database concurrency safety.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const URL = process.env.PAYMENT_FINALIZE_PG_URL || "";
const describePg = URL ? describe : describe.skip;

function scheduleEmi(opts?: { dues?: boolean; seatPaid?: boolean }) {
  const dues = opts?.dues !== false;
  return [
    {
      no: 0,
      kind: "seat",
      label: "Book Your Seat",
      amount: 2000,
      due: null,
      paid: !!opts?.seatPaid,
      status: opts?.seatPaid ? "paid" : "pending",
      reference_no: opts?.seatPaid ? "SEAT-REF" : null,
      paid_at: opts?.seatPaid ? "2026-08-01T00:00:00Z" : null,
    },
    {
      no: 1,
      kind: "installment",
      label: "Installment 1 of 4",
      amount: 8250,
      due: dues ? "2026-08-10T06:30:00.000Z" : null,
      paid: false,
      status: "pending",
    },
    {
      no: 2,
      kind: "installment",
      label: "Installment 2 of 4",
      amount: 8250,
      due: dues ? "2026-10-10T06:30:00.000Z" : null,
      paid: false,
      status: "pending",
    },
    {
      no: 3,
      kind: "installment",
      label: "Installment 3 of 4",
      amount: 8250,
      due: dues ? "2026-12-10T06:30:00.000Z" : null,
      paid: false,
      status: "pending",
    },
    {
      no: 4,
      kind: "installment",
      label: "Installment 4 of 4",
      amount: 8250,
      due: dues ? "2027-02-10T06:30:00.000Z" : null,
      paid: false,
      status: "pending",
    },
  ];
}

async function resetSchema(client: pg.Client) {
  await client.query(`
    drop schema public cascade;
    create schema public;
    grant all on schema public to public;
  `);
  const root = path.resolve(process.cwd());
  const minimal = fs.readFileSync(path.join(root, "tests/payment-finalize/fixtures/minimal-schema.sql"), "utf8");
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/2026-10-12-course-payment-finalize-atomic.sql"),
    "utf8",
  );
  const repair = fs.readFileSync(path.join(root, "scripts/repair-payment-overallocation.sql"), "utf8");
  await client.query(minimal);
  await client.query(migration);
  await client.query(repair);
}

async function seedEnrollment(
  client: pg.Client,
  id: string,
  schedule: unknown[],
  opts?: Partial<{ amount_paid: number; status: string; email: string; total_fee: number }>,
) {
  await client.query(
    `insert into course_enrollments (
      id, phone, student_name, email, course_title, course_slug, batch_label,
      plan_type, total_fee, amount_paid, installment_count, status, schedule, discount_amount
    ) values ($1,$2,$3,$4,$5,$6,$7,'emi',$8,$9,4,$10,$11::jsonb,10000)`,
    [
      id,
      "9999904740",
      "Test Student",
      opts?.email ?? "test@example.com",
      "Safalta",
      "safalta",
      "Evening",
      opts?.total_fee ?? 35000,
      opts?.amount_paid ?? 2000,
      opts?.status ?? "seat_booked",
      JSON.stringify(schedule),
    ],
  );
}

async function seedPayment(
  client: pg.Client,
  opts: {
    id: string;
    amount: number;
    kind: string;
    ref: string;
    enrollment_id: string;
    installment_no?: number;
    source?: string;
    receipt_no?: string;
  },
) {
  await client.query(
    `insert into payments (
      id, student_name, phone, item, item_type, amount, status, reference_no,
      enrollment_id, payment_kind, installment_no, gateway_ref, payment_source, receipt_no, created_at
    ) values ($1,'Test','9999904740','Course','course',$2,'PAID',$3,$4,$5,$6,'G1',$7,$8,now())`,
    [
      opts.id,
      opts.amount,
      opts.ref,
      opts.enrollment_id,
      opts.kind,
      opts.installment_no ?? null,
      opts.source ?? null,
      opts.receipt_no ?? null,
    ],
  );
}

describePg("finalize_course_payment Postgres RPC", () => {
  let admin: pg.Client;

  before(async () => {
    admin = new pg.Client({ connectionString: URL });
    await admin.connect();
    await resetSchema(admin);
  });

  after(async () => {
    await admin?.end().catch(() => null);
  });

  it("concurrent same-payment callers allocate once", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-race";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: true }), { amount_paid: 2000 });
    await seedPayment(admin, {
      id: "pay-race",
      amount: 8250,
      kind: "installment",
      ref: "REF-RACE",
      enrollment_id: enr,
      installment_no: 1,
    });

    const clients = await Promise.all(
      [0, 1, 2].map(async () => {
        const c = new pg.Client({ connectionString: URL });
        await c.connect();
        return c;
      }),
    );
    try {
      const results = await Promise.all(
        clients.map((c) => c.query(`select public.finalize_course_payment($1, null) as r`, ["REF-RACE"])),
      );
      const payloads = results.map((r) => r.rows[0].r);
      assert.equal(payloads.filter((p) => p.ok).length, 3);
      const created = payloads.filter((p) => p.outcome === "created").length;
      const already = payloads.filter((p) => p.outcome === "already_finalized" || p.outcome === "reconciled_existing").length;
      assert.equal(created, 1);
      assert.equal(already, 2);

      const enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
      assert.equal(enrRow.rows[0].amount_paid, 10250);
      assert.equal(enrRow.rows[0].schedule[1].paid, true);
      assert.equal(enrRow.rows[0].schedule[2].paid, false);
      const rcpt = await admin.query(`select count(*)::int as n from payment_receipts where payment_id='pay-race'`);
      assert.equal(rcpt.rows[0].n, 1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("two distinct payments on one enrollment both apply under enrollment lock", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-two";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: false }), { amount_paid: 0, status: "pending" });
    await seedPayment(admin, { id: "pay-seat", amount: 2000, kind: "seat", ref: "REF-SEAT", enrollment_id: enr, installment_no: 0 });
    await seedPayment(admin, {
      id: "pay-inst",
      amount: 8250,
      kind: "installment",
      ref: "REF-INST",
      enrollment_id: enr,
      installment_no: 1,
    });
    const a = new pg.Client({ connectionString: URL });
    const b = new pg.Client({ connectionString: URL });
    await a.connect();
    await b.connect();
    try {
      const [ra, rb] = await Promise.all([
        a.query(`select public.finalize_course_payment($1, null) as r`, ["REF-SEAT"]),
        b.query(`select public.finalize_course_payment($1, null) as r`, ["REF-INST"]),
      ]);
      assert.equal(ra.rows[0].r.ok, true);
      assert.equal(rb.rows[0].r.ok, true);
      const enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
      assert.equal(enrRow.rows[0].amount_paid, 10250);
      assert.equal(enrRow.rows[0].schedule[0].paid, true);
      assert.equal(enrRow.rows[0].schedule[1].paid, true);
      assert.equal(enrRow.rows[0].schedule[2].paid, false);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("stale due-fill cannot overwrite a concurrent allocation (dues applied under lock)", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-stale";
    await seedEnrollment(admin, enr, scheduleEmi({ dues: false, seatPaid: true }), { amount_paid: 2000 });
    await seedPayment(admin, {
      id: "pay-stale",
      amount: 8250,
      kind: "installment",
      ref: "REF-STALE",
      enrollment_id: enr,
      installment_no: 1,
    });
    const fills = JSON.stringify([
      { no: 1, due: "2026-08-10T06:30:00.000Z" },
      { no: 2, due: "2026-10-10T06:30:00.000Z" },
      { no: 3, due: "2026-12-10T06:30:00.000Z" },
      { no: 4, due: "2027-02-10T06:30:00.000Z" },
    ]);
    const c1 = new pg.Client({ connectionString: URL });
    const c2 = new pg.Client({ connectionString: URL });
    await c1.connect();
    await c2.connect();
    try {
      // First caller finalizes with due fills.
      const r1 = await c1.query(`select public.finalize_course_payment($1, $2::jsonb) as r`, ["REF-STALE", fills]);
      assert.equal(r1.rows[0].r.ok, true);
      assert.equal(r1.rows[0].r.outcome, "created");
      // Second caller retries with the same fills — must not wipe Inst1.
      const r2 = await c2.query(`select public.finalize_course_payment($1, $2::jsonb) as r`, ["REF-STALE", fills]);
      assert.equal(r2.rows[0].r.ok, true);
      assert.ok(["already_finalized", "reconciled_existing"].includes(r2.rows[0].r.outcome));
      const enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
      assert.equal(enrRow.rows[0].amount_paid, 10250);
      assert.equal(enrRow.rows[0].schedule[1].paid, true);
      assert.ok(enrRow.rows[0].schedule[1].due);
      assert.equal(enrRow.rows[0].schedule[2].paid, false);
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it("transaction failure then retry allocates exactly once", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-fail";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: true }), { amount_paid: 2000 });
    await seedPayment(admin, {
      id: "pay-fail",
      amount: 8250,
      kind: "installment",
      ref: "REF-FAIL",
      enrollment_id: enr,
      installment_no: 1,
    });
    const c = new pg.Client({ connectionString: URL });
    await c.connect();
    try {
      await c.query("begin");
      const mid = await c.query(`select public.finalize_course_payment($1, null) as r`, ["REF-FAIL"]);
      assert.equal(mid.rows[0].r.ok, true);
      await c.query("rollback");
      // After rollback, nothing persisted.
      const cnt = await admin.query(`select count(*)::int as n from payment_receipts where payment_id='pay-fail'`);
      assert.equal(cnt.rows[0].n, 0);
      const retry = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["REF-FAIL"]);
      assert.equal(retry.rows[0].r.outcome, "created");
      const enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
      assert.equal(enrRow.rows[0].amount_paid, 10250);
      assert.equal(enrRow.rows[0].schedule[2].paid, false);
    } finally {
      await c.end();
    }
  });

  it("historical duplicate receipts reconcile without re-allocation; phantom pointer not certified blindly", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-dup";
    const sched = scheduleEmi({ seatPaid: true });
    sched[1] = { ...sched[1]!, paid: true, status: "paid", reference_no: "REF-DUP", paid_at: "2026-08-10T06:40:29Z" };
    // Bug state: Inst2 also stamped — reconcile must not allocate further.
    sched[2] = { ...sched[2]!, paid: true, status: "paid", reference_no: "REF-DUP", paid_at: "2026-08-10T06:40:31Z" };
    await seedEnrollment(admin, enr, sched, { amount_paid: 18500, status: "partially_paid" });
    await seedPayment(admin, {
      id: "pay-dup",
      amount: 8250,
      kind: "installment",
      ref: "REF-DUP",
      enrollment_id: enr,
      installment_no: 1,
      receipt_no: "NSA-PHANTOM",
    });
    await admin.query(
      `insert into payment_receipts (
        id, receipt_no, enrollment_id, payment_id, reference_no, phone, student_name,
        course_title, payment_kind, payment_label, amount, total_fee, paid_to_date, remaining, issued_at
      ) values
      ('r1','NSA-GOOD',$1,'pay-dup','REF-DUP','9999904740','T','Safalta','installment','Installment 1 of 4',8250,35000,10250,24750,'2026-08-10T06:40:29Z'),
      ('r2','NSA-DUP',$1,'pay-dup','REF-DUP','9999904740','T','Safalta','installment','Installment 1 of 4',8250,35000,10250,24750,'2026-08-10T06:40:29.1Z'),
      ('r3','NSA-PHANTOM',$1,'pay-dup','REF-DUP','9999904740','T','Safalta','installment','Installment 2 of 4',8250,35000,18500,16500,'2026-08-10T06:40:31Z')`,
      [enr],
    );
    const r = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["REF-DUP"]);
    // Ambiguous evidence (two Inst1 rows) with phantom pointer → review_required OR
    // single earliest evidence Inst1 if SQL collapses duplicates by label — accept either
    // non-allocating outcome.
    assert.equal(r.rows[0].r.ok === false || r.rows[0].r.outcome === "reconciled_existing", true);
    const enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
    assert.equal(enrRow.rows[0].amount_paid, 18500, "must not re-allocate");
    assert.equal(enrRow.rows[0].schedule[3].paid, false);
  });

  it("partial installment remainder then completion conserves money", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-partial";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: true }), { amount_paid: 2000 });
    await seedPayment(admin, {
      id: "pay-p1",
      amount: 3000,
      kind: "installment",
      ref: "REF-P1",
      enrollment_id: enr,
      installment_no: 1,
      source: "student_proof",
    });
    const r1 = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["REF-P1"]);
    assert.equal(r1.rows[0].r.ok, true);
    let enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
    assert.equal(enrRow.rows[0].schedule[1].status, "partially_paid");
    assert.equal(enrRow.rows[0].schedule[1].paid_amount, 3000);
    assert.equal(enrRow.rows[0].amount_paid, 5000);

    await seedPayment(admin, {
      id: "pay-p2",
      amount: 5250,
      kind: "installment",
      ref: "REF-P2",
      enrollment_id: enr,
      installment_no: 1,
      source: "student_proof",
    });
    const r2 = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["REF-P2"]);
    assert.equal(r2.rows[0].r.ok, true);
    enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
    assert.equal(enrRow.rows[0].schedule[1].paid, true);
    assert.equal(enrRow.rows[0].amount_paid, 10250);
    assert.equal(enrRow.rows[0].schedule[2].paid, false);
  });

  it("full payment after partial installment clears remainder then next lines", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-full";
    const sched = scheduleEmi({ seatPaid: true });
    sched[1] = {
      ...sched[1]!,
      paid: false,
      status: "partially_paid",
      paid_amount: 2000,
      reference_no: "REF-PART",
    };
    await seedEnrollment(admin, enr, sched, { amount_paid: 4000, status: "partially_paid" });
    await seedPayment(admin, {
      id: "pay-full",
      amount: 20000,
      kind: "full",
      ref: "REF-FULL",
      enrollment_id: enr,
    });
    const r = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["REF-FULL"]);
    assert.equal(r.rows[0].r.ok, true);
    const enrRow = await admin.query(`select amount_paid, schedule from course_enrollments where id=$1`, [enr]);
    // Seat 2000 + prior partial 2000 + full 20000 = 24000 allocated on schedule net
    assert.equal(enrRow.rows[0].schedule[1].paid, true);
    assert.ok(enrRow.rows[0].amount_paid >= 10250);
    assert.ok(enrRow.rows[0].amount_paid <= 35000);
    const net = enrRow.rows[0].amount_paid;
    assert.equal(net, 24000);
  });

  it("offline OFF- reference finalizes once", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-off";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: true }), { amount_paid: 2000 });
    await seedPayment(admin, {
      id: "pay-off",
      amount: 8250,
      kind: "installment",
      ref: "OFF-MSMZL7X3-Y2JN",
      enrollment_id: enr,
      installment_no: 1,
    });
    const r1 = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["OFF-MSMZL7X3-Y2JN"]);
    const r2 = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["OFF-MSMZL7X3-Y2JN"]);
    assert.equal(r1.rows[0].r.outcome, "created");
    assert.ok(["already_finalized", "reconciled_existing"].includes(r2.rows[0].r.outcome));
    const rcpt = await admin.query(`select count(*)::int as n from payment_receipts where payment_id='pay-off'`);
    assert.equal(rcpt.rows[0].n, 1);
  });

  it("missing receipt_no pointer with no rows returns review_required", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-missing";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: true }), { amount_paid: 2000 });
    await seedPayment(admin, {
      id: "pay-miss",
      amount: 8250,
      kind: "installment",
      ref: "REF-MISS",
      enrollment_id: enr,
      installment_no: 1,
      receipt_no: "NSA-DOES-NOT-EXIST",
    });
    const r = await admin.query(`select public.finalize_course_payment($1, null) as r`, ["REF-MISS"]);
    assert.equal(r.rows[0].r.ok, false);
    assert.equal(r.rows[0].r.outcome, "review_required");
    const enrRow = await admin.query(`select amount_paid from course_enrollments where id=$1`, [enr]);
    assert.equal(enrRow.rows[0].amount_paid, 2000);
  });

  it("repair fixture for Udaydeep-style over-allocation is repeat-safe", async () => {
    await admin.query(
      "truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger, payment_repair_snapshots, enrollment_transfers cascade",
    );
    const morning = "enr-morning";
    const evening = "enr-evening";
    const morningSched = scheduleEmi({ seatPaid: true });
    await seedEnrollment(admin, morning, morningSched, { amount_paid: 2000, status: "transferred_out" });
    const eveningSched = scheduleEmi({ seatPaid: true });
    eveningSched[0] = { ...eveningSched[0]!, reference_no: "SEAT-TRANSFER", paid: true, status: "paid" };
    eveningSched[1] = {
      ...eveningSched[1]!,
      paid: true,
      status: "paid",
      reference_no: "REF-UD",
      paid_at: "2026-08-10T06:40:29Z",
    };
    eveningSched[2] = {
      ...eveningSched[2]!,
      paid: true,
      status: "paid",
      reference_no: "REF-UD",
      paid_at: "2026-08-10T06:40:31Z",
    };
    await seedEnrollment(admin, evening, eveningSched, { amount_paid: 18500, status: "partially_paid" });
    await admin.query(
      `insert into enrollment_transfers (id, from_enrollment_id, to_enrollment_id, amount_paid, reason)
       values ('tr1',$1,$2,2000,'batch change')`,
      [morning, evening],
    );
    await seedPayment(admin, {
      id: "pay-seat-m",
      amount: 2000,
      kind: "seat",
      ref: "SEAT-TRANSFER",
      enrollment_id: morning,
      installment_no: 0,
    });
    await seedPayment(admin, {
      id: "pay-ud",
      amount: 8250,
      kind: "installment",
      ref: "REF-UD",
      enrollment_id: evening,
      installment_no: 1,
      receipt_no: "NSA-UD-3",
    });
    await admin.query(
      `insert into payment_receipts (
        id, receipt_no, enrollment_id, payment_id, reference_no, phone, student_name,
        course_title, payment_kind, payment_label, amount, total_fee, paid_to_date, remaining, issued_at
      ) values
      ('ud1','NSA-UD-1',$1,'pay-ud','REF-UD','9999904740','U','Safalta','installment','Installment 1 of 4',8250,35000,10250,24750,'2026-08-10T06:40:29Z'),
      ('ud2','NSA-UD-2',$1,'pay-ud','REF-UD','9999904740','U','Safalta','installment','Installment 1 of 4',8250,35000,10250,24750,'2026-08-10T06:40:29.1Z'),
      ('ud3','NSA-UD-3',$1,'pay-ud','REF-UD','9999904740','U','Safalta','installment','Installment 2 of 4',8250,35000,18500,16500,'2026-08-10T06:40:31Z')`,
      [evening],
    );

    const repair1 = await admin.query(
      `select public.repair_course_overallocation_case(
        $1, 18500, 'partially_paid', 'pay-ud', 'ud1', array['ud2','ud3']::text[],
        array[2]::int[], 10250, 'partially_paid', 'fixture-ud', true, null
      ) as r`,
      [evening],
    );
    assert.equal(repair1.rows[0].r.ok, true);
    const enrRow = await admin.query(`select amount_paid, schedule, status from course_enrollments where id=$1`, [evening]);
    assert.equal(enrRow.rows[0].amount_paid, 10250);
    assert.equal(enrRow.rows[0].schedule[1].paid, true);
    assert.equal(enrRow.rows[0].schedule[2].paid, false);
    assert.equal(enrRow.rows[0].schedule[0].paid, true, "transferred seat retained");
    const seatPay = await admin.query(`select enrollment_id from payments where id='pay-seat-m'`);
    assert.equal(seatPay.rows[0].enrollment_id, morning, "seat payment enrollment_id preserved");

    const repair2 = await admin.query(
      `select public.repair_course_overallocation_case(
        $1, 18500, 'partially_paid', 'pay-ud', 'ud1', array['ud2','ud3']::text[],
        array[2]::int[], 10250, 'partially_paid', 'fixture-ud', true, null
      ) as r`,
      [evening],
    );
    assert.equal(repair2.rows[0].r.outcome, "already_repaired");
  });
});
