/**
 * Guards against a repeat of the 2026-07-24 read-only outage.
 *
 * The failure was not that the disk filled — it was that nothing measured the
 * cost before the write started and nothing warned while headroom vanished.
 * These tests pin both halves.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyStorage,
  preflightDiskCheck,
  projectBulkWriteBytes,
  DISK_BYTES,
  WARN_THRESHOLD,
  PREFLIGHT_CEILING,
  CRITICAL_THRESHOLD,
} from "../../lib/ops/storageGuard";

const GB = 1024 * 1024 * 1024;

describe("storage classification", () => {
  it("is ok well below the warning line", () => {
    // The state right after the Pro upgrade: 1,076 MB of 8 GB.
    const h = classifyStorage(1076 * 1024 * 1024);
    assert.equal(h.level, "ok");
    assert.ok(h.utilisation < WARN_THRESHOLD);
  });

  it("warns exactly AT 70%, not just above it", () => {
    assert.equal(classifyStorage(DISK_BYTES * WARN_THRESHOLD).level, "warn");
  });

  it("stays ok just below 70%", () => {
    assert.equal(classifyStorage(DISK_BYTES * (WARN_THRESHOLD - 0.001)).level, "ok");
  });

  it("escalates to critical at 85%", () => {
    assert.equal(classifyStorage(DISK_BYTES * CRITICAL_THRESHOLD).level, "critical");
  });

  it("would have flagged the outage state", () => {
    // Near-full volume: exactly the condition that flipped Postgres read-only
    // with no prior warning anywhere in the product.
    const h = classifyStorage(7.9 * GB);
    assert.equal(h.level, "critical");
    assert.match(h.message, /read-only/);
  });

  it("does not divide by zero on a nonsense disk size", () => {
    assert.equal(classifyStorage(1 * GB, 0).utilisation, 0);
  });
});

describe("bulk-write projection", () => {
  it("counts WAL as well as new heap", () => {
    // MVCC writes a whole new row version AND a WAL record; charging only the
    // heap is what makes a backfill look affordable right up until it isn't.
    assert.equal(projectBulkWriteBytes(1000, 2600), 1000 * 2600 * 2);
  });
});

describe("pre-flight disk check", () => {
  it("allows a normal import with plenty of headroom", () => {
    const r = preflightDiskCheck({ currentUsedBytes: 1 * GB, rowCount: 5_000, avgRowBytes: 2600 });
    assert.equal(r.allowed, true);
  });

  it("REFUSES the write that caused the outage, on the volume it happened on", () => {
    // The real 2026-07-24 conditions: the free-tier volume, already ~0.7 GB
    // used, and a 179k-row bulk write. Projected heap+WAL is ~0.87 GB, so the
    // job needed more space than the whole disk had. This is the call that
    // must fail loudly before the first row is written.
    const r = preflightDiskCheck({
      currentUsedBytes: 0.7 * GB,
      rowCount: 179_000,
      avgRowBytes: 2600,
      diskBytes: 1 * GB,
    });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /REFUSING TO START/);
    assert.match(r.reason, /179,000 rows/);
  });

  it("permits that same write once the volume is big enough", () => {
    // Same job, Pro's 8 GB volume: ~0.87 GB projected onto 1 GB used lands
    // near 23%. The guard must not block work that genuinely fits, or it will
    // be disabled the first time it cries wolf.
    const r = preflightDiskCheck({
      currentUsedBytes: 1 * GB,
      rowCount: 179_000,
      avgRowBytes: 2600,
    });
    assert.equal(r.allowed, true);
    assert.ok(r.projectedUtilisation < PREFLIGHT_CEILING);
  });

  it("blocks strictly above the 80% ceiling and permits at-or-below", () => {
    const disk = 10 * GB;
    const atCeiling = preflightDiskCheck({
      currentUsedBytes: disk * PREFLIGHT_CEILING,
      rowCount: 0,
      avgRowBytes: 2600,
      diskBytes: disk,
    });
    assert.equal(atCeiling.allowed, true, "exactly at the ceiling is allowed");

    const overCeiling = preflightDiskCheck({
      currentUsedBytes: disk * PREFLIGHT_CEILING,
      rowCount: 1_000_000,
      avgRowBytes: 2600,
      diskBytes: disk,
    });
    assert.equal(overCeiling.allowed, false);
  });

  it("reports the projected footprint so the operator can size the job", () => {
    const r = preflightDiskCheck({ currentUsedBytes: 1 * GB, rowCount: 100_000, avgRowBytes: 2600 });
    assert.equal(r.projectedBytes, 100_000 * 2600 * 2);
    assert.ok(r.projectedUtilisation > 0);
  });
});
