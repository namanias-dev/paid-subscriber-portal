"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, KpiCard } from "@/components/admin/ui";
import WebinarRegistrationsTrend from "@/components/admin/WebinarRegistrationsTrend";
import GroupedTimeline, { type TimelineGroup } from "@/components/admin/GroupedTimeline";
import SendSmsButton from "@/components/admin/sms/SendSmsButton";
import PaymentAccountability from "@/components/admin/payments/PaymentAccountability";
import SortControl from "@/components/admin/SortControl";
import SearchBar from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";
import { usePersistentState } from "@/lib/usePersistentState";
import { formatINR, formatISTDateTime, istYMD, istTodayYMD } from "@/lib/dates";
import { dedupedPaidTotal, distinctRegistrations } from "@/lib/paymentsAgg";
import type { Payment, Enrollment, PaymentProof, PaymentProofFile, PaymentActionLog } from "@/lib/types";

type PaymentSort = "recent" | "spent" | "count" | "name";
const PAYMENT_SORTS: { value: PaymentSort; label: string }[] = [
  { value: "recent", label: "Most recent activity" },
  { value: "spent", label: "Total spent (high → low)" },
  { value: "count", label: "Most transactions" },
  { value: "name", label: "Name (A → Z)" },
];

type ProofWithAccess = PaymentProof & { hasAccess: boolean };

const PROOF_STATUS_META: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Proof uploaded", cls: "pill-blue" },
  reupload_requested: { label: "Reupload requested", cls: "pill-amber" },
  accepted: { label: "Proof accepted", cls: "pill-green" },
  rejected: { label: "Proof rejected", cls: "pill-red" },
};

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

// ---- Payment lifecycle status (labels + colors) ----
const isNonPaid = (s: Payment["status"]) => !isPaid(s) && s !== "refunded";

function statusPillClass(s: Payment["status"]): string {
  if (isPaid(s)) return "pill-green";
  if (s === "VERIFYING") return "pill-blue";
  if (s === "ABANDONED") return "pill-saffron";
  if (s === "FAILED") return "pill-red";
  if (s === "refunded") return "pill-gray";
  return "pill-amber"; // PENDING / pending
}
function statusLabel(s: Payment["status"]): string {
  if (s === "captured") return "PAID";
  if (s === "pending") return "PENDING";
  return s;
}

type StatusKey = "paid" | "pending" | "verifying" | "abandoned" | "failed" | "needs";
const STATUS_DEFS: { key: StatusKey; label: string; match: (p: Payment) => boolean }[] = [
  { key: "paid", label: "Paid", match: (p) => isPaid(p.status) },
  { key: "pending", label: "Pending", match: (p) => p.status === "PENDING" || p.status === "pending" },
  { key: "verifying", label: "Verifying", match: (p) => p.status === "VERIFYING" },
  { key: "abandoned", label: "Abandoned", match: (p) => p.status === "ABANDONED" },
  { key: "failed", label: "Failed", match: (p) => p.status === "FAILED" },
  { key: "needs", label: "Needs verification", match: (p) => isNonPaid(p.status) },
];
const STATUS_LABEL: Record<StatusKey, string> = Object.fromEntries(STATUS_DEFS.map((s) => [s.key, s.label])) as Record<StatusKey, string>;

type DateMode = "all" | "today" | "yesterday" | "month" | "year" | "date" | "range";

function lastDayOfMonth(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return String(d).padStart(2, "0");
}

export default function PaymentsAdmin() {
  const full = useAdminData<Payment[]>("/api/admin/payments", "payments");
  const enr = useAdminData<Enrollment[]>("/api/admin/payments", "enrollments");
  const codes = useAdminData<Record<string, string>>("/api/admin/payments", "buyerCodes");
  const proofsHook = useAdminData<Record<string, ProofWithAccess>>("/api/admin/payments", "proofs");
  const canManage = useAdminData<boolean>("/api/admin/payments", "canManage").data || false;
  const isSuper = useAdminData<boolean>("/api/admin/payments", "isSuper").data || false;
  const { toast } = useToast();

  // ---- Filters (read-only display state) ----
  const [q, setQ] = useState("");
  const [sort, setSort] = usePersistentState<PaymentSort>("nsa.payments.sort", "recent");
  const [types, setTypes] = useState<Set<TypeKey>>(new Set());
  const [statuses, setStatuses] = useState<Set<StatusKey>>(new Set());
  const [onlyProof, setOnlyProof] = useState(false);
  const [proofModal, setProofModal] = useState<{ payment: Payment; proof: ProofWithAccess | null } | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [reverifying, setReverifying] = useState(false);
  const [reverifyMsg, setReverifyMsg] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("all");
  const [dateVal, setDateVal] = useState("");      // YYYY-MM-DD
  const [monthVal, setMonthVal] = useState("");    // YYYY-MM
  const [yearVal, setYearVal] = useState("");      // YYYY
  const [rangeFrom, setRangeFrom] = useState("");  // YYYY-MM-DD
  const [rangeTo, setRangeTo] = useState("");      // YYYY-MM-DD

  const payments = useMemo(() => full.data || [], [full.data]);
  const enrollments = enr.data || [];
  const buyerCodes = codes.data || {};
  const proofs = useMemo(() => proofsHook.data || {}, [proofsHook.data]);
  const proofCount = useMemo(
    () => Object.values(proofs).filter((p) => p.status === "submitted" || p.status === "reupload_requested").length,
    [proofs],
  );

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
    const activeStatuses = [...statuses];
    const query = q.trim().toLowerCase();
    return payments.filter((p) => {
      if (activeTypes.length && !activeTypes.some((k) => TYPE_DEFS.find((t) => t.key === k)!.match(p))) return false;
      if (activeStatuses.length && !activeStatuses.some((k) => STATUS_DEFS.find((s) => s.key === k)!.match(p))) return false;
      if (onlyProof && !proofs[p.id]) return false;
      if (range) {
        const ymd = istYMD(p.created_at);
        if (!ymd || ymd < range.from || ymd > range.to) return false;
      }
      if (query) {
        const hay = `${p.student_name || ""} ${p.phone || ""} ${p.item || ""} ${p.reference_no || ""}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [payments, types, statuses, onlyProof, proofs, range, q]);

  // Group the (already filtered) transactions by USER — purely presentational.
  // The sum of all nodes equals filtered.length; no row is dropped or merged.
  const userGroups = useMemo((): TimelineGroup[] => {
    const byPhone = new Map<string, Payment[]>();
    for (const p of filtered) {
      const key = (p.phone || "").trim() || `id:${p.id}`;
      const arr = byPhone.get(key);
      if (arr) arr.push(p); else byPhone.set(key, [p]);
    }
    const dotFor = (s: Payment["status"]) =>
      isPaid(s) ? "bg-success" : s === "VERIFYING" ? "bg-blue-500" : s === "ABANDONED" ? "bg-orange-500" : s === "FAILED" ? "bg-danger" : s === "refunded" ? "bg-ink2" : "bg-amber-500";

    const rows = [...byPhone.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const latest = sorted[0];
      const name = (sorted.find((r) => r.student_name)?.student_name || latest.student_name || "—").trim() || "—";
      const phone = (latest.phone || "").trim();
      const paidTotal = sorted.filter((r) => isPaid(r.status)).reduce((a, r) => a + r.amount, 0);
      const code = buyerCodes[phone] || "";

      const nodes = sorted.map((p) => ({
        id: p.id,
        dot: dotFor(p.status),
        title: p.item || "—",
        subtitle: [
          p.payment_kind || p.item_type,
          p.installment_no ? `installment #${p.installment_no}` : null,
          p.reference_no || p.razorpay_payment_id || null,
          p.gateway || (p.mode ? `Razorpay · ${p.mode}` : null),
        ].filter(Boolean).join(" · "),
        right: formatINR(p.amount),
        datetime: p.created_at,
        badge: (
          <span className="flex items-center gap-1.5">
            <span className={`pill ${statusPillClass(p.status)}`}>{statusLabel(p.status)}</span>
            {isNonPaid(p.status) && p.reference_no && (
              <button
                onClick={(e) => { e.stopPropagation(); reverifyOne(p.reference_no); }}
                disabled={reverifying}
                title="Re-verify this payment with ICICI"
                className="rounded-md border border-line px-1.5 py-0.5 text-xs text-ink2 transition hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                ↻
              </button>
            )}
            {proofs[p.id] && (
              <button
                onClick={(e) => { e.stopPropagation(); setProofModal({ payment: p, proof: proofs[p.id] }); }}
                className={`pill ${PROOF_STATUS_META[proofs[p.id].status]?.cls || "pill-gray"} cursor-pointer`}
                title="View submitted payment proof"
              >
                📎 {PROOF_STATUS_META[proofs[p.id].status]?.label || proofs[p.id].status}
              </button>
            )}
            {canManage && (
              <button
                onClick={(e) => { e.stopPropagation(); setProofModal({ payment: p, proof: proofs[p.id] || null }); }}
                title="Upload proof, approve, reverse or view full history"
                className="rounded-md border border-line px-1.5 py-0.5 text-xs text-ink2 transition hover:border-primary/50 hover:text-primary"
              >
                Manage
              </button>
            )}
          </span>
        ),
      }));

      return { key, name, phone, latestAt: new Date(latest.created_at).getTime(), paidTotal, count: sorted.length, latestStatus: latest.status, code, nodes };
    });

    rows.sort((a, b) => {
      if (sort === "spent") return b.paidTotal - a.paidTotal || b.latestAt - a.latestAt;
      if (sort === "count") return b.count - a.count || b.latestAt - a.latestAt;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.latestAt - a.latestAt; // recent
    });

    return rows.map((r): TimelineGroup => ({
      id: r.key,
      name: r.name,
      phone: r.phone || undefined,
      tag: r.code ? <span className="font-mono text-[11px] font-semibold text-primary">{r.code}</span> : undefined,
      summary: (
        <div className="flex flex-col items-end gap-1">
          <span className="text-sm font-bold text-ink">{formatINR(r.paidTotal)}</span>
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted">{r.count} txn{r.count === 1 ? "" : "s"}</span>
            <span className={`pill ${statusPillClass(r.latestStatus)}`}>{statusLabel(r.latestStatus)}</span>
          </span>
        </div>
      ),
      nodes: r.nodes,
    }));
  }, [filtered, sort, buyerCodes, proofs, reverifying, canManage]);

  const matchOpenIds = useMemo(
    () => (q.trim() ? new Set(userGroups.map((g) => g.id)) : undefined),
    [q, userGroups],
  );

  // Non-paid rows in the current filtered view (targets for "Re-verify filtered").
  const filteredNonPaidRefs = useMemo(
    () => filtered.filter((p) => isNonPaid(p.status) && p.reference_no).map((p) => p.reference_no as string),
    [filtered],
  );
  const abandoned = useMemo(() => filtered.filter((p) => p.status === "ABANDONED"), [filtered]);
  const abandonedAllCount = useMemo(() => payments.filter((p) => p.status === "ABANDONED").length, [payments]);

  // ---- Today's metrics (always TODAY in IST, independent of filters) ----
  const today = useMemo(() => {
    const yYMD = istYMD(new Date(Date.now() - 86400000)) || "";
    const paidOn = (ymd: string, pred: (p: Payment) => boolean) =>
      payments.filter((p) => isPaid(p.status) && pred(p) && istYMD(p.created_at) === ymd);
    const webToday = paidOn(todayYMD, (p) => p.item_type === "webinar");
    const webYest = paidOn(yYMD, (p) => p.item_type === "webinar");
    const crsToday = paidOn(todayYMD, (p) => p.item_type === "course");
    const crsYest = paidOn(yYMD, (p) => p.item_type === "course");
    // Seats/registrations are counted DISTINCT-by-(phone, item) so a retry that
    // leaves two paid rows for the same person+item is one seat; revenue collapses
    // exact retry-duplicates but keeps legitimate installments/seat+full.
    const webCount = distinctRegistrations(webToday);
    const crsCount = distinctRegistrations(crsToday);
    return {
      webCount,
      webDelta: webCount - distinctRegistrations(webYest),
      crsCount,
      crsAmount: dedupedPaidTotal(crsToday),
      crsDelta: crsCount - distinctRegistrations(crsYest),
    };
  }, [payments, todayYMD]);

  if (full.loading || enr.loading) return <LoadingBlock />;

  const captured = dedupedPaidTotal(payments.filter((p) => isPaid(p.status)));
  const refunded = payments.filter((p) => p.status === "refunded").reduce((a, p) => a + p.amount, 0);
  const pending = enrollments.reduce((a, e) => a + (e.pending || 0), 0);

  const years = Array.from(
    new Set(payments.map((p) => istYMD(p.created_at)?.slice(0, 4)).filter(Boolean) as string[])
  ).sort((a, b) => b.localeCompare(a));

  function toggleType(k: TypeKey) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function toggleStatus(k: StatusKey) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  // ---- Re-verify against ICICI (reuses the shared verifier; never downgrades PAID) ----
  async function callReverify(body: Record<string, unknown>): Promise<boolean> {
    setReverifying(true);
    setReverifyMsg("Re-verifying with ICICI…");
    try {
      const res = await fetch("/api/admin/payments/reverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        toast(json.error || "Re-verification failed.", "error");
        setReverifyMsg(null);
        return false;
      }
      const r = json.result as { scanned: number; toPaid: number; toFailed: number; toAbandoned: number; toVerifying: number; unreachable: number };
      const parts = [
        `${r.toPaid} → PAID`,
        r.toFailed ? `${r.toFailed} → failed` : null,
        r.toAbandoned ? `${r.toAbandoned} → abandoned` : null,
        r.toVerifying ? `${r.toVerifying} → verifying` : null,
      ].filter(Boolean);
      toast(`Re-verified ${r.scanned}: ${parts.join(", ") || "no changes"}${r.unreachable ? ` · ${r.unreachable} unreachable` : ""}`, "success");
      setReverifyMsg(null);
      full.reload();
      return true;
    } catch {
      toast("Re-verification failed.", "error");
      setReverifyMsg(null);
      return false;
    } finally {
      setReverifying(false);
    }
  }
  const NONPAID_STATUSES = ["PENDING", "pending", "VERIFYING", "ABANDONED", "FAILED"];
  function reverifyAll() {
    callReverify({ statuses: NONPAID_STATUSES });
  }
  function reverifyFiltered() {
    if (!filteredNonPaidRefs.length) {
      toast("No non-paid payments in the current view.", "info");
      return;
    }
    callReverify({ referenceNos: filteredNonPaidRefs });
  }
  function reverifyOne(ref: string | null | undefined) {
    if (!ref) {
      toast("This row has no ICICI reference to verify.", "info");
      return;
    }
    callReverify({ referenceNos: [ref] });
  }

  const hasFilters = types.size > 0 || statuses.size > 0 || onlyProof || dateMode !== "all";
  function clearAll() {
    setTypes(new Set());
    setStatuses(new Set());
    setOnlyProof(false);
    setDateMode("all");
    setDateVal(""); setMonthVal(""); setYearVal(""); setRangeFrom(""); setRangeTo("");
  }

  // ---- Proof actions (request reupload / accept payment / add note) ----
  async function proofAction(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/payments/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        toast(json.error || "Action failed.", "error");
        return false;
      }
      full.reload();
      proofsHook.reload();
      return true;
    } catch {
      toast("Action failed.", "error");
      return false;
    }
  }
  async function editPayment(paymentId: string, patch: Record<string, unknown>, reason: string): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/payments/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, patch, reason }),
      });
      const json = await res.json();
      if (!json.ok) { toast(json.error || "Edit failed.", "error"); return false; }
      toast("Payment updated and logged.", "success");
      full.reload(); proofsHook.reload();
      return true;
    } catch { toast("Edit failed.", "error"); return false; }
  }
  async function deletePayment(paymentId: string, reason: string): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/payments/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, reason }),
      });
      const json = await res.json();
      if (!json.ok) { toast(json.error || "Delete failed.", "error"); return false; }
      toast("Payment moved to Trash (recoverable).", "success");
      full.reload(); proofsHook.reload();
      return true;
    } catch { toast("Delete failed.", "error"); return false; }
  }
  async function reversePayment(paymentId: string, reason: string): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/payments/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, reason }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast(json.error || "Reversal failed.", "error");
        return false;
      }
      toast("Approval reversed. Access re-locked and logged.", "success");
      full.reload();
      proofsHook.reload();
      return true;
    } catch {
      toast("Reversal failed.", "error");
      return false;
    }
  }
  async function viewProofFile(key: string) {
    try {
      const res = await fetch(`/api/admin/payments/proof/view?key=${encodeURIComponent(key)}`);
      const json = await res.json();
      if (!json.ok) {
        toast(json.error || "Could not open the file.", "error");
        return;
      }
      window.open(json.url, "_blank", "noopener,noreferrer");
    } catch {
      toast("Could not open the file.", "error");
    }
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
      <PageHeader
        title="Payments & Finance"
        subtitle="Razorpay & ICICI transactions, revenue & collections"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={reverifyAll} disabled={reverifying} className="btn btn-primary text-sm disabled:opacity-60" title="Re-check every non-paid payment against ICICI's status API">
              {reverifying ? "Re-verifying…" : "↻ Re-verify payments"}
            </button>
            {hasFilters && (
              <button onClick={reverifyFiltered} disabled={reverifying} className="btn btn-secondary text-sm disabled:opacity-60" title="Re-verify only the non-paid rows in the current filtered view">
                Re-verify filtered ({filteredNonPaidRefs.length})
              </button>
            )}
            <button onClick={exportCsv} className="btn btn-secondary text-sm">⬇ Export{hasFilters ? " (filtered)" : ""}</button>
            {isSuper && (
              <button onClick={() => setShowTrash(true)} className="btn btn-secondary text-sm" title="Recoverable Trash — soft-deleted payments">🗑 Trash</button>
            )}
          </div>
        }
      />

      {/* Premium "today" summary cards (always IST today) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        <WebinarRegistrationsTrend payments={payments} />
      </div>

      {isSuper && <PaymentAccountability />}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Captured" value={formatINR(captured)} tone="green" />
        <KpiCard label="Pending Collections" value={formatINR(pending)} tone="red" />
        <KpiCard label="Refunded" value={formatINR(refunded)} tone="amber" />
        <KpiCard label="Transactions" value={payments.length} />
      </div>

      {/* Filter bar */}
      <div className="card mb-4 p-4">
        {/* Status chips */}
        <div className="mb-4 border-b border-line pb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUS_DEFS.map((s) => {
              const active = statuses.has(s.key);
              const dot =
                s.key === "paid" ? "bg-success" :
                s.key === "pending" ? "bg-amber-500" :
                s.key === "verifying" ? "bg-blue-500" :
                s.key === "abandoned" ? "bg-orange-500" :
                s.key === "failed" ? "bg-danger" : "bg-ink2";
              return (
                <button
                  key={s.key}
                  onClick={() => toggleStatus(s.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? "border-primary bg-primary/10 text-primary" : "border-line text-ink2 hover:border-primary/50"}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {s.label}
                </button>
              );
            })}
            <button
              onClick={() => setOnlyProof((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${onlyProof ? "border-primary bg-primary/10 text-primary" : "border-line text-ink2 hover:border-primary/50"}`}
              title="Show only payments with a student-submitted proof"
            >
              <span aria-hidden>📎</span>
              Proof uploaded{proofCount > 0 ? ` (${proofCount})` : ""}
            </button>
          </div>
        </div>

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
            {[...statuses].map((k) => (
              <button key={k} onClick={() => toggleStatus(k)} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium hover:bg-surface">
                {STATUS_LABEL[k]} <span aria-hidden>×</span>
              </button>
            ))}
            {[...types].map((k) => (
              <button key={k} onClick={() => toggleType(k)} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium hover:bg-surface">
                {TYPE_LABEL[k]} <span aria-hidden>×</span>
              </button>
            ))}
            {onlyProof && (
              <button onClick={() => setOnlyProof(false)} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium hover:bg-surface">
                Proof uploaded <span aria-hidden>×</span>
              </button>
            )}
            {dateChipLabel() && (
              <button onClick={() => { setDateMode("all"); setDateVal(""); setMonthVal(""); setYearVal(""); setRangeFrom(""); setRangeTo(""); }} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium hover:bg-surface">
                {dateChipLabel()} <span aria-hidden>×</span>
              </button>
            )}
            <button onClick={clearAll} className="ml-auto text-xs font-semibold text-primary hover:underline">Clear all</button>
          </div>
        )}
      </div>

      {/* ABANDONED = hot leads. A callout to triage + call them. */}
      {abandonedAllCount > 0 && !statuses.has("abandoned") && (
        <button
          onClick={() => setStatuses(new Set(["abandoned"]))}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-left transition hover:bg-orange-100"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-500/15 text-lg">🔥</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-orange-900">
              {abandonedAllCount} abandoned {abandonedAllCount === 1 ? "checkout" : "checkouts"} — hot leads to call
            </span>
            <span className="block text-xs text-orange-700">Clicked Pay but never completed. Tap to view their contact details.</span>
          </span>
          <span className="ml-auto shrink-0 text-xs font-semibold text-orange-800">View →</span>
        </button>
      )}

      {/* Dedicated hot-leads contact list when the Abandoned filter is active. */}
      {statuses.has("abandoned") && abandoned.length > 0 && (
        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50/50 p-4">
          <p className="mb-3 text-sm font-semibold text-orange-900">🔥 Hot leads — abandoned checkouts ({abandoned.length})</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {abandoned.map((p) => {
              const wa = (p.phone || "").replace(/\D/g, "");
              return (
                <div key={p.id} className="rounded-lg border border-orange-200 bg-white p-3 text-sm">
                  <p className="font-semibold text-ink">{p.student_name || "—"}</p>
                  <p className="text-xs text-muted">{p.item}</p>
                  <p className="mt-1 font-mono text-xs">{p.phone || "—"}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{p.created_at ? formatISTDateTime(p.created_at) : "—"}</p>
                  <div className="mt-2 flex gap-2">
                    {p.phone && <a href={`tel:${p.phone}`} className="btn btn-secondary px-2 py-1 text-xs">Call</a>}
                    {wa && (
                      <a href={`https://wa.me/91${wa.slice(-10)}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary px-2 py-1 text-xs">
                        WhatsApp
                      </a>
                    )}
                    <button onClick={() => reverifyOne(p.reference_no)} disabled={reverifying} className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-60">↻ Verify</button>
                    <SendSmsButton phone={p.phone} name={p.student_name} className="btn btn-secondary px-2 py-1 text-xs" label="SMS" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + sort toolbar (display-only; operates on the filtered set) */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-[220px] flex-1">
          <SearchBar value={q} onChange={setQ} placeholder="Search name / phone / item / reference" />
        </div>
        <SortControl value={sort} onChange={setSort} options={PAYMENT_SORTS} />
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-muted">
          Showing {filtered.length} of {payments.length} transactions · {userGroups.length} {userGroups.length === 1 ? "user" : "users"}
        </p>
        {reverifyMsg && <p className="text-xs font-medium text-primary">{reverifyMsg}</p>}
      </div>

      <GroupedTimeline
        groups={userGroups}
        forceOpenIds={matchOpenIds}
        emptyText={payments.length === 0 ? "No payments yet." : "No payments match these filters."}
      />

      {proofModal && (
        <ProofModal
          payment={proofModal.payment}
          proof={proofModal.proof}
          buyerCode={buyerCodes[(proofModal.payment.phone || "").trim()]}
          isSuper={isSuper}
          onClose={() => setProofModal(null)}
          onViewFile={viewProofFile}
          onReverse={reversePayment}
          onEdit={editPayment}
          onDelete={async (id, reason) => {
            const ok = await deletePayment(id, reason);
            if (ok) setProofModal(null);
            return ok;
          }}
          onAction={async (body) => {
            const ok = await proofAction(body);
            if (ok) setProofModal(null);
          }}
        />
      )}

      {showTrash && isSuper && <TrashModal onClose={() => { setShowTrash(false); full.reload(); proofsHook.reload(); }} />}
    </div>
  );
}

const PROOF_ACCEPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const PROOF_MAX_BYTES = 8 * 1024 * 1024;
const PROOF_MAX_FILES = 3;

function ProofModal({
  payment,
  proof,
  buyerCode,
  isSuper,
  onClose,
  onViewFile,
  onAction,
  onReverse,
  onEdit,
  onDelete,
}: {
  payment: Payment;
  proof: ProofWithAccess | null;
  buyerCode?: string;
  isSuper: boolean;
  onClose: () => void;
  onViewFile: (key: string) => void;
  onAction: (body: Record<string, unknown>) => void;
  onReverse: (paymentId: string, reason: string) => Promise<boolean>;
  onEdit: (paymentId: string, patch: Record<string, unknown>, reason: string) => Promise<boolean>;
  onDelete: (paymentId: string, reason: string) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editAmount, setEditAmount] = useState(String(payment.amount));
  const [editStatus, setEditStatus] = useState(payment.status);
  const [editRef, setEditRef] = useState(payment.reference_no || "");
  const [editName, setEditName] = useState(payment.student_name || "");
  const [editReason, setEditReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState<PaymentActionLog[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const meta = proof ? PROOF_STATUS_META[proof.status] || { label: proof.status, cls: "pill-gray" } : null;
  const isPaidRow = isPaid(payment.status);

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const room = PROOF_MAX_FILES - (proof?.files.length ?? 0);
    if (room <= 0) { toast(`Up to ${PROOF_MAX_FILES} files only.`, "error"); return; }
    const files = Array.from(fileList).slice(0, room);
    setUploading(true);
    const uploaded: PaymentProofFile[] = [];
    try {
      for (const file of files) {
        if (!PROOF_ACCEPT_TYPES.includes(file.type)) { toast(`${file.name}: only images/PDF allowed.`, "error"); continue; }
        if (file.size > PROOF_MAX_BYTES) { toast(`${file.name}: must be 8 MB or smaller.`, "error"); continue; }
        const signRes = await fetch("/api/admin/payments/proof/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: payment.id, fileName: file.name, contentType: file.type, size: file.size }),
        });
        const sign = await signRes.json();
        if (!sign.ok) { toast(sign.error || "Upload failed.", "error"); continue; }
        const put = await fetch(sign.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) { toast(`${file.name}: upload failed.`, "error"); continue; }
        uploaded.push(sign.file as PaymentProofFile);
      }
      if (uploaded.length) {
        onAction({ action: "upload", paymentId: payment.id, files: uploaded, note: note || null });
      }
    } finally {
      setUploading(false);
    }
  }

  async function loadHistory() {
    setShowHistory(true);
    if (history) return;
    try {
      const res = await fetch(`/api/admin/payments/${encodeURIComponent(payment.id)}/history`);
      const json = await res.json();
      if (json.ok) setHistory(json.history as PaymentActionLog[]);
      else toast(json.error || "Could not load history.", "error");
    } catch {
      toast("Could not load history.", "error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Manage payment</h3>
            <p className="text-sm text-muted">{payment.student_name} · {payment.phone}</p>
          </div>
          {meta ? <span className={`pill ${meta.cls}`}>{meta.label}</span> : <span className={`pill ${statusPillClass(payment.status)}`}>{statusLabel(payment.status)}</span>}
        </div>

        {/* Already-has-access guard */}
        {proof?.hasAccess && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-900">
            <span>✅</span>
            <span>This student <span className="font-semibold">already has access</span> to this item (paid on another attempt or a valid grant). Accepting is usually unnecessary.</span>
          </div>
        )}

        {/* Payment metadata */}
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-surface2 p-3 text-xs">
          <div><span className="text-muted">Item</span><div className="font-medium">{payment.item}</div></div>
          <div><span className="text-muted">Amount</span><div className="font-medium">{formatINR(payment.amount)}</div></div>
          <div><span className="text-muted">Status</span><div className="font-medium">{statusLabel(payment.status)}</div></div>
          <div><span className="text-muted">Login code</span><div className="font-mono font-medium">{buyerCode || "—"}</div></div>
          <div className="col-span-2"><span className="text-muted">Reference</span><div className="font-mono">{payment.reference_no || payment.razorpay_payment_id || "—"}</div></div>
        </div>

        {/* Staff upload (non-paid only) */}
        {!isPaidRow && (
          <div className="mt-4 rounded-lg border border-dashed border-line p-3">
            <p className="text-sm font-semibold">Upload payment proof (on student&apos;s behalf)</p>
            <p className="mt-0.5 text-xs text-muted">Images or PDF, up to {PROOF_MAX_FILES} files · 8 MB each. Uploading never grants access.</p>
            <input
              type="file"
              multiple
              accept={PROOF_ACCEPT_TYPES.join(",")}
              disabled={uploading}
              onChange={(e) => uploadFiles(e.target.files)}
              className="mt-2 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary"
            />
            {uploading && <p className="mt-2 text-xs font-medium text-primary">Uploading…</p>}
          </div>
        )}

        {/* Files */}
        {proof && (
          <div className="mt-4">
            <p className="text-sm font-semibold">Uploaded files ({proof.files.length})</p>
            <div className="mt-2 space-y-2">
              {proof.files.length === 0 && <p className="text-xs text-muted">No files.</p>}
              {proof.files.map((f) => (
                <button
                  key={f.key}
                  onClick={() => onViewFile(f.key)}
                  className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-xs transition hover:border-primary/50"
                >
                  <span className="truncate">{f.name}</span>
                  <span className="ml-2 shrink-0 font-semibold text-primary">View (signed) →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Student note */}
        {proof?.student_note && (
          <div className="mt-4">
            <p className="text-sm font-semibold">Note</p>
            <p className="mt-1 rounded-lg bg-surface2 p-3 text-xs">{proof.student_note}</p>
          </div>
        )}

        {/* Proof actions (only when a proof exists) */}
        {proof && (
          <div className="mt-5 space-y-3 border-t border-line pt-4">
            <div>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (shown to student on reupload/reject)"
                className="input w-full text-sm"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => onAction({ action: "request_reupload", proofId: proof.id, paymentId: payment.id, reason })} className="btn btn-secondary text-sm">
                  Request reupload
                </button>
                <button onClick={() => onAction({ action: "reject", proofId: proof.id, paymentId: payment.id, reason })} className="btn btn-secondary text-sm">
                  Reject proof
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note" className="input w-full text-sm" />
              <button onClick={() => note.trim() && onAction({ action: "note", proofId: proof.id, note })} className="btn btn-secondary text-sm">
                Add note
              </button>
            </div>
          </div>
        )}

        {/* Approve */}
        <div className="mt-4 border-t border-line pt-4">
          <button
            onClick={() => {
              if (isPaidRow) return;
              if (confirm(`Approve payment and grant access to ${payment.student_name}? This marks the payment PAID.`)) {
                onAction({ action: "accept", paymentId: payment.id, note: note || null });
              }
            }}
            disabled={isPaidRow}
            className="btn btn-primary w-full text-sm disabled:opacity-60"
            title={isPaidRow ? "Already paid" : "Mark this payment PAID and grant access (reuses the standard access path)"}
          >
            {isPaidRow ? "Already paid ✓" : "✓ Approve payment & grant access"}
          </button>
        </div>

        {/* Reverse (super admin, paid only) */}
        {isSuper && isPaidRow && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50/50 p-3">
            <p className="text-sm font-semibold text-red-900">Reverse approval (Super Admin)</p>
            <p className="mt-0.5 text-xs text-red-700">Reverts to the prior status, re-locks access and rolls back the schedule/receipt. The payment record &amp; proof are never deleted.</p>
            <input
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Reason for reversal (required)"
              className="input mt-2 w-full text-sm"
            />
            <button
              onClick={async () => {
                if (!reverseReason.trim()) { toast("A reason is required to reverse.", "error"); return; }
                if (!confirm(`Reverse this approval for ${payment.student_name}? Access will be re-locked.`)) return;
                setReversing(true);
                const ok = await onReverse(payment.id, reverseReason.trim());
                setReversing(false);
                if (ok) onClose();
              }}
              disabled={reversing}
              className="btn mt-2 w-full bg-red-600 text-sm text-white hover:bg-red-700 disabled:opacity-60"
            >
              {reversing ? "Reversing…" : "↩ Reverse approval"}
            </button>
          </div>
        )}

        {/* Edit + soft-delete (super admin) */}
        {isSuper && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-900">Edit / delete payment (Super Admin)</p>
              <button onClick={() => setShowEdit((v) => !v)} className="text-xs font-semibold text-primary hover:underline">{showEdit ? "Hide" : "Edit fields"}</button>
            </div>
            {showEdit && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted">Amount (₹)
                  <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="input text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Status
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as Payment["status"])} className="input text-sm">
                    {["PENDING", "VERIFYING", "PAID", "FAILED", "ABANDONED", "refunded"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">Reference no.
                  <input value={editRef} onChange={(e) => setEditRef(e.target.value)} className="input text-sm" />
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">Student name
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input text-sm" />
                </label>
                <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="Reason (required, logged)" className="input col-span-2 text-sm" />
                <button
                  disabled={savingEdit}
                  onClick={async () => {
                    if (!editReason.trim()) { toast("A reason is required to edit.", "error"); return; }
                    const patch: Record<string, unknown> = {};
                    if (Number(editAmount) !== payment.amount) patch.amount = Number(editAmount);
                    if (editStatus !== payment.status) patch.status = editStatus;
                    if (editRef !== (payment.reference_no || "")) patch.reference_no = editRef;
                    if (editName !== (payment.student_name || "")) patch.student_name = editName;
                    if (Object.keys(patch).length === 0) { toast("No changes.", "info"); return; }
                    setSavingEdit(true);
                    const ok = await onEdit(payment.id, patch, editReason.trim());
                    setSavingEdit(false);
                    if (ok) onClose();
                  }}
                  className="btn btn-primary col-span-2 text-sm disabled:opacity-60"
                >
                  {savingEdit ? "Saving…" : "Save changes"}
                </button>
              </div>
            )}
            <div className="mt-3 border-t border-amber-200 pt-3">
              <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Reason for delete (required)" className="input w-full text-sm" />
              <button
                disabled={deleting}
                onClick={async () => {
                  if (!deleteReason.trim()) { toast("A reason is required to delete.", "error"); return; }
                  if (!confirm(`Move this payment to Trash? It stays fully recoverable. ${isPaidRow ? "Access will be re-locked." : ""}`)) return;
                  setDeleting(true);
                  await onDelete(payment.id, deleteReason.trim());
                  setDeleting(false);
                }}
                className="btn mt-2 w-full bg-red-600 text-sm text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "🗑 Move to Trash (recoverable)"}
              </button>
            </div>
          </div>
        )}

        {/* Lifecycle history (super admin) */}
        {isSuper && (
          <div className="mt-4 border-t border-line pt-4">
            {!showHistory ? (
              <button onClick={loadHistory} className="text-xs font-semibold text-primary hover:underline">
                View full lifecycle history →
              </button>
            ) : (
              <div>
                <p className="text-sm font-semibold">Lifecycle history</p>
                {history === null ? (
                  <p className="mt-1 text-xs text-muted">Loading…</p>
                ) : history.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">No recorded actions yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {history.map((l) => (
                      <li key={l.id} className="flex flex-wrap gap-1 text-muted">
                        <span className="font-medium text-ink">{l.action}</span>
                        <span>by {l.actor_name || l.actor_id || "—"}</span>
                        {(l.old_status || l.new_status) && <span>· {l.old_status || "—"} → {l.new_status || "—"}</span>}
                        <span>· {formatISTDateTime(l.created_at)}</span>
                        {l.reason && <span className="w-full text-ink2">“{l.reason}”</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <button onClick={onClose} className="btn btn-secondary mt-4 w-full text-sm">Close</button>
      </div>
    </div>
  );
}

function TrashModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/payments/trash")
      .then((r) => r.json())
      .then((d) => setRows(d.ok ? (d.payments as Payment[]) : []))
      .catch(() => setRows([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  async function restore(id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/payments/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: id }) });
      const json = await res.json();
      if (!json.ok) { toast(json.error || "Restore failed.", "error"); return; }
      toast("Payment restored.", "success");
      load();
    } finally { setBusy(null); }
  }
  async function permaDelete(id: string) {
    const reason = prompt("Permanent delete is irreversible. Type a reason to confirm:");
    if (!reason || !reason.trim()) return;
    setBusy(id);
    try {
      const res = await fetch("/api/admin/payments/permanent-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: id, reason: reason.trim() }) });
      const json = await res.json();
      if (!json.ok) { toast(json.error || "Permanent delete failed.", "error"); return; }
      toast("Payment permanently deleted.", "success");
      load();
    } finally { setBusy(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">🗑 Payment Trash (recoverable)</h3>
          <button onClick={onClose} className="text-sm text-muted hover:text-ink">✕</button>
        </div>
        <p className="mt-1 text-sm text-muted">Soft-deleted payments. Restore re-applies the ledger effect. Permanent delete is irreversible (and audit-logged).</p>
        {rows === null ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted">Trash is empty.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {rows.map((p) => (
              <div key={p.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.student_name || "—"} · {p.phone}</p>
                    <p className="text-xs text-muted">{p.item} · {formatINR(p.amount)} · {statusLabel(p.status)}</p>
                    <p className="truncate font-mono text-[10px] text-muted">{p.reference_no || p.id}</p>
                    {p.deleted_reason && <p className="mt-0.5 text-xs text-ink2">Reason: {p.deleted_reason}</p>}
                    {p.deleted_at && <p className="text-[11px] text-muted">Deleted {formatISTDateTime(p.deleted_at)}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button disabled={busy === p.id} onClick={() => restore(p.id)} className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-60">Restore</button>
                    <button disabled={busy === p.id} onClick={() => permaDelete(p.id)} className="btn bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-60">Delete forever</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
