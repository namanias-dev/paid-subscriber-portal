"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import SendSmsButton from "@/components/admin/sms/SendSmsButton";
import MoveRegistrationsModal from "@/components/admin/MoveRegistrationsModal";
import { formatISTDateTime } from "@/lib/dates";

type RegStatus = "paid" | "pending" | "failed" | "unpaid" | "free";

interface RegistrantsResponse {
  ok: boolean;
  webinar: { id: string; title: string; slug: string; price: number; isFree: boolean };
  counts: { total: number; confirmed: number; paid: number; pending: number; failed: number; unpaid: number };
  registrants: { id: string; name: string; phone: string; created_at: string; attended: boolean; status: RegStatus }[];
}

const STATUS_PILL: Record<RegStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "pill-green" },
  free: { label: "Free", cls: "pill-green" },
  pending: { label: "Pending", cls: "pill-amber" },
  failed: { label: "Failed", cls: "pill-red" },
  unpaid: { label: "Unpaid", cls: "pill-gray" },
};

export default function WebinarRegistrantsAdmin({ params }: { params: { id: string } }) {
  const { data, loading, reload } = useAdminData<RegistrantsResponse>(
    `/api/admin/webinars/${params.id}/registrations`,
    `webinar-regs-${params.id}`,
  );
  const [moveOpen, setMoveOpen] = useState(false);

  if (loading) return <LoadingBlock />;
  if (!data?.ok) {
    return (
      <div>
        <PageHeader title="Registrants" subtitle="Could not load this webinar's registrations." />
        <Link href="/admin/webinars" className="text-primary text-sm">← Back to webinars</Link>
      </div>
    );
  }

  const { webinar, counts, registrants } = data;

  const Stat = ({ label, value, cls }: { label: string; value: number; cls?: string }) => (
    <div className="card p-4">
      <p className={`text-2xl font-extrabold ${cls || ""}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={`Registrants — ${webinar.title}`}
        subtitle={`${webinar.isFree ? "Free webinar" : "Paid webinar"} · Confirmed counts paid + free only — pending/failed/unpaid are not registered.`}
        action={
          <div className="flex gap-2">
            <button onClick={() => setMoveOpen(true)} className="btn btn-secondary text-sm">Move late registrations</button>
            <Link href="/admin/webinars" className="btn btn-secondary text-sm">← Webinars</Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Confirmed" value={counts.confirmed} cls="text-success" />
        {!webinar.isFree && <Stat label="Pending" value={counts.pending} cls="text-amber-500" />}
        {!webinar.isFree && <Stat label="Failed" value={counts.failed} cls="text-danger" />}
        {!webinar.isFree && <Stat label="Unpaid (lead only)" value={counts.unpaid} />}
        <Stat label="Total rows" value={counts.total} />
      </div>

      <div className="mt-6">
        <TableShell headers={["Name", "Phone", "Registered", "Status", "Attended", "SMS"]}>
          {registrants.map((r) => {
            const pill = STATUS_PILL[r.status];
            return (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface2">
                <td className="px-4 py-3 font-medium">{r.name || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.phone || "—"}</td>
                <td className="px-4 py-3 text-sm">{formatISTDateTime(r.created_at)}</td>
                <td className="px-4 py-3"><span className={`pill ${pill.cls}`}>{pill.label}</span></td>
                <td className="px-4 py-3 text-sm">{r.attended ? "Yes" : "—"}</td>
                <td className="px-4 py-3"><SendSmsButton phone={r.phone} name={r.name} /></td>
              </tr>
            );
          })}
          {registrants.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">No registrations yet.</td>
            </tr>
          )}
        </TableShell>
      </div>

      {moveOpen && (
        <MoveRegistrationsModal
          source={{ id: webinar.id, title: webinar.title }}
          onClose={() => setMoveOpen(false)}
          onDone={() => { setMoveOpen(false); reload(); }}
        />
      )}
    </div>
  );
}
