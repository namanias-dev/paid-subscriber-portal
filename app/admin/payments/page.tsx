"use client";

import { useMemo, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell, KpiCard } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatDate, formatISTDateTime, istYMD, istTodayYMD } from "@/lib/dates";
import type { Payment, Enrollment } from "@/lib/types";

const isPaid = (s: Payment["status"]) => s === "captured" || s === "PAID";

// Payment-type filters mapped to EXISTING fields (item_type / payment_kind). OR semantics.
type TypeKey = "webinar" | "course" | "seat" | "installment";
const TYPE_DEFS: { key: TypeKey; label: string; match: (p: Payment) => boolean }[] = [
  { key: "webinar", label: "Webinar registrations", match: (p) => p.item_type === "webinar" },
  { key: "course", label: "Course payments", match: (p) => p.item_type === "course" },
  { key: "seat", label: "Book seat", match: (p) => p.payment_kind === "seat" },
  { key: "installment", label: "Installments", match: (p) => p.payment_kind === "installment" },
];
const TYPE_LABEL: Record<TypeKey, string> = Object.fromEntries(TYPE_DEFS.map((t) => [t.key, t.label])) as Record<TypeKey, string>;

type DateMode = "all" | "today" | "yesterday" | "month" | "year" | "date" | "range";

function lastDayOfMonth(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return String(d).padStart(2, "0");
}

export default function PaymentsAdmin() {
  const full = useAdminData<Payment[]>("/api/admin/payments", "payments");
  const enr = useAdminData<Enrollment[]>("/api/admin/payments", "enrollments");
  const codes = useAdminData<Record<string, string>>("/api/admin/payments", "buyerCodes");
  const { toast } = useToast();

  // ---- Filters (read-only display state) ----
  const [types, setTypes] = useState<Set<TypeKey>>(new Set());
  const [dateMode, setDateMode] = useState<DateMode>("all");
  const [dateVal, setDateVal] = useState("");      // YYYY-MM-DD
  const [monthVal, setMonthVal] = useState("");    // YYYY-MM
  const [yearVal, setYearVal] = useState("");      // YYYY
  const [rangeFrom, setRangeFrom] = useState("");  // YYYY-MM-DD
  const [rangeTo, setRangeTo] = useState("");      // YYYY-MM-DD

  const payments = useMemo(() => full.data || [], [full.data]);
  const enrollments = enr.data || [];
  const buyerCodes = codes.data || {};

  const todayYMD = istTodayYMD();

  // Resolve the active date filter to an inclusive [from, to] YMD window (null = all).
  const range = useMemo((): { from: string; to: string } | null => {
    switch (dateMode) {
      case "today":
        return { from: todayYMD, to: todayYMD };
      case "yesterday": {
        const y = istYMD(new Date(Date.now() - 86400000)) || todayYMD;
        return { from: y, to: y };
      }
      case "month": {
        if (!/^\d{4}-\d{2}$/.test(monthVal)) return null;
        const [y, m] = monthVal.split("-").map(Number);
        return { from: `${monthVal}-01`, to: `${monthVal}-${lastDayOfMonth(y, m)}` };
      }
      case "year":
        return /^\d{4}$/.test(yearVal) ? { from: `${yearVal}-01-01`, to: `${yearVal}-12-31` } : null;
      case "date":
        return /^\d{4}-\d{2}-\d{2}$/.test(dateVal) ? { from: dateVal, to: dateVal } : null;
      case "range": {
        if (!rangeFrom && !rangeTo) return null;
        const from = rangeFrom || "0000-01-01";
        const to = rangeTo || "9999-12-31";
        return from <= to ? { from, to } : { from: to, to: from };
      }
      default:
        return null;
    }
  }, [dateMode, dateVal, monthVal, yearVal, rangeFrom, rangeTo, todayYMD]);

  const filtered = useMemo(() => {
    const activeTypes = [...types];
    return payments.filter((p) => {
      if (activeTypes.length && !activeTypes.some((k) => TYPE_DEFS.find((t) => t.key === k)!.match(p))) return false;
      if (range) {
        const ymd = istYMD(p.created_at);
        if (!ymd || ymd < range.from || ymd > range.to) return false;
      }
      return true;
    });
  }, [payments, types, range]);

  // ---- Today's metrics (always TODAY in IST, independent of filters) ----
  const today = useMemo(() => {
    const yYMD = istYMD(new Date(Date.now() - 86400000)) || "";
    const paidOn = (ymd: string, pred: (p: Payment) => boolean) =>
      payments.filter((p) => isPaid(p.status) && pred(p) && istYMD(p.created_at) === ymd);
    const webToday = paidOn(todayYMD, (p) => p.item_type === "webinar");
    const webYest = paidOn(yYMD, (p) => p.item_type === "webinar");
    const crsToday = paidOn(todayYMD, (p) => p.item_type === "course");
    const crsYest = paidOn(yYMD, (p) => p.item_type === "course");
    return {
      webCount: webToday.length,
      webDelta: webToday.length - webYest.length,
      crsCount: crsToday.length,
      crsAmount: crsToday.reduce((a, p) => a + p.amount, 0),
      crsDelta: crsToday.length - crsYest.length,
    };
  }, [payments, todayYMD]);

  if (full.loading || enr.loading) return <LoadingBlock />;

  const captured = payments.filter((p) => isPaid(p.status)).reduce((a, p) => a + p.amount, 0);
  const refunded = payments.filter((p) => p.status === "refunded").reduce((a, p) => a + p.amount, 0);
  const pending = enrollments.reduce((a, e) => a + (e.pending || 0), 0);

  const years = Array.from(
    new Set(payments.map((p) => istYMD(p.created_at)?.slice(0, 4)).filter(Boolean) as string[])
  ).sort((a, b) => b.localeCompare(a));

  const statusPill = (s: Payment["status"]) =>
    isPaid(s) ? "pill-green" : s === "pending" || s === "PENDING" ? "pill-amber" : "pill-red";

  function toggleType(k: TypeKey) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const hasFilters = types.size > 0 || dateMode !== "all";
  function clearAll() {
    setTypes(new Set());
    setDateMode("all");
    setDateVal(""); setMonthVal(""); setYearVal(""); setRangeFrom(""); setRangeTo("");
  }

  function dateChipLabel(): string | null {
    if (dateMode === "all") return null;
    if (dateMode === "today") return "Today";
    if (dateMode === "yesterday") return "Yesterday";
    if (dateMode === "month") return monthVal ? `Month: ${monthVal}` : "This month";
    if (dateMode === "year") return yearVal ? `Year: ${yearVal}` : "This year";
    if (dateMode === "date") return dateVal ? `Date: ${dateVal}` : "Date";
    if (dateMode === "range") return `Range: ${rangeFrom || "…"} → ${rangeTo || "…"}`;
    return null;
  }

  function exportCsv() {
    const rows = [
      ["Student", "Phone", "Item", "Amount", "Login Code", "Status", "Date & Time (IST)"],
      ...filtered.map((p) => [p.student_name, p.phone, p.item, String(p.amount), buyerCodes[(p.phone || "").trim()] || "", p.status, formatISTDateTime(p.created_at)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "payments.csv"; a.click();
    URL.revokeObjectURL(url);
    toast("Exported payments.csv", "success");
  }

  const presets: { mode: DateMode; label: string }[] = [
    { mode: "today", label: "Today" },
    { mode: "yesterday", label: "Yesterday" },
    { mode: "month", label: "This month" },
    { mode: "year", label: "This year" },
  ];

  return (
    <div>
      <PageHeader title="Payments & Finance" subtitle="Razorpay & ICICI transactions, revenue & collections" action={<button onClick={exportCsv} className="btn btn-secondary text-sm">⬇ Export{hasFilters ? " (filtered)" : ""}</button>} />

      {/* Premium "today" summary cards (always IST today) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TodayCard
          icon="🎥"
          label="Webinar Registrations Today"
          value={today.webCount}
          delta={today.webDelta}
        />
        <TodayCard
          icon="🎓"
          label="Course Payments Today"
          value={today.crsCount}
          sub={today.crsAmount > 0 ? `${formatINR(today.crsAmount)} collected` : "No collections yet"}
          delta={today.crsDelta}
        />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Captured" value={formatINR(captured)} tone="green" />
        <KpiCard label="Pending Collections" value={formatINR(pending)} tone="red" />
        <KpiCard label="Refunded" value={formatINR(refunded)} tone="amber" />
        <KpiCard label="Transactions" value={payments.length} />
      </div>

      {/* Filter bar */}
      <div className="card mb-4 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          {/* Type chips */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Payment type</p>
            <div className="flex flex-wrap gap-2">
              {TYPE_DEFS.map((t) => {
                const active = types.has(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => toggleType(t.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? "border-primary bg-primary/10 text-primary" : "border-line text-ink2 hover:border-primary/50"}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date controls */}
          <div className="lg:max-w-[60%]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Date (IST)</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDateMode("all")}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${dateMode === "all" ? "border-primary bg-primary/10 text-primary" : "border-line text-ink2 hover:border-primary/50"}`}
              >
                All time
              </button>
              {presets.map((p) => (
                <button
                  key={p.mode}
                  onClick={() => setDateMode(p.mode)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${dateMode === p.mode ? "border-primary bg-primary/10 text-primary" : "border-line text-ink2 hover:border-primary/50"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Specific date
                <input type="date" value={dateVal} onChange={(e) => { setDateVal(e.target.value); setDateMode("date"); }} className="input text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Month
                <input type="month" value={monthVal} onChange={(e) => { setMonthVal(e.target.value); setDateMode("month"); }} className="input text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Year
                <select value={yearVal} onChange={(e) => { setYearVal(e.target.value); setDateMode("year"); }} className="input text-sm">
                  <option value="">Select…</option>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <div className="flex flex-col gap-1 text-xs text-muted">
                Custom range
                <div className="flex items-center gap-1">
                  <input type="date" value={rangeFrom} onChange={(e) => { setRangeFrom(e.target.value); setDateMode("range"); }} className="input text-sm" />
                  <span className="text-muted">–</span>
                  <input type="date" value={rangeTo} onChange={(e) => { setRangeTo(e.target.value); setDateMode("range"); }} className="input text-sm" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Active filter chips */}
        {hasFilters && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-xs text-muted">Active:</span>
            {[...types].map((k) => (
              <button key={k} onClick={() => toggleType(k)} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium hover:bg-surface">
                {TYPE_LABEL[k]} <span aria-hidden>×</span>
              </button>
            ))}
            {dateChipLabel() && (
              <button onClick={() => { setDateMode("all"); setDateVal(""); setMonthVal(""); setYearVal(""); setRangeFrom(""); setRangeTo(""); }} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium hover:bg-surface">
                {dateChipLabel()} <span aria-hidden>×</span>
              </button>
            )}
            <button onClick={clearAll} className="ml-auto text-xs font-semibold text-primary hover:underline">Clear all</button>
          </div>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs text-muted">Showing {filtered.length} of {payments.length} transactions</p>
      </div>

      <TableShell headers={["Student", "Phone", "Item", "Amount", "Reference / Gateway", "Login Code", "Status", "Date", "Date & Time (IST)"]}>
        {filtered.length === 0 ? (
          <tr>
            <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted">
              {payments.length === 0 ? "No payments yet." : "No payments match these filters."}
            </td>
          </tr>
        ) : (
          filtered.map((p) => (
            <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface2">
              <td className="px-4 py-3 font-medium">{p.student_name}</td>
              <td className="px-4 py-3">{p.phone}</td>
              <td className="px-4 py-3 text-xs">{p.item}</td>
              <td className="px-4 py-3">{formatINR(p.amount)}</td>
              <td className="px-4 py-3 text-xs">
                {p.reference_no ? <span className="font-mono">{p.reference_no}</span> : <span className="text-muted">{p.razorpay_payment_id || "—"}</span>}
                <div className="text-muted">{p.gateway || (p.mode ? `Razorpay · ${p.mode}` : "")}</div>
              </td>
              <td className="px-4 py-3">
                {buyerCodes[(p.phone || "").trim()] ? (
                  <span className="font-mono text-xs font-semibold text-primary">{buyerCodes[(p.phone || "").trim()]}</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3"><span className={`pill ${statusPill(p.status)}`}>{p.status}</span></td>
              <td className="px-4 py-3">{formatDate(p.created_at)}</td>
              <td className="px-4 py-3 whitespace-nowrap text-xs">{p.created_at ? formatISTDateTime(p.created_at) : "—"}</td>
            </tr>
          ))
        )}
      </TableShell>
    </div>
  );
}

function TodayCard({ icon, label, value, sub, delta }: { icon: string; label: string; value: number; sub?: string; delta?: number }) {
  const showDelta = typeof delta === "number" && delta !== 0;
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-2xl">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className="font-heading text-3xl font-extrabold tabular-nums">{value}</p>
          {showDelta && (
            <span className={`text-xs font-semibold ${delta! > 0 ? "text-success" : "text-danger"}`}>
              {delta! > 0 ? "▲" : "▼"} {Math.abs(delta!)} vs yesterday
            </span>
          )}
        </div>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
}
