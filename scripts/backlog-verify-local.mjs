// One-off LOCAL backlog verifier (read-only unless --commit is handled elsewhere).
// Runs ICICI Verify from this machine (whose IP ICICI answers) and categorizes
// each stuck payment using the SAME mapping as lib/eazypay.ts. Writes a results
// JSON. Never touches the DB — this file only talks to ICICI.
import fs from "node:fs";
import { RAW } from "./backlog-data.mjs";

const MID = process.env.ICICI_EAZYPAY_MERCHANT_ID || "343526";

const rows = RAW.split("\n").map((l) => {
  const [ref, item_type, id, enr, kind, inst, amount, phone, status] = l.split("\t");
  return { ref, item_type, id, enr: enr || null, kind: kind || null, inst: inst || null, amount: Number(amount), phone, status };
});

function mapStatus(s) {
  s = (s || "").trim().toUpperCase();
  if (!s) return "unknown";
  if (s === "SUCCESS" || s === "PAID" || s === "RIP" || s === "SIP") return "paid";
  if (s === "FAILED" || s === "FAILURE" || s === "TIMEOUT" || s.includes("EXPIRED") || s.includes("RETURNED") || s.includes("CANCEL") || s.includes("REJECT") || s.includes("DECLINE")) return "failed";
  return "unknown";
}
function settlementOf(s) {
  s = (s || "").trim().toUpperCase();
  if (s === "SUCCESS" || s === "PAID") return "settled";
  if (s === "RIP" || s === "SIP") return "in_progress";
  return null;
}
function parsePacket(body) {
  const o = {};
  for (const p of (body || "").split(/[&\r\n]+/)) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    o[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
  }
  return o;
}
const clean = (v) => {
  const t = (v ?? "").trim();
  return t && t.toUpperCase() !== "NA" && t.toLowerCase() !== "null" ? t : null;
};

const out = [];
for (const r of rows) {
  let raw = null, http = 0, err = null, gwref = null;
  try {
    const url = `https://eazypay.icicibank.com/EazyPGVerify?merchantid=${MID}&pgreferenceno=${encodeURIComponent(r.ref)}`;
    const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "curl/8.4.0", Accept: "*/*" } });
    http = res.status;
    const body = await res.text();
    const pk = parsePacket(body);
    raw = pk.status ?? null;
    gwref = clean(pk.ezpaytranid);
  } catch (e) {
    err = String(e?.message || e);
  }
  const reachable = raw != null;
  const outcome = reachable ? mapStatus(raw) : "unreachable";
  out.push({ ...r, raw, http, reachable, outcome, settlement: outcome === "paid" ? settlementOf(raw) : null, gwref, err });
  process.stdout.write(`${r.ref}\t${r.item_type}\t${String(raw)}\t=> ${outcome}\n`);
  await new Promise((res) => setTimeout(res, 150));
}

fs.writeFileSync(new URL("./backlog-results.json", import.meta.url), JSON.stringify(out, null, 2));

const cnt = (f) => out.filter(f).length;
const sum = (f) => out.filter(f).reduce((a, b) => a + (b.amount || 0), 0);
console.log("\n=== BACKLOG VERIFY SUMMARY (dry-run, no DB writes) ===");
console.log("total rows          :", out.length);
console.log("PAID (settled)      :", cnt((x) => x.outcome === "paid" && x.settlement === "settled"), "  ₹" + sum((x) => x.outcome === "paid" && x.settlement === "settled"));
console.log("PAID (settling RIP/SIP):", cnt((x) => x.outcome === "paid" && x.settlement === "in_progress"), "  ₹" + sum((x) => x.outcome === "paid" && x.settlement === "in_progress"));
console.log("  of PAID: webinars :", cnt((x) => x.outcome === "paid" && x.item_type === "webinar"));
console.log("  of PAID: courses  :", cnt((x) => x.outcome === "paid" && x.item_type === "course"));
console.log("FAILED/Expired      :", cnt((x) => x.outcome === "failed"), "  ₹" + sum((x) => x.outcome === "failed"));
console.log("unknown (flag review):", cnt((x) => x.outcome === "unknown"));
console.log("unreachable (no status):", cnt((x) => x.outcome === "unreachable"));
console.log("\ndistinct raw statuses:");
const byRaw = {};
for (const x of out) byRaw[String(x.raw)] = (byRaw[String(x.raw)] || 0) + 1;
console.log(byRaw);
console.log("\nPAID details:");
for (const x of out.filter((x) => x.outcome === "paid")) console.log(" ", x.ref, x.item_type, x.raw, x.settlement, "enr=" + x.enr, "kind=" + x.kind, "amt=" + x.amount);
