import assert from "node:assert/strict";
import { projectCustomerStage } from "../../lib/store/projection";
import { progressIndex, staffAdvanceLabel, staffNextStatus, productSummary } from "../../lib/store/stages";
import { buildTrackingTimeline } from "../../lib/store/trackingView";
import { fulfillmentLabel } from "../../lib/store/adminConsole";

const preparing = "PROCESSING";
assert.equal(fulfillmentLabel(preparing, false), "Preparing");
assert.equal(projectCustomerStage(preparing, false), "preparing");
assert.equal(progressIndex(preparing), 1);
assert.equal(buildTrackingTimeline({ stage: "preparing" }).find((step) => step.id === "printing")?.state, "upcoming");
assert.equal(buildTrackingTimeline({ stage: "preparing" }).find((step) => step.id === "preparing")?.state, "current");
assert.equal(buildTrackingTimeline({ stage: "preparing" }).filter((step) => step.state === "done").map((step) => step.id).join(","), "confirmed");

const printing = "PRINTING";
assert.equal(fulfillmentLabel(printing, false), "Printing");
assert.equal(projectCustomerStage(printing, false), "printing");
assert.equal(progressIndex(printing), progressIndex("QUALITY_CHECK"));
assert.equal(buildTrackingTimeline({ stage: "printing" }).find((step) => step.id === "printing")?.state, "current");
assert.equal(buildTrackingTimeline({ stage: "printing" }).find((step) => step.id === "packed")?.state, "upcoming");

assert.equal(staffNextStatus("PROCESSING"), "PRINTING");
assert.equal(staffNextStatus("PRINTING"), "PACKED");
assert.equal(staffNextStatus("PICKED_UP"), null);
assert.equal(staffAdvanceLabel("ORDER_CONFIRMED"), "Start preparing");
assert.equal(staffAdvanceLabel("PROCESSING"), "Start printing");
assert.equal(staffAdvanceLabel("PRINTING"), "Mark packed");
assert.equal(productSummary([{ name: "Indian Economy Notes", qty: 2 }]), "Indian Economy Notes ×2");
assert.equal(productSummary([{ name: "Indian Economy Notes", qty: 1 }, { name: "Polity", qty: 1 }]), "Indian Economy Notes ×1 · +1 more");

console.log("stages ok");
