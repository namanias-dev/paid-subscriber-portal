import assert from "node:assert/strict";
import { autoPrepareOnce, eligibleForAutoPrepare, paidRollup } from "../../lib/store/opsBoard";

const now = Date.parse("2026-09-27T12:00:00.000Z");
const min = 60 * 1000;

function order(status: string, paidMinutesAgo: number | null) {
  return {
    status,
    paid_at: paidMinutesAgo == null ? null : new Date(now - paidMinutesAgo * min).toISOString(),
    total_paise: 259900,
  };
}

const paidOld = order("ORDER_CONFIRMED", 6);
assert.equal(eligibleForAutoPrepare(paidOld, now), true);
assert.equal(autoPrepareOnce([paidOld], now)[0].status, "PROCESSING");

const paidFresh = order("ORDER_CONFIRMED", 2);
assert.equal(eligibleForAutoPrepare(paidFresh, now), false);
assert.equal(autoPrepareOnce([paidFresh], now)[0].status, "ORDER_CONFIRMED");

assert.equal(eligibleForAutoPrepare(order("PAYMENT_PENDING", 20), now), false);
assert.equal(eligibleForAutoPrepare({ status: "ORDER_CONFIRMED", paid_at: null }, now), false);
assert.equal(eligibleForAutoPrepare(order("CANCELLED", 20), now), false);
assert.equal(eligibleForAutoPrepare(order("REFUNDED", 20), now), false);
assert.equal(eligibleForAutoPrepare(order("PROCESSING", 20), now), false);

const twice = autoPrepareOnce(autoPrepareOnce([paidOld], now), now);
assert.equal(twice[0].status, "PROCESSING");

const manual = { ...paidOld, status: "PROCESSING" };
assert.equal(autoPrepareOnce([manual], now)[0].status, "PROCESSING");

const laterPaid = { status: "ORDER_CONFIRMED", paid_at: new Date(now - 2 * min).toISOString(), placed_at: new Date(now - 40 * min).toISOString() };
assert.equal(eligibleForAutoPrepare(laterPaid, now), false);
assert.equal(eligibleForAutoPrepare({ ...laterPaid, paid_at: new Date(now - 6 * min).toISOString() }, now), true);

const rollup = paidRollup([
  order("ORDER_CONFIRMED", 6),
  order("DELIVERED", 60),
  order("PAYMENT_PENDING", null),
  order("CANCELLED", 10),
  order("REFUNDED", 10),
  { status: "PAYMENT_PENDING", paid_at: null, total_paise: 999 },
]);
assert.equal(rollup.orders, 2);
assert.equal(rollup.salesPaise, 259900 * 2);

console.log("ops board ok");
