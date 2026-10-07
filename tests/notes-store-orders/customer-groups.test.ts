import assert from "node:assert/strict";
import { groupMatchesBucket, groupNotesCustomers, isCapturedNotesOrder, notesCustomerKey } from "../../lib/store/customerGroups";

function row(partial: Record<string, unknown>) {
  return {
    id: String(partial.id),
    order_no: String(partial.order_no),
    status: String(partial.status),
    customer_name: String(partial.customer_name || "Student"),
    phone: partial.phone as string,
    phone_key: partial.phone_key as string,
    total_paise: 205900,
    paid_at: (partial.paid_at as string | null) ?? null,
    placed_at: String(partial.placed_at || "2026-09-27T10:00:00.000Z"),
    action_required: Boolean(partial.action_required),
    ...partial,
  };
}

const phone = "9876543210";
const attempts = [1, 2, 3, 4, 5, 6].map((n) =>
  row({ id: `f${n}`, order_no: `NIAS-N-2026-00010${n}`, status: n % 2 ? "PAYMENT_EXPIRED" : "PAYMENT_FAILED", customer_name: n === 1 ? "guntaj" : "Guntaj", phone: `+91 ${phone}`, phone_key: phone, placed_at: `2026-09-27T10:0${n}:00.000Z` }),
);
const paid = row({ id: "p1", order_no: "NIAS-N-2026-001023", status: "PROCESSING", customer_name: "Guntaj Singh", phone, phone_key: phone, paid_at: "2026-09-27T12:00:00.000Z", placed_at: "2026-09-27T12:00:00.000Z" });
const one = groupNotesCustomers([...attempts, paid]);
assert.equal(one.length, 1);
assert.equal(one[0].paid_count, 1);
assert.equal(one[0].attempts, 7);
assert.equal(one[0].primary.order_no, "NIAS-N-2026-001023");
assert.equal(one[0].name, "Guntaj Singh");
assert.equal(isCapturedNotesOrder(one[0].primary), true);

const otherPhone = row({ id: "o", order_no: "NIAS-N-2026-000200", status: "PROCESSING", customer_name: "Guntaj Singh", phone: "9000000000", phone_key: "9000000000", paid_at: "2026-09-27T12:00:00.000Z" });
assert.equal(groupNotesCustomers([paid, otherPhone]).length, 2);

const polity = row({ id: "a", order_no: "A", status: "PRINTING", customer_name: "Rahul", phone_key: phone, paid_at: "2026-09-01T00:00:00.000Z", placed_at: "2026-09-01T00:00:00.000Z" });
const economy = row({ id: "b", order_no: "B", status: "PROCESSING", customer_name: "rahul", phone_key: phone, paid_at: "2026-09-20T00:00:00.000Z", placed_at: "2026-09-20T00:00:00.000Z" });
const repeat = groupNotesCustomers([polity, economy]);
assert.equal(repeat.length, 1);
assert.equal(repeat[0].paid_count, 2);
assert.equal(repeat[0].active.length, 2);
assert.equal(repeat[0].paid_total_paise, 205900 * 2);

const failedOnly = groupNotesCustomers(attempts);
assert.equal(failedOnly.length, 1);
assert.equal(failedOnly[0].paid_count, 0);
assert.equal(groupMatchesBucket(failedOnly[0], "paid"), false);
assert.equal(groupMatchesBucket(one[0], "preparing"), true);
assert.equal(groupMatchesBucket(one[0], "printing"), false);

const spaced = notesCustomerKey(row({ id: "x", order_no: "X", status: "PAYMENT_EXPIRED", phone: "+91 98765 43210" }));
const compact = notesCustomerKey(row({ id: "y", order_no: "Y", status: "PAYMENT_EXPIRED", phone_key: "9876543210" }));
assert.equal(spaced, compact);

const matched = groupNotesCustomers([...attempts, paid], (order) => order.order_no.endsWith("000102"));
assert.equal(matched[0].matched_order_no, "NIAS-N-2026-000102");

console.log("customer groups ok");
