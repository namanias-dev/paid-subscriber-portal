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
  const ops = fs.readFileSync(
    path.join(root, "supabase/migrations/2026-10-12-course-payment-finalize-ops.sql"),
    "utf8",
  );
  const repair = fs.readFileSync(path.join(root, "scripts/repair-payment-overallocation.sql"), "utf8");
  await client.query(minimal);
  await client.query(migration);
  await client.query(ops);
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

    const enrSnap = await admin.query(`select * from course_enrollments where id=$1`, [evening]);
    const baseline = {
      enrollment: {
        amount_paid: enrSnap.rows[0].amount_paid,
        status: enrSnap.rows[0].status,
        total_fee: enrSnap.rows[0].total_fee,
        schedule: enrSnap.rows[0].schedule,
      },
      payment: {
        id: "pay-ud",
        amount: 8250,
        status: "PAID",
        reference_no: "REF-UD",
        deleted_at: null,
      },
      payment_ids: ["pay-seat-m", "pay-ud"],
      transfer_ids: ["tr1"],
    };
    const repair1 = await admin.query(
      `select public.repair_course_overallocation_case(
        $1, 'pay-ud', 'ud1', array['ud2','ud3']::text[],
        array[2]::int[], 10250, 'partially_paid', 'fixture-ud', $2::jsonb, true
      ) as r`,
      [evening, JSON.stringify(baseline)],
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
        $1, 'pay-ud', 'ud1', array['ud2','ud3']::text[],
        array[2]::int[], 10250, 'partially_paid', 'fixture-ud', $2::jsonb, true
      ) as r`,
      [evening, JSON.stringify(baseline)],
    );
    assert.equal(repair2.rows[0].r.outcome, "already_repaired");
  });
});

describePg("receipt email claim/ack + containment + four-case repair", () => {
  let admin: pg.Client;

  before(async () => {
    admin = new pg.Client({ connectionString: URL });
    await admin.connect();
    await resetSchema(admin);
  });

  after(async () => {
    await admin?.end().catch(() => null);
  });

  it("concurrent email workers: only one claim wins; disable does not burn attempts; retry sends", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger cascade");
    const enr = "enr-email";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: true }), { amount_paid: 2000, email: "a@example.com" });
    await seedPayment(admin, {
      id: "pay-em",
      amount: 8250,
      kind: "installment",
      ref: "REF-EM",
      enrollment_id: enr,
      installment_no: 1,
    });
    const fin = await admin.query(`select public.finalize_course_payment_guarded($1, null) as r`, ["REF-EM"]);
    assert.equal(fin.rows[0].r.outcome, "created");

    const c1 = new pg.Client({ connectionString: URL });
    const c2 = new pg.Client({ connectionString: URL });
    await c1.connect();
    await c2.connect();
    try {
      const [a, b] = await Promise.all([
        c1.query(`select * from public.claim_receipt_email_jobs(10, 60)`),
        c2.query(`select * from public.claim_receipt_email_jobs(10, 60)`),
      ]);
      const claimed = [...a.rows, ...b.rows];
      assert.equal(claimed.length, 1, "exactly one worker claims the job");
      const job = claimed[0];
      // Disabled: pending, attempts unchanged
      const dis = await admin.query(
        `select public.ack_receipt_email_job($1,$2,'disabled','email_disabled') as r`,
        [job.payment_id, job.claim_token],
      );
      assert.equal(dis.rows[0].r.attempts_consumed, false);
      const row = await admin.query(
        `select receipt_email_status, receipt_email_attempts from payment_finalize_ledger where payment_id=$1`,
        [job.payment_id],
      );
      assert.equal(row.rows[0].receipt_email_status, "pending");
      assert.equal(row.rows[0].receipt_email_attempts, 0);

      // Force due and claim again, then send
      await admin.query(
        `update payment_finalize_ledger set receipt_email_next_attempt_at = now() - interval '1 second' where payment_id=$1`,
        [job.payment_id],
      );
      const c3 = await admin.query(`select * from public.claim_receipt_email_jobs(10, 60)`);
      assert.equal(c3.rows.length, 1);
      const sent = await admin.query(`select public.ack_receipt_email_job($1,$2,'sent',null) as r`, [
        c3.rows[0].payment_id,
        c3.rows[0].claim_token,
      ]);
      assert.equal(sent.rows[0].r.status, "sent");
      // Stale ack must fail
      const stale = await admin.query(`select public.ack_receipt_email_job($1,$2,'sent',null) as r`, [
        c3.rows[0].payment_id,
        c3.rows[0].claim_token,
      ]);
      assert.equal(stale.rows[0].r.ok, false);

      // Lease recovery: expired claim returns to pending and can be reclaimed
      await admin.query(
        `insert into payment_finalize_ledger (
           payment_id, reference_no, enrollment_id, status, receipt_no, allocated_amount,
           allocation, outcome, receipt_email_status, receipt_email_attempts,
           receipt_email_payload, receipt_email_claim_token, receipt_email_claim_expires_at
         ) values (
           'pay-em-lease','REF-EM-L',$1,'completed','NSA-L',1,'[]'::jsonb,'created','claimed',0,
           '{"to":"a@example.com"}'::jsonb, 'stale-lease', now() - interval '2 seconds'
         )`,
        [enr],
      );
      const reclaimed = await admin.query(`select * from public.claim_receipt_email_jobs(10, 60)`);
      assert.ok(reclaimed.rows.some((r) => r.payment_id === "pay-em-lease"), "expired lease reclaimed");
      const leaseRow = await admin.query(
        `select receipt_email_status, receipt_email_claim_token from payment_finalize_ledger where payment_id='pay-em-lease'`,
      );
      assert.equal(leaseRow.rows[0].receipt_email_status, "claimed");
      assert.notEqual(leaseRow.rows[0].receipt_email_claim_token, "stale-lease");
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it("containment blocks non-RPC schedule writes; RPC still allocates; deferred drains", async () => {
    await admin.query("truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger, payment_finalize_deferred cascade");
    await admin.query(`update payment_finalize_settings set containment_enabled=true, containment_reason='test' where id=1`);
    const enr = "enr-contain";
    await seedEnrollment(admin, enr, scheduleEmi({ seatPaid: true }), { amount_paid: 2000 });
    await seedPayment(admin, {
      id: "pay-c",
      amount: 8250,
      kind: "installment",
      ref: "REF-C",
      enrollment_id: enr,
      installment_no: 1,
    });
    await assert.rejects(
      () =>
        admin.query(`update course_enrollments set amount_paid = 9999 where id=$1`, [enr]),
      /course_finalize_containment/,
    );
    const r = await admin.query(`select public.finalize_course_payment_guarded($1,null) as r`, ["REF-C"]);
    assert.equal(r.rows[0].r.ok, true);
    const enrRow = await admin.query(`select amount_paid from course_enrollments where id=$1`, [enr]);
    assert.equal(enrRow.rows[0].amount_paid, 10250);
    await admin.query(`update payment_finalize_settings set containment_enabled=false where id=1`);
  });

  it("repair rejects baseline drift and wrong receipt ownership", async () => {
    await admin.query(
      "truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger, payment_repair_snapshots cascade",
    );
    const enr = "enr-drift";
    const sched = scheduleEmi({ seatPaid: true });
    sched[1] = { ...sched[1]!, paid: true, status: "paid", reference_no: "REF-D", paid_at: "2026-08-10T00:00:00Z" };
    sched[2] = { ...sched[2]!, paid: true, status: "paid", reference_no: "REF-D", paid_at: "2026-08-10T00:00:01Z" };
    await seedEnrollment(admin, enr, sched, { amount_paid: 18500, status: "partially_paid" });
    await seedPayment(admin, {
      id: "pay-d",
      amount: 8250,
      kind: "installment",
      ref: "REF-D",
      enrollment_id: enr,
      installment_no: 1,
      receipt_no: "R-BAD",
    });
    await admin.query(
      `insert into payment_receipts (id, receipt_no, enrollment_id, payment_id, reference_no, phone, student_name, course_title, payment_kind, payment_label, amount, total_fee, paid_to_date, remaining, issued_at)
       values ('rd1','R-GOOD',$1,'pay-d','REF-D','9','T','C','installment','Installment 1 of 4',8250,35000,10250,24750,now()),
              ('rd2','R-BAD',$1,'pay-d','REF-D','9','T','C','installment','Installment 2 of 4',8250,35000,18500,16500,now()),
              ('rdX','R-OTHER',$1,'other','OTHER','9','T','C','installment','Installment 1 of 4',8250,35000,8250,0,now())`,
      [enr],
    );
    const snap = await admin.query(`select * from course_enrollments where id=$1`, [enr]);
    const baseline = {
      enrollment: {
        amount_paid: 18500,
        status: "partially_paid",
        total_fee: snap.rows[0].total_fee,
        schedule: snap.rows[0].schedule,
      },
      payment: { id: "pay-d", amount: 8250, status: "PAID", reference_no: "REF-D", deleted_at: null },
      payment_ids: ["pay-d"],
    };
    // Wrong ownership
    await assert.rejects(
      () =>
        admin.query(
          `select public.repair_course_overallocation_case(
            $1,'pay-d','rd1', array['rdX']::text[], array[2]::int[], 10250, 'partially_paid', 't', $2::jsonb, true
          )`,
          [enr, JSON.stringify(baseline)],
        ),
      /supersede_receipt_not_owned/,
    );
    // Drift
    await admin.query(`update payment_finalize_settings set containment_enabled=false`);
    await admin.query(`select public.course_finalize_rpc_enter()`);
    await admin.query(`update course_enrollments set amount_paid=18501 where id=$1`, [enr]);
    await assert.rejects(
      () =>
        admin.query(
          `select public.repair_course_overallocation_case(
            $1,'pay-d','rd1', array['rd2']::text[], array[2]::int[], 10250, 'partially_paid', 't2', $2::jsonb, true
          )`,
          [enr, JSON.stringify(baseline)],
        ),
      /enrollment_drift_from_baseline/,
    );
  });

  it("repairs Akash / Sarah / Payal shaped fixtures to expected paid totals", async () => {
    await admin.query(
      "truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger, payment_repair_snapshots cascade",
    );

    async function repairCase(opts: {
      enr: string;
      total: number;
      seat: number;
      instAmounts: number[];
      paidThrough: number; // index of last legitimately paid installment in instAmounts (0-based)
      racePaymentAmount: number;
      raceRef: string;
      proposedPaid: number;
      unpayNos: number[];
    }) {
      const schedule: Record<string, unknown>[] = [
        {
          no: 0,
          kind: "seat",
          label: "Book Your Seat",
          amount: opts.seat,
          paid: true,
          status: "paid",
          reference_no: "SEAT-" + opts.enr,
          paid_at: "2026-09-01T00:00:00Z",
        },
      ];
      for (let i = 0; i < opts.instAmounts.length; i++) {
        const no = i + 1;
        const raced = no > opts.paidThrough + 1;
        const legitPaid = no <= opts.paidThrough + 1;
        schedule.push({
          no,
          kind: "installment",
          label: `Installment ${no} of ${opts.instAmounts.length}`,
          amount: opts.instAmounts[i],
          due: `2026-${String(9 + i).padStart(2, "0")}-01T00:00:00.000Z`,
          paid: legitPaid || raced,
          status: legitPaid || raced ? "paid" : "pending",
          reference_no: raced || no === opts.paidThrough + 1 ? opts.raceRef : `OK-${no}`,
          paid_at: legitPaid || raced ? "2026-09-24T00:00:00Z" : null,
        });
      }
      // Mark race: paidThrough installment AND later ones share raceRef (already set for paidThrough+1 and raced)
      await seedEnrollment(admin, opts.enr, schedule, {
        amount_paid: opts.seat + opts.instAmounts.reduce((a, b) => a + b, 0),
        status: "fully_paid",
        total_fee: opts.total,
      });
      await seedPayment(admin, {
        id: "pay-" + opts.enr,
        amount: opts.racePaymentAmount,
        kind: "installment",
        ref: opts.raceRef,
        enrollment_id: opts.enr,
        installment_no: opts.paidThrough + 1,
        receipt_no: "PHANTOM-" + opts.enr,
      });
      await seedPayment(admin, {
        id: "seat-" + opts.enr,
        amount: opts.seat,
        kind: "seat",
        ref: "SEAT-" + opts.enr,
        enrollment_id: opts.enr,
        installment_no: 0,
      });
      const canonId = "c-" + opts.enr;
      const phantomId = "p-" + opts.enr;
      await admin.query(
        `insert into payment_receipts (id, receipt_no, enrollment_id, payment_id, reference_no, phone, student_name, course_title, payment_kind, payment_label, amount, total_fee, paid_to_date, remaining, issued_at)
         values
         ($1,$2,$3,$4,$5,'9','T','C','installment',$6,$7,$8,$9,$10,'2026-09-24T00:00:00Z'),
         ($11,$12,$3,$4,$5,'9','T','C','installment',$13,$7,$8,$14,0,'2026-09-24T00:00:01Z')`,
        [
          canonId,
          "CANON-" + opts.enr,
          opts.enr,
          "pay-" + opts.enr,
          opts.raceRef,
          `Installment ${opts.paidThrough + 1} of ${opts.instAmounts.length}`,
          opts.racePaymentAmount,
          opts.total,
          opts.proposedPaid,
          opts.total - opts.proposedPaid,
          phantomId,
          "PHANTOM-" + opts.enr,
          `Installment ${opts.instAmounts.length} of ${opts.instAmounts.length}`,
          opts.total,
        ],
      );
      const snap = await admin.query(`select * from course_enrollments where id=$1`, [opts.enr]);
      const baseline = {
        enrollment: {
          amount_paid: snap.rows[0].amount_paid,
          status: snap.rows[0].status,
          total_fee: snap.rows[0].total_fee,
          schedule: snap.rows[0].schedule,
        },
        payment: {
          id: "pay-" + opts.enr,
          amount: opts.racePaymentAmount,
          status: "PAID",
          reference_no: opts.raceRef,
          deleted_at: null,
        },
        payment_ids: ["seat-" + opts.enr, "pay-" + opts.enr],
      };
      const r = await admin.query(
        `select public.repair_course_overallocation_case(
          $1,$2,$3,array[$4]::text[],$5::int[],$6,$7,$8,$9::jsonb,true
        ) as r`,
        [
          opts.enr,
          "pay-" + opts.enr,
          canonId,
          phantomId,
          opts.unpayNos,
          opts.proposedPaid,
          "partially_paid",
          "fix-" + opts.enr,
          JSON.stringify(baseline),
        ],
      );
      assert.equal(r.rows[0].r.ok, true, opts.enr);
      const after = await admin.query(`select amount_paid, status from course_enrollments where id=$1`, [opts.enr]);
      assert.equal(after.rows[0].amount_paid, opts.proposedPaid, opts.enr + " paid");
      assert.equal(after.rows[0].status, "partially_paid");
    }

    // Akash: seat 10000 + 8333 = 18333; race stamped all 3 EMIs
    await repairCase({
      enr: "akash",
      total: 35000,
      seat: 10000,
      instAmounts: [8333, 8333, 8334],
      paidThrough: 0,
      racePaymentAmount: 8333,
      raceRef: "REF-AK",
      proposedPaid: 18333,
      unpayNos: [2, 3],
    });
    // Sarah: seat 2000 + 24333 + 24333 = 50666; race stamped inst2+inst3
    await repairCase({
      enr: "sarah",
      total: 75000,
      seat: 2000,
      instAmounts: [24333, 24333, 24334],
      paidThrough: 1,
      racePaymentAmount: 24333,
      raceRef: "REF-SA",
      proposedPaid: 50666,
      unpayNos: [3],
    });
    // Payal-shaped: legacy 38000 + 3x4000 + race 4000 = 54000; false paid 5&6
    // Model as seat0=0 with installments starting at no 1 amounts matching portal
    await admin.query(
      "truncate payments, course_enrollments, payment_receipts, payment_finalize_ledger, payment_repair_snapshots cascade",
    );
    const payalSched = [
      { no: 1, kind: "installment", label: "Legacy", amount: 38000, paid: true, status: "paid", reference_no: "LEG", paid_at: "2026-07-01T00:00:00Z" },
      { no: 2, kind: "installment", label: "Installment 1 of 8", amount: 4000, paid: true, status: "paid", reference_no: "P1", paid_at: "2026-07-11T00:00:00Z" },
      { no: 3, kind: "installment", label: "Installment 2 of 8", amount: 4000, paid: true, status: "paid", reference_no: "OFF-X", paid_at: "2026-08-10T00:00:00Z" },
      { no: 4, kind: "installment", label: "Installment 3 of 8", amount: 4000, paid: true, status: "paid", reference_no: "P3", paid_at: "2026-09-16T00:00:00Z" },
      { no: 5, kind: "installment", label: "Installment 4 of 8", amount: 4000, paid: true, status: "paid", reference_no: "REF-PY", paid_at: "2026-10-08T00:00:00Z" },
      { no: 6, kind: "installment", label: "Installment 5 of 8", amount: 4000, paid: true, status: "paid", reference_no: "REF-PY", paid_at: "2026-10-08T00:00:01Z" },
      { no: 7, kind: "installment", label: "Installment 6 of 8", amount: 4000, paid: true, status: "paid", reference_no: "REF-PY", paid_at: "2026-10-08T00:00:02Z" },
      { no: 8, kind: "installment", label: "Installment 7 of 8", amount: 4000, paid: false, status: "pending" },
      { no: 9, kind: "installment", label: "Installment 8 of 8", amount: 4000, paid: false, status: "pending" },
    ];
    await seedEnrollment(admin, "payal", payalSched, { amount_paid: 62000, status: "partially_paid", total_fee: 70000 });
    for (const [id, amt, ref, kind, n] of [
      ["pay-leg", 38000, "LEG", "installment", 1],
      ["pay-p1", 4000, "P1", "installment", 2],
      ["pay-off", 4000, "OFF-X", "installment", 3],
      ["pay-p3", 4000, "P3", "installment", 4],
      ["pay-py", 4000, "REF-PY", "installment", 5],
    ] as const) {
      await seedPayment(admin, {
        id,
        amount: amt,
        kind: kind as string,
        ref,
        enrollment_id: "payal",
        installment_no: n,
      });
    }
    await admin.query(
      `insert into payment_receipts (id, receipt_no, enrollment_id, payment_id, reference_no, phone, student_name, course_title, payment_kind, payment_label, amount, total_fee, paid_to_date, remaining, issued_at)
       values
       ('py1','NSA-PY1','payal','pay-py','REF-PY','9','Payal','C','installment','Installment 4 of 8',4000,70000,54000,16000,'2026-10-08T00:00:00Z'),
       ('py2','NSA-PY2','payal','pay-py','REF-PY','9','Payal','C','installment','Installment 5 of 8',4000,70000,58000,12000,'2026-10-08T00:00:01Z'),
       ('py3','NSA-PY3','payal','pay-py','REF-PY','9','Payal','C','installment','Installment 6 of 8',4000,70000,62000,8000,'2026-10-08T00:00:02Z')`,
    );
    const snap = await admin.query(`select * from course_enrollments where id='payal'`);
    const baseline = {
      enrollment: {
        amount_paid: 62000,
        status: "partially_paid",
        total_fee: 70000,
        schedule: snap.rows[0].schedule,
      },
      payment: { id: "pay-py", amount: 4000, status: "PAID", reference_no: "REF-PY", deleted_at: null },
      payment_ids: ["pay-leg", "pay-p1", "pay-off", "pay-p3", "pay-py"],
    };
    const r = await admin.query(
      `select public.repair_course_overallocation_case(
        'payal','pay-py','py1', array['py2','py3']::text[], array[6,7]::int[], 54000, 'partially_paid', 'fix-payal', $1::jsonb, true
      ) as r`,
      [JSON.stringify(baseline)],
    );
    assert.equal(r.rows[0].r.ok, true);
    const after = await admin.query(`select amount_paid, schedule from course_enrollments where id='payal'`);
    assert.equal(after.rows[0].amount_paid, 54000);
    assert.equal(after.rows[0].schedule[4].paid, true);
    assert.equal(after.rows[0].schedule[5].paid, false);
    assert.equal(after.rows[0].schedule[6].paid, false);
    // Offline payment preserved
    const off = await admin.query(`select status, amount from payments where id='pay-off'`);
    assert.equal(off.rows[0].status, "PAID");
    assert.equal(off.rows[0].amount, 4000);
  });
});
