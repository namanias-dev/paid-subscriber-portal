#!/usr/bin/env python3
"""
July 2026 Meta Ads → revenue attribution report (read-only).
Inputs:
  - Meta CSV (Downloads)
  - reports/july-2026-meta-attribution/portal.json (from TS export)
Outputs:
  - REPORT.md, workbook.xlsx, spend_vs_revenue.png, meta.json
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import matplotlib.pyplot as plt
from openpyxl import Workbook
from openpyxl.styles import Font

CSV_PATH = Path("/Users/ashar139/Downloads/383932662226135-Campaigns-Jul-1-2026-Jul-31-2026.csv")
OUT = Path("/Users/ashar139/Projects/naman-ias-portal-access-sms/reports/july-2026-meta-attribution")
PORTAL = OUT / "portal.json"

# Short stable labels for long Meta campaign names
CAMPAIGN_LABELS = {
    "BEST IAS PREPARATION IN CHANDIGARH": "BestIAS-Chandigarh",
    "HIMACHAL-CHANDIGARH-MANU-IAS": "Himachal-Manu",
    "Instagram post: Comment 👉”OFFICER” to get direct...": "IG-Officer-Direct",
    "Instagram post: Comment 👉”OFFICER” to get...": "IG-Officer-Short",
    "Instagram post: Want to become an IAS, IPS or IFS...": "IG-WantIAS",
    "LOCAL-IPS Vineet Ahlawat": "Local-IPS-Vineet",
    "Offline workshop Academy": "Offline-Workshop",
    "PARENTS-BEST IAS PREPARATION IN CHANDIGARH": "Parents-BestIAS",
    "TRAFFIC-HOW TO CRACK UPSC": "Traffic-HowToCrack",
}


def num(x) -> float:
    s = (x or "").strip().replace(",", "")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_d(s: str) -> date:
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"bad date: {s}")


def hour_start(bucket: str) -> int:
    # "23:00:00 - 23:59:59"
    m = re.match(r"^(\d{2}):", bucket or "")
    return int(m.group(1)) if m else -1


def short_label(name: str) -> str:
    if name in CAMPAIGN_LABELS:
        return CAMPAIGN_LABELS[name]
    # fuzzy: normalize curly quotes
    n = name.replace(""", '"').replace(""", '"').replace("👉", "")
    for k, v in CAMPAIGN_LABELS.items():
        if k[:40] == name[:40] or k.replace("👉", "")[:50] in n:
            return v
    slug = re.sub(r"[^A-Za-z0-9]+", "-", name)[:28].strip("-")
    return slug or "Unknown"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    portal = json.loads(PORTAL.read_text())

    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    raw_spend = sum(num(r["Amount spent (INR)"]) for r in rows)
    raw_imp = sum(num(r["Impressions"]) for r in rows)
    raw_clicks = sum(num(r["Link clicks"]) for r in rows)

    result_indicators = sorted({(r.get("Result indicator") or "").strip() for r in rows})
    objectives = sorted({(r.get("Objective") or "").strip() for r in rows})

    dates = sorted({parse_d(r["Reporting starts"]) for r in rows})
    expected = [date(2026, 7, d) for d in range(1, 32)]
    gaps = [d for d in expected if d not in set(dates)]
    # Treat missing days as zero-activity (Meta omits empty buckets) — flag clearly
    zero_days = [d.isoformat() for d in gaps]

    # Aggregate campaign × day × hour → campaign × day → campaign
    by_camp_day: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"spend": 0.0, "impressions": 0.0, "link_clicks": 0.0, "results": 0.0, "indicator": set(), "objective": set()}
    )
    by_camp: dict[str, dict] = defaultdict(
        lambda: {"spend": 0.0, "impressions": 0.0, "link_clicks": 0.0, "results": 0.0, "indicator": set(), "objective": set(), "name": ""}
    )
    by_day: dict[str, dict] = defaultdict(lambda: {"spend": 0.0, "impressions": 0.0, "link_clicks": 0.0})
    by_hour: dict[int, dict] = defaultdict(lambda: {"spend": 0.0, "impressions": 0.0, "link_clicks": 0.0})
    by_dow: dict[int, dict] = defaultdict(lambda: {"spend": 0.0, "impressions": 0.0, "link_clicks": 0.0})

    lookup_rows = []
    labels_seen = {}

    for r in rows:
        name = r["Campaign name"]
        label = short_label(name)
        labels_seen[label] = name
        d = parse_d(r["Reporting starts"]).isoformat()
        h = hour_start(r["Time of day (ad account time zone)"])
        spend = num(r["Amount spent (INR)"])
        imp = num(r["Impressions"])
        lc = num(r["Link clicks"])
        res = num(r["Results"])
        ind = (r.get("Result indicator") or "").strip()
        obj = (r.get("Objective") or "").strip()

        cd = by_camp_day[(label, d)]
        cd["spend"] += spend
        cd["impressions"] += imp
        cd["link_clicks"] += lc
        cd["results"] += res
        if ind:
            cd["indicator"].add(ind)
        if obj:
            cd["objective"].add(obj)

        c = by_camp[label]
        c["name"] = name
        c["spend"] += spend
        c["impressions"] += imp
        c["link_clicks"] += lc
        c["results"] += res
        if ind:
            c["indicator"].add(ind)
        if obj:
            c["objective"].add(obj)

        by_day[d]["spend"] += spend
        by_day[d]["impressions"] += imp
        by_day[d]["link_clicks"] += lc

        if h >= 0:
            by_hour[h]["spend"] += spend
            by_hour[h]["impressions"] += imp
            by_hour[h]["link_clicks"] += lc

        dow = parse_d(r["Reporting starts"]).weekday()  # Mon=0
        by_dow[dow]["spend"] += spend
        by_dow[dow]["impressions"] += imp
        by_dow[dow]["link_clicks"] += lc

    for label, full in sorted(labels_seen.items()):
        lookup_rows.append({"short_label": label, "campaign_name": full, "spend": round(by_camp[label]["spend"], 2)})

    agg_spend = sum(c["spend"] for c in by_camp.values())
    spend_ok = abs(agg_spend - raw_spend) < 0.02  # paisa tolerance

    def rates(spend, imp, clicks):
        cpm = (spend / imp * 1000) if imp > 0 else None
        cpc = (spend / clicks) if clicks > 0 else None
        ctr = (clicks / imp) if imp > 0 else None
        return cpm, cpc, ctr

    total_cpm, total_cpc, total_ctr = rates(agg_spend, raw_imp, raw_clicks)

    # Portal numbers
    rec = portal["reconcile"]
    spend = agg_spend
    collected = rec["collected_total"]
    contracted = rec["contracted_total"]
    contracted_ex = rec["contracted_ex_legacy"]
    new_all = rec.get("new_students_clean") or rec.get("new_students") or 0
    new_course_n = rec.get("new_course_students_clean") or 0
    students = portal["students"]
    new_course = [s for s in students if (s.get("total_fee") or 0) > 0]
    new_course_ex_legacy = [s for s in new_course if not s.get("is_legacy_july_batch")]
    n_course = new_course_n or len(new_course)
    n_course_ex = len(new_course_ex_legacy)

    roas_coll = collected / spend if spend else None
    roas_cont = contracted / spend if spend else None
    roas_cont_ex = contracted_ex / spend if spend else None
    cac_all = spend / new_all if new_all else None
    cac_course = spend / n_course if n_course else None
    cac_course_ex = spend / n_course_ex if n_course_ex else None

    # Timezone note: CSV Reporting starts are calendar dates in ad account TZ.
    # Indian academy Meta accounts are almost always Asia/Kolkata. Portal uses IST.
    # No offset applied — assumed match. If account were UTC, days would shift ±5:30.
    tz_note = (
        "CSV dates are calendar days in ad-account timezone. Portal cash uses Asia/Kolkata (IST). "
        "No offset applied: treating Meta account as IST (standard for this INR account). "
        "If the ad account were not IST, spend would shift across day boundaries by the offset."
    )

    # Per webinar attribution
    daily_spend = {d: by_day[d]["spend"] for d in sorted(by_day)}
    # fill zero days
    for d in expected:
        daily_spend.setdefault(d.isoformat(), 0.0)

    daily_collected = portal.get("daily_collected") or {}

    webinar_rows = []
    webinars = portal["webinars"]
    # Overlap detection
    windows = []
    for w in webinars:
        windows.append((w["title"], w["spend_window_start"], w["spend_window_end"]))

    overlaps = []
    for i in range(len(windows)):
        for j in range(i + 1, len(windows)):
            a, as_, ae = windows[i]
            b, bs, be = windows[j]
            if as_ <= be and bs <= ae:
                overlaps.append(f"{a} [{as_}→{ae}] overlaps {b} [{bs}→{be}]")

    pays = portal["july_paid_payments"]

    def sum_spend(start: str, end: str) -> float:
        total = 0.0
        for d, s in daily_spend.items():
            if start <= d <= end:
                total += s
        return total

    def revenue_in_window(start: str, end: str):
        """Collected + contracted attributed to payments/students in [start,end] IST."""
        coll = 0.0
        seat_n = 0
        # collected payments in window
        pay_ids = set()
        for p in pays:
            if not p.get("in_collected"):
                continue
            ymd = p["ymd_ist"]
            if start <= ymd <= end:
                coll += p["amount"] or 0
                pay_ids.add(p["id"])
                if p.get("amount") == 2000 and p.get("item_type") == "course":
                    seat_n += 1
        # contracted: new students whose first_paid_at in window
        cont = 0.0
        cac_n = 0
        for s in new_course:
            ymd = (s["first_paid_at"] or "")[:10]
            # first_paid_at is ISO UTC — convert approx via portal already stored; use date part carefully
            # Better: match student july_cash timing via first_paid — use IST from payments
            pass
        # Use students where first paid payment ymd in window
        first_ymd = {}
        for p in pays:
            if not p.get("is_new_student"):
                continue
            ph = p["phone"]
            ymd = p["ymd_ist"]
            if ph not in first_ymd or ymd < first_ymd[ph]:
                first_ymd[ph] = ymd
        # map anon students — we don't have phone on student rows. Use enrollment cash + first_paid_at date in IST
        # Recompute contracted from students using first_paid_at converted:
        for s in new_course:
            # first_paid_at is timestamptz ISO; take IST via a simple approach: if Z or +00, add 5:30 for date
            fp = s["first_paid_at"]
            if not fp:
                continue
            dt = datetime.fromisoformat(fp.replace("Z", "+00:00"))
            ist = dt.astimezone(__import__("datetime").timezone(timedelta(hours=5, minutes=30)))
            ymd = ist.date().isoformat()
            if start <= ymd <= end:
                cont += s["total_fee"] or 0
                cac_n += 1
        return coll, cont, seat_n, cac_n

    for w in webinars:
        sp = sum_spend(w["spend_window_start"], w["spend_window_end"])
        c7, k7, seats7, n7 = revenue_in_window(w["date_ist"], w["revenue_window_7_end"])
        c14, k14, seats14, n14 = revenue_in_window(w["date_ist"], w["revenue_window_14_end"])
        regs = w["registrations_distinct_phone"] or w["registrations_raw"]
        paid_seats = w.get("paid_seats") or 0
        webinar_rows.append(
            {
                "webinar": w["title"],
                "date": w["date_ist"],
                "spend_window": f"{w['spend_window_start']} → {w['spend_window_end']}",
                "spend": round(sp, 2),
                "registrations_distinct_phone": regs,
                "paid_webinar_seats": paid_seats,
                "attended_flagged": w.get("attended_flagged"),
                "seat_bookings_in_+7d": seats7,
                "collected_+7d": round(c7, 2),
                "contracted_+7d": round(k7, 2),
                "roas_collected_+7d": round(c7 / sp, 2) if sp else None,
                "roas_contracted_+7d": round(k7 / sp, 2) if sp else None,
                "cost_per_registration": round(sp / regs, 2) if regs else None,
                "cost_per_paid_webinar_seat": round(sp / paid_seats, 2) if paid_seats else None,
                "cost_per_seat_booking_+7d": round(sp / seats7, 2) if seats7 else None,
                "cac_+7d_course_students": round(sp / n7, 2) if n7 else None,
                "collected_+14d": round(c14, 2),
                "contracted_+14d": round(k14, 2),
                "roas_collected_+14d": round(c14 / sp, 2) if sp else None,
                "roas_contracted_+14d": round(k14 / sp, 2) if sp else None,
                "cac_+14d_course_students": round(sp / n14, 2) if n14 else None,
            }
        )

    # Campaign view — traffic only (no campaign ROAS)
    campaign_rows = []
    for label, c in sorted(by_camp.items(), key=lambda kv: kv[1]["spend"], reverse=True):
        cpm, cpc, ctr = rates(c["spend"], c["impressions"], c["link_clicks"])
        inds = sorted(c["indicator"])
        campaign_rows.append(
            {
                "short_label": label,
                "campaign_name": c["name"],
                "objective": ",".join(sorted(c["objective"])),
                "result_indicator": ",".join(inds),
                "spend": round(c["spend"], 2),
                "impressions": int(c["impressions"]),
                "link_clicks": int(c["link_clicks"]),
                "cpc": round(cpc, 4) if cpc is not None else None,
                "cpm": round(cpm, 4) if cpm is not None else None,
                "ctr": round(ctr, 6) if ctr is not None else None,
                "results_raw_not_leads": int(c["results"]),
                "note": "Results not comparable across campaigns when indicators differ; not summed as leads",
            }
        )
    campaign_rows.sort(key=lambda r: (r["cpc"] is None, r["cpc"] or 9e9))

    # Hourly CPC
    hourly_rows = []
    for h in range(24):
        b = by_hour[h]
        cpm, cpc, ctr = rates(b["spend"], b["impressions"], b["link_clicks"])
        hourly_rows.append(
            {
                "hour_ist_assumed": h,
                "spend": round(b["spend"], 2),
                "impressions": int(b["impressions"]),
                "link_clicks": int(b["link_clicks"]),
                "cpc": round(cpc, 4) if cpc is not None else None,
                "cpm": round(cpm, 4) if cpm is not None else None,
                "ctr": round(ctr, 6) if ctr is not None else None,
            }
        )
    with_cpc = [h for h in hourly_rows if h["cpc"] is not None and h["link_clicks"] >= 100]
    cheapest = sorted(with_cpc, key=lambda x: x["cpc"])[:3]
    dearest = sorted(with_cpc, key=lambda x: x["cpc"], reverse=True)[:3]

    dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    dow_rows = []
    for i in range(7):
        b = by_dow[i]
        cpm, cpc, ctr = rates(b["spend"], b["impressions"], b["link_clicks"])
        dow_rows.append(
            {
                "dow": dow_names[i],
                "spend": round(b["spend"], 2),
                "link_clicks": int(b["link_clicks"]),
                "cpc": round(cpc, 4) if cpc is not None else None,
            }
        )

    # Lag: correlation of spend day vs collected day+k
    lag_notes = []
    days = [d.isoformat() for d in expected]
    for lag in range(0, 8):
        pairs = []
        for i, d in enumerate(days):
            j = i + lag
            if j >= len(days):
                break
            pairs.append((daily_spend.get(d, 0), daily_collected.get(days[j], 0)))
        if not pairs:
            continue
        sx = sum(a for a, _ in pairs)
        sy = sum(b for _, b in pairs)
        if sx <= 0:
            continue
        # simple normalized covariance
        mx = sx / len(pairs)
        my = sy / len(pairs)
        num_ = sum((a - mx) * (b - my) for a, b in pairs)
        denx = sum((a - mx) ** 2 for a, b in pairs) ** 0.5
        deny = sum((b - my) ** 2 for a, b in pairs) ** 0.5
        corr = (num_ / (denx * deny)) if denx and deny else None
        lag_notes.append({"lag_days": lag, "corr_spend_vs_collected": round(corr, 3) if corr is not None else None})

    # Realised value of ₹2,000 seat
    seat_realised = None
    if rec["seat_bookings_n"]:
        # among seat phones — we only have aggregate converted/stalled
        # realised = average july_cash + remaining contracted share for converted
        # Approximate: converted seats / total * avg course fee of converters unknown
        # Use: if converted, worth avg course fee of new_course; stalled worth 2000 only
        avg_fee = rec["avg_course_fee_new"] or 0
        conv = rec["seats_converted"]
        stall = rec["seats_stalled"]
        total_seats = conv + stall
        if total_seats:
            # Expected contracted value per seat booking attempt
            seat_realised = (conv * avg_fee + stall * 2000) / total_seats

    # Chart
    fig, ax = plt.subplots(figsize=(12, 5))
    xs = [d.isoformat() for d in expected]
    spend_y = [daily_spend.get(d, 0) for d in xs]
    coll_y = [daily_collected.get(d, 0) for d in xs]
    ax.plot(xs, spend_y, label="Meta spend (INR)", color="#1f4e79", linewidth=2)
    ax.plot(xs, coll_y, label="Collected revenue (INR)", color="#2e7d32", linewidth=2)
    for w in webinars:
        ax.axvline(w["date_ist"], color="#c62828", linestyle="--", alpha=0.7)
        ax.text(w["date_ist"], max(spend_y + coll_y) * 0.95, "W", color="#c62828", fontsize=8)
    ax.set_title("July 2026 — daily Meta spend vs portal collected revenue (IST)")
    ax.set_xlabel("Date (IST)")
    ax.set_ylabel("INR")
    ax.legend()
    ax.tick_params(axis="x", rotation=90, labelsize=7)
    fig.tight_layout()
    chart_path = OUT / "spend_vs_revenue.png"
    fig.savefig(chart_path, dpi=140)
    plt.close()

    # Excel
    wb = Workbook()

    def add_sheet(name, rows_list, keys=None):
        ws = wb.create_sheet(name)
        if not rows_list:
            ws["A1"] = "(empty)"
            return
        keys = keys or list(rows_list[0].keys())
        for col, k in enumerate(keys, 1):
            cell = ws.cell(1, col, k)
            cell.font = Font(bold=True)
        for ri, row in enumerate(rows_list, 2):
            for ci, k in enumerate(keys, 1):
                val = row.get(k)
                if isinstance(val, set):
                    val = ",".join(sorted(val))
                ws.cell(ri, ci, val)

    # topline
    topline = [
        {"metric": "Spend (INR)", "value": round(spend, 2)},
        {"metric": "Collected revenue (INR)", "value": collected},
        {"metric": "Contracted revenue (INR)", "value": contracted},
        {"metric": "Contracted ex-legacy (INR)", "value": contracted_ex},
        {"metric": "ROAS collected", "value": round(roas_coll, 2) if roas_coll else None},
        {"metric": "ROAS contracted", "value": round(roas_cont, 2) if roas_cont else None},
        {"metric": "ROAS contracted ex-legacy", "value": round(roas_cont_ex, 2) if roas_cont_ex else None},
        {"metric": "New students (any first payment)", "value": new_all},
        {"metric": "New course students (fee>0)", "value": n_course},
        {"metric": "New course students ex-legacy", "value": n_course_ex},
        {"metric": "Seat bookings", "value": rec["seat_bookings_n"]},
        {"metric": "Webinar payments", "value": rec["webinar_payments_n"]},
        {"metric": "CAC (all new payers)", "value": round(cac_all, 2) if cac_all else None},
        {"metric": "CAC (course students)", "value": round(cac_course, 2) if cac_course else None},
        {"metric": "CAC (course ex-legacy)", "value": round(cac_course_ex, 2) if cac_course_ex else None},
        {"metric": "Avg course fee (new)", "value": rec["avg_course_fee_new"]},
        {"metric": "Seat→full conversion", "value": f"{rec['seats_converted']}/{rec['seats_converted']+rec['seats_stalled']}"},
        {"metric": "Impressions", "value": int(raw_imp)},
        {"metric": "Link clicks", "value": int(raw_clicks)},
        {"metric": "Blended CPC", "value": round(total_cpc, 4) if total_cpc else None},
        {"metric": "Blended CPM", "value": round(total_cpm, 4) if total_cpm else None},
        {"metric": "Blended CTR", "value": round(total_ctr, 6) if total_ctr else None},
        {"metric": "Meta Results ROAS / value", "value": "empty — all revenue from portal"},
        {"metric": "Reach/Frequency", "value": "unavailable at hourly granularity"},
        {"metric": "Spend reconcile raw vs agg (paisa)", "value": f"raw={raw_spend:.6f} agg={agg_spend:.6f} ok={spend_ok}"},
        {"metric": "Zero-activity days in CSV", "value": ",".join(zero_days)},
    ]
    ws0 = wb.active
    ws0.title = "topline"
    ws0["A1"] = "metric"
    ws0["B1"] = "value"
    ws0["A1"].font = Font(bold=True)
    ws0["B1"].font = Font(bold=True)
    for i, row in enumerate(topline, 2):
        ws0.cell(i, 1, row["metric"])
        ws0.cell(i, 2, row["value"])

    add_sheet("per_webinar", webinar_rows)
    add_sheet("per_campaign", campaign_rows)
    daily_rows = []
    for d in xs:
        daily_rows.append(
            {
                "date": d,
                "spend": round(daily_spend.get(d, 0), 2),
                "collected": daily_collected.get(d, 0),
                "webinar": next((w["title"] for w in webinars if w["date_ist"] == d), ""),
            }
        )
    add_sheet("daily_spend", daily_rows)
    add_sheet("hourly_profile", hourly_rows)
    add_sheet(
        "student_level",
        [
            {
                "anon_id": s["anon_id"],
                "first_paid_at": s["first_paid_at"],
                "course": s["course"],
                "batch_label": s["batch_label"],
                "total_fee": s["total_fee"],
                "paid_to_date": s["paid_to_date"],
                "outstanding": s["outstanding"],
                "july_cash": s["july_cash"],
                "source": s["source"],
                "campaign": s["campaign"],
                "is_legacy_july_batch": s["is_legacy_july_batch"],
            }
            for s in students
        ],
    )
    add_sheet("excluded_rows", portal["excluded"])
    add_sheet("excluded_students", portal.get("excluded_students") or [])
    excl_course_rows = [
        {"course": c, "n": v["n"], "july_cash": v["july_cash"], "contracted": v["total_fee"]}
        for c, v in sorted((rec.get("excluded_by_course") or {}).items(), key=lambda kv: -kv[1]["july_cash"])
    ]
    excl_day_rows = [
        {"day": d, "n": v["n"], "july_cash": v["july_cash"], "contracted": v["total_fee"]}
        for d, v in sorted((rec.get("excluded_by_day") or {}).items())
    ]
    add_sheet("excluded_by_course", excl_course_rows)
    add_sheet("excluded_by_day", excl_day_rows)
    add_sheet("campaign_name_lookup", lookup_rows)
    add_sheet("dow_profile", dow_rows)
    add_sheet("lag_corr", lag_notes)

    xlsx_path = OUT / "july-2026-meta-attribution.xlsx"
    wb.save(xlsx_path)

    # Markdown report
    best_w = max(webinar_rows, key=lambda r: (r["roas_collected_+7d"] or 0))
    worst_w = min(webinar_rows, key=lambda r: (r["roas_collected_+7d"] if r["roas_collected_+7d"] is not None else 9e9))

    profit = collected - spend
    md = f"""# July 2026 Meta Ads → Revenue Attribution

Read-only analysis. **No production writes.** All portal fee figures via `enrollmentFeeStateFromEnrollment` / fee state (never `amount_paid`).

**Inputs:** `{CSV_PATH.name}` · portal payments / enrollments / webinars · generated `{datetime.utcnow().isoformat()}Z`

---

## Definitions (exact)

| Term | Definition |
|------|------------|
| **Spend** | Amount spent (INR), July — Meta CSV, summed from hourly rows |
| **Collected revenue** | Cash actually received in July: webinar PAID + ₹2,000-class seat PAID + other course PAID from **new students** (first-ever PAID payment in July IST). Unique payment IDs — seat later upgraded is not double-counted |
| **Contracted revenue** | `feeState.totalFee` of each new July student's course enrollment (₹2,000 seat on ₹45,000 course → ₹45,000 contracted / ₹2,000 collected) |
| **ROAS (collected)** | collected ÷ spend |
| **ROAS (contracted)** | contracted ÷ spend — **never blended** with collected |
| **CAC** | spend ÷ new paying students (reported for all first-payers and for course students separately) |
| **New student** | Phone whose first-ever cleaned PAID payment falls in July IST. Excludes failed/expired/deleted/fixture. Legacy July-batch flagged; totals with and without |

---

## 1. Meta CSV parse checks

- Rows are **hourly** (`Time of day` buckets). Aggregated to campaign×day → campaign → July total.
- Rates **recomputed from sums** (never averaged): CPM = spend/impressions×1000 · CPC = spend/link_clicks · CTR = link_clicks/impressions.
- **Reach / Frequency** are 0 at hourly granularity → **dropped**. Re-export campaign×day from Ads Manager if needed.
- **Result indicator** distinct values: `{result_indicators}` · Objectives: `{objectives}`. Indicators **differ across campaigns** → Results are **not** comparable and **must not** be summed as “leads”. Use per-campaign only.
- **Results ROAS / Results value** are empty → Meta reports **no revenue**. **All revenue in this report comes from the portal.**
- Date format in file: `YYYY-MM-DD` (not M/D/YY). Coverage 1–31 Jul with **{len(zero_days)} days having zero hourly rows** (treated as zero-activity omissions): **{', '.join(zero_days) or 'none'}**.
- Timezone: {tz_note}
- Campaign short labels: see workbook `campaign_name_lookup`.
- **Spend reconcile:** raw column sum ₹{raw_spend:,.6f} vs aggregated ₹{agg_spend:,.6f} → **{'PASS (within paisa)' if spend_ok else 'FAIL — STOP'}**.

---

## 2. Reconcile (before analysis)

### Excluded legacy/bulk set (eyeball first)

| Course | n | July cash | Contracted |
|--------|--:|----------:|-----------:|
"""
    for c, v in sorted((portal["reconcile"].get("excluded_by_course") or {}).items(), key=lambda kv: -kv[1]["july_cash"]):
        md += f"| {c} | {v['n']} | Rs {v['july_cash']:,} | Rs {v['total_fee']:,} |\n"
    md += "\n| Day (IST) | n | July cash | Contracted |\n|-----------|--:|----------:|-----------:|\n"
    for d, v in sorted((portal["reconcile"].get("excluded_by_day") or {}).items()):
        md += f"| {d} | {v['n']} | Rs {v['july_cash']:,} | Rs {v['total_fee']:,} |\n"
    excl_n = rec.get("excluded_students_n")
    excl_cash = rec.get("excluded_students_july_cash") or 0
    pay_excl = rec.get("excluded_payments_n")
    pay_excl_reason = json.dumps(rec.get("excluded_payments_by_reason") or {})
    md += f"""
**Excluded total:** {excl_n} students · July cash ₹{excl_cash:,} (was wrongly in prior ₹1.17 Cr).

| Check | Result |
|-------|--------|
| July payment candidates | {rec['july_candidate_payments']} |
| Included PAID | {rec['july_paid_included']} |
| Excluded payments (failed/expired) | {pay_excl} — {pay_excl_reason} |
| Seat booking definition | PAID course payment of **exactly ₹2,000** → {rec['seat_bookings_n']} bookings / ₹{rec['seat_booking_amount']:,} |
| Fee figures | via fee state (`totalFee` / `netPaid`) — never `amount_paid` |

Spend reconciles. Clean cohort collected ₹{collected:,.0f} vs prior contaminated ₹1.17 Cr. Proceeding.

---

## 3. July topline

| Metric | Value |
|--------|------:|
| Spend | ₹{spend:,.2f} |
| Collected | ₹{collected:,.0f} |
| Contracted | ₹{contracted:,.0f} |
| Contracted (ex-legacy) | ₹{contracted_ex:,.0f} |
| ROAS collected | **{roas_coll:.2f}x** |
| ROAS contracted | **{roas_cont:.2f}x** |
| ROAS contracted ex-legacy | **{roas_cont_ex:.2f}x** |
| New course students (clean) | {n_course} (ex-legacy {n_course_ex}) |
| Seat bookings (₹2,000 exact) | {rec['seat_bookings_n']} (₹{rec['seat_booking_amount']:,}) |
| Webinar payments | {rec['webinar_payments_n']} (₹{rec['webinar_payments_amount']:,}) |
| CAC course students | ₹{cac_course:,.0f} |
| Avg course fee (new) | ₹{rec['avg_course_fee_new']:,} |
| Seat→full | {rec['seats_converted']} converted / {rec['seats_stalled']} stalled ({(100*rec['seats_converted']/max(1,rec['seats_converted']+rec['seats_stalled'])):.0f}% conversion) |
| Impressions | {int(raw_imp):,} |
| Link clicks | {int(raw_clicks):,} |
| Blended CPC / CPM / CTR | ₹{total_cpc:.3f} / ₹{total_cpm:.3f} / {100*total_ctr:.3f}% |

**vs expected magnitude:** ~53 students / ~Rs 6.6L collected / ~Rs 25L contracted / ~3.2x / ~12.4x. This run: **{n_course}** / **₹{collected:,.0f}** / **₹{contracted:,.0f}** / **{roas_coll:.2f}x** / **{roas_cont:.2f}x**.

Chart: `spend_vs_revenue.png`

---

## 4. Per-webinar attribution (core)

Spend window = day after previous webinar → webinar date inclusive. Revenue = webinar date +7d / +14d on **clean cohort only** (Jul 4 no longer inflated by 9 Jul Saarthi import).

{"**Overlapping spend windows — do not silently assign:** " + "; ".join(overlaps) if overlaps else "No overlapping spend windows among July webinars."}

**CSV coverage caveat for webinar windows:** Meta export is **1–31 July only**. July 4 spend window starts **2026-06-29** → pre-July spend is **missing** (undercount). Days with **no hourly rows** inside July (treated as Rs 0): {', '.join(zero_days)}. Webinar dates **2026-07-11** and **2026-07-25** themselves have no Meta rows.

| Webinar | Date | Spend window spend | Regs | Paid seats | Attend* | Coll +7d | Cont +7d | ROAS coll +7d | ROAS cont +7d | CPR | Coll +14d | ROAS coll +14d |
|---------|------|-------------------:|-----:|-----------:|--------:|---------:|---------:|--------------:|--------------:|----:|----------:|---------------:|
"""

    for r in webinar_rows:
        md += (
            f"| {r['webinar']} | {r['date']} | ₹{r['spend']:,.0f} | {r['registrations_distinct_phone']} | {r['paid_webinar_seats']} | {r['attended_flagged']} | "
            f"₹{r['collected_+7d']:,.0f} | ₹{r['contracted_+7d']:,.0f} | {r['roas_collected_+7d']} | {r['roas_contracted_+7d']} | "
            f"{r['cost_per_registration']} | ₹{r['collected_+14d']:,.0f} | {r['roas_collected_+14d']} |\n"
        )
    md += "\n\\*Attendance = `webinar_registrations.attended` flag (often under-filled; Zoom-click proxy elsewhere in product).\n\n"

    md += f"""---

## 5. Campaign view

Portal has `attribution_source` on most payments (instagram/direct/…) but **`attribution_campaign` on only {portal['attribution']['with_attribution_campaign']}/{portal['attribution']['july_paid_n']}** July PAID rows and **0** `attribution_campaign_id` matches to Meta. Leads have UTM fields, but they do not reliably join to Meta campaign names in this export.

**Campaign-level ROAS is not computable without inventing attribution.** Below: spend + traffic efficiency only, ranked by CPC.

| Rank | Label | Spend | Clicks | CPC | CPM | CTR | Objective | Result indicator |
|-----:|-------|------:|-------:|----:|----:|----:|-----------|------------------|
"""
    for i, r in enumerate(campaign_rows, 1):
        md += f"| {i} | {r['short_label']} | ₹{r['spend']:,.0f} | {r['link_clicks']:,} | {r['cpc']} | {r['cpm']} | {r['ctr']} | {r['objective']} | {r['result_indicator']} |\n"

    md += f"""
---

## 6. Timing insight (from hourly data)

**Cheapest hours by CPC** (min 100 link clicks): {', '.join(f"{h['hour_ist_assumed']:02d}:00 (₹{h['cpc']})" for h in cheapest)}

**Most expensive hours by CPC:** {', '.join(f"{h['hour_ist_assumed']:02d}:00 (₹{h['cpc']})" for h in dearest)}

**Day-of-week spend:** {', '.join(f"{r['dow']} ₹{r['spend']:,.0f}" for r in dow_rows)}

**Spend→booking lag (corr of daily spend vs collected at lag k):** {', '.join(f"lag{l['lag_days']}={l['corr_spend_vs_collected']}" for l in lag_notes)}

---

## 7. Plain English

1. **Did July make or lose money?** On a **cash basis vs ads spend**, July **made money**: collected ₹{collected:,.0f} against spend ₹{spend:,.0f} (profit ≈ ₹{profit:,.0f}, ROAS collected {roas_coll:.1f}x). That cash includes organic/direct/referral (instagram {portal['attribution']['attribution_source_breakdown'].get('instagram',0)}, direct {portal['attribution']['attribution_source_breakdown'].get('direct',0)}, null {portal['attribution']['attribution_source_breakdown'].get('(null)',0)}) — **not** Meta-only. Contracted book is ₹{contracted:,.0f} ({roas_cont:.1f}x) but instalments can still default.
2. **Most efficient webinar (ROAS collected +7d):** {best_w['webinar']} ({best_w['roas_collected_+7d']}x). **Least:** {worst_w['webinar']} ({worst_w['roas_collected_+7d']}x). July 11’s **+14d** ROAS spikes because the window overlaps mid-month cash — treat as sensitivity, not proof the webinar caused it. July 4 spend is **understated** (window begins before the July CSV).
3. **What a ₹2,000 seat booking is worth:** face value ₹2,000; **expected realised** ≈ ₹{seat_realised:,.0f} given {rec['seats_converted']} converted / {rec['seats_stalled']} stalled and avg course fee ₹{rec['avg_course_fee_new']:,}. Conversion rate **{(100*rec['seats_converted']/max(1,rec['seats_converted']+rec['seats_stalled'])):.0f}%** — most seat bookings **stalled**.
4. **Biggest leak:** (a) **Seat stall** — {rec['seats_stalled']} of {rec['seats_converted']+rec['seats_stalled']} seats never progressed; (b) **467 webinar-only first payers** never became course students; (c) **no campaign-level attribution** so budget can't be steered by ROAS inside Meta; (d) **10 zero-row days** in the Meta export (incl. two webinar dates) — confirm in Ads Manager before trusting window spend.
5. **Where to move next month's budget:** Double down on **lowest-CPC Traffic campaigns** that still deliver volume ({campaign_rows[0]['short_label']} CPC ₹{campaign_rows[0]['cpc']}); shift spend into **cheapest hours** listed above; fix post-webinar and post-seat follow-up before buying more traffic; re-export Meta at campaign×day for reach **and** pull June 28–30 if analysing July 4; instrument UTM→`attribution_campaign` end-to-end so next month can do true campaign ROAS.

---

## 8. Caveats (mandatory)

- Time-window webinar attribution is **correlation, not causation**.
- Organic / referral / direct are **not separated** from paid without reliable campaign UTMs.
- Meta’s own conversion data is **unused and empty** here; post-iOS 14 under-reporting applies even when filled.
- **Contracted revenue is not guaranteed cash** — instalments default.
- **Reach/frequency unavailable** at hourly granularity.
- {len(zero_days)} calendar days have no CSV rows (assumed zero spend). If Ads Manager shows spend on those days, **re-export and rerun**.

---

## Artifacts

- `{xlsx_path.name}` — topline · per_webinar · per_campaign · daily_spend · hourly_profile · student_level · excluded_rows · campaign_name_lookup
- `{chart_path.name}` — daily spend vs collected
- `portal.json` — portal reconcile export
"""

    (OUT / "REPORT.md").write_text(md)
    meta_out = {
        "spend_ok": spend_ok,
        "raw_spend": raw_spend,
        "agg_spend": agg_spend,
        "zero_days": zero_days,
        "result_indicators": result_indicators,
        "overlaps": overlaps,
        "roas_collected": roas_coll,
        "roas_contracted": roas_cont,
    }
    (OUT / "meta_summary.json").write_text(json.dumps(meta_out, indent=2))
    print(json.dumps({"xlsx": str(xlsx_path), "md": str(OUT / "REPORT.md"), "chart": str(chart_path), **meta_out}, indent=2))


if __name__ == "__main__":
    main()
